// The Edge Functions, as docs/BETA.md lists them. Every call carries the user's own
// Supabase session; the app never talks to ESPN itself.

import type { LeagueSummary } from "@rosterbots/connectors";
import type { ConnectionRow, DecisionResult, ReadSummary, SwapResult } from "@rosterbots/service";
import { FunctionsFetchError, FunctionsHttpError, FunctionsRelayError } from "@supabase/supabase-js";
import { supabase } from "./supabase";

/** A refusal or failure, with the server's own words when it sent some. */
export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status: number, message: string) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const OFFLINE = "Can't reach HangoverBot. Check your connection and try again.";

async function call<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (!error) return data as T;

  if (error instanceof FunctionsHttpError) {
    const res = error.context as Response | undefined;
    let payload: { error?: unknown; message?: unknown; msg?: unknown } = {};
    try {
      payload = (await res?.json()) ?? {};
    } catch {
      // Not JSON: a gateway page. The status still says enough.
    }
    const status = res?.status ?? 500;
    const code = typeof payload.error === "string" ? payload.error : status === 401 ? "unauthorized" : "error";
    const message =
      typeof payload.message === "string" ? payload.message : status === 401 ? "Your session has ended. Close the app and open it again." : "Something went wrong. Try again in a minute.";
    throw new ApiError(code, status, message);
  }
  if (error instanceof FunctionsFetchError || error instanceof FunctionsRelayError) throw new ApiError("offline", 0, OFFLINE);
  throw new ApiError("error", 0, OFFLINE);
}

export interface EspnConnectResult {
  credentialId: string;
  leagues: LeagueSummary[];
  leagueLookupFailed: boolean;
}

export const api = {
  /** The one place the ESPN session leaves the phone. */
  espnConnect: (swid: string, espnS2: string) => call<EspnConnectResult>("espn-connect", { swid, espnS2 }),
  connectionSetup: (credentialId: string, leagueId: string) =>
    call<{ connection: ConnectionRow; read: ReadSummary }>("connection-setup", { credentialId, leagueId }),
  read: (connectionId: string) => call<ReadSummary>("read", { connectionId }),
  decide: (actionId: string, decision: "approve" | "decline") => call<DecisionResult>("decide", { actionId, decision }),
  swap: (connectionId: string, playerIdA: string, playerIdB: string) => call<SwapResult>("swap", { connectionId, playerIdA, playerIdB }),
};

export const messageOf = (e: unknown): string => (e instanceof ApiError ? e.message : e instanceof Error && e.message ? e.message : OFFLINE);
