// leagues: the football leagues the stored ESPN sign-in belongs to this season, for
// "Watch another league": the list the sign-in gave, with no league id to type.
//   { season? } -> { credentialId, leagues: LeagueSummary[], leagueLookupFailed }
//   404 { error: "not_found" } when the user has no ESPN sign-in stored.
// The fan-profile read is the same unproven one espn-connect makes; when it fails, the
// list is empty and the app offers league-id entry as before.

import { AuthError, type LeagueSummary } from "@rosterbots/connectors";
import { requireUser } from "../_lib/auth.ts";
import { makeDeps } from "../_lib/deps.ts";
import { espnRejected, HttpError, json, readBody, season, serve } from "../_lib/http.ts";
import { adminClient, createStore } from "../_lib/store.ts";

serve("leagues", async (req) => {
  const db = adminClient();
  const user = await requireUser(req, db);
  const body = await readBody(req);
  const store = createStore(db);

  const credentialId = await store.credentialIdFor(user.id);
  if (!credentialId) throw new HttpError(404, "not_found", "Sign in to ESPN first.");
  const creds = await store.credentials(credentialId);
  if (!creds) throw espnRejected();

  let leagues: LeagueSummary[] = [];
  try {
    leagues = await makeDeps(store).connector(creds, season(body)).getLeagues();
  } catch (e) {
    // A refusal here is the sign-in's: the app sends the user back to ESPN. Anything else
    // leaves the list empty, and the league id can be typed.
    if (e instanceof AuthError) throw e;
  }
  console.log(`leagues: ${leagues.length} league(s) listed`);
  return json({ credentialId, leagues, leagueLookupFailed: leagues.length === 0 });
});
