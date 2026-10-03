// Who is calling. The function checks the caller itself, by asking the Auth server about
// the bearer token, so it does not depend on the gateway's verify_jwt (off for every
// function in config.toml: that check knows only the legacy JWT secret, and a project on
// the newer signing keys can see valid sessions refused at the door). The Auth server is
// also the only one that knows the user still exists.

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
  // getUser(token) sends the token to the Auth server, which validates it with whichever
  // keys the project uses. The publishable or anon key is a valid JWT too, but it has no
  // user behind it, so it is refused here as well.
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) {
    // The status and the error's name only, never the token. A 401 here on every call with a
    // fresh session means the Auth server refused the function's own key (the legacy keys
    // disabled, say), not the user's token: docs/DEPLOY.md step 6.
    console.error(`auth: getUser refused (${error ? `${error.status ?? "no status"} ${error.name}` : "no user"})`);
    throw signIn();
  }
  return { id: data.user.id, isAnonymous: data.user.is_anonymous ?? false };
}
