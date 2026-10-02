// JSON in and out, CORS for a future web client, and the one place a thrown error
// becomes a response. Errors are logged by name only: an ESPN failure can carry
// request context, and a request to ESPN carries the user's cookies.

import { AuthError, ProviderError } from "@rosterbots/connectors";

export const CORS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "content-type": "application/json" } });
}

/** Throw from a handler to answer with this status and `{ error, message }`. */
export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const espnRejected = (): HttpError =>
  new HttpError(401, "espn_rejected", "ESPN did not accept the sign-in. Sign in to ESPN again.");

const badRequest = (message: string): HttpError => new HttpError(400, "bad_request", message);

export async function readBody(req: Request): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw badRequest("The request body must be JSON.");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw badRequest("The request body must be a JSON object.");
  return body as Record<string, unknown>;
}

export function str(body: Record<string, unknown>, key: string): string {
  const v = body[key];
  if (typeof v !== "string" || !v.trim()) throw badRequest(`${key} is required.`);
  return v.trim();
}

// Checked before it reaches Postgres, where a malformed uuid is a 500 rather than a 400.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function uuid(body: Record<string, unknown>, key: string): string {
  const v = str(body, key);
  if (!UUID.test(v)) throw badRequest(`${key} must be an id.`);
  return v;
}

/**
 * A provider id: digits, and for a D/ST a leading minus. Numbers are accepted because
 * ESPN's own ids are numbers. Goes into ESPN URLs, so nothing else gets through.
 */
const ID = /^-?[0-9]{1,15}$/;
export function providerId(body: Record<string, unknown>, key: string): string {
  const v = body[key];
  const s = typeof v === "number" && Number.isInteger(v) ? String(v) : typeof v === "string" ? v.trim() : "";
  if (!ID.test(s)) throw badRequest(`${key} must be an ESPN id.`);
  return s;
}

/** The season is 2026 unless the caller says otherwise. */
export function season(body: Record<string, unknown>): number {
  const v = body.season;
  if (v === undefined || v === null) return 2026;
  if (typeof v !== "number" || !Number.isInteger(v) || v < 2018 || v > 2100) throw badRequest("season must be a year.");
  return v;
}

export function serve(name: string, handler: (req: Request) => Promise<Response>): void {
  Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
    if (req.method !== "POST") return json({ error: "method_not_allowed", message: "Use POST." }, 405);
    try {
      return await handler(req);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.code, message: e.message }, e.status);
      if (e instanceof AuthError) {
        const r = espnRejected();
        return json({ error: r.code, message: r.message }, r.status);
      }
      // The connector's own timeout is the only one in play: supabase-js sets none.
      if (e instanceof ProviderError || (e instanceof Error && e.name === "TimeoutError")) {
        console.error(`${name}: ESPN ${e instanceof ProviderError ? "answered HTTP " + e.httpStatus : "timed out"}`);
        return json({ error: "espn_unavailable", message: "ESPN did not answer properly. Try again in a minute." }, 502);
      }
      console.error(`${name}: ${e instanceof Error ? e.name : "unknown error"}`);
      return json({ error: "internal", message: "Something went wrong. Try again in a minute." }, 500);
    }
  });
}
