// Who is calling. The gateway has already checked the JWT's signature (verify_jwt),
// but only the Auth server knows the user still exists, so ask it.

import type { SupabaseClient } from "@supabase/supabase-js";
import { HttpError } from "./http.ts";

export interface Caller {
  id: string;
  /** Not yet claimed by email. Core caps an anonymous account at Ask Me. */
  isAnonymous: boolean;
}

export async function requireUser(req: Request, db: SupabaseClient): Promise<Caller> {
  const header = req.headers.get("authorization") ?? "";
  const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  const signIn = () => new HttpError(401, "unauthorized", "Your session has ended. Open the app again.");
  if (!token) throw signIn();
  const { data, error } = await db.auth.getUser(token);
  // The anon key is a valid JWT too, but it has no user behind it.
  if (error || !data.user) throw signIn();
  return { id: data.user.id, isAnonymous: data.user.is_anonymous ?? false };
}
