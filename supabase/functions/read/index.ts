// read: a fresh read from ESPN for the "What we read from ESPN" screen.
//   { connectionId } -> ReadSummary
// Saves the roster; the check schedule is the checker's business, so it is left alone.

import { summarizeRead } from "@rosterbots/service";
import { requireUser } from "../_lib/auth.ts";
import { makeDeps } from "../_lib/deps.ts";
import { espnRejected, HttpError, json, readBody, serve, uuid } from "../_lib/http.ts";
import { adminClient, createStore } from "../_lib/store.ts";

serve("read", async (req) => {
  const db = adminClient();
  const user = await requireUser(req, db);
  const connectionId = uuid(await readBody(req), "connectionId");
  const store = createStore(db);

  const conn = await store.getConnection(connectionId);
  if (!conn || conn.userId !== user.id) throw new HttpError(404, "not_found", "That league is not connected.");
  const creds = await store.credentials(conn.credentialId);
  if (!creds) throw espnRejected();

  const now = new Date();
  const roster = await makeDeps(store).connector(creds, conn.season).getRoster(conn.leagueId);
  // ESPN answers with whichever team the cookies manage. Showing, or saving, someone
  // else's team as this one would make the test swap and Home lie (service WrongTeamError).
  if (conn.teamId !== null && roster.teamId !== conn.teamId) {
    const team = conn.teamName ?? "this team";
    throw new HttpError(409, "wrong_team", `The ESPN account you're signed in with doesn't manage ${team}. Sign in to ESPN again with the account that does.`);
  }
  await store.saveRoster(conn.id, roster, now.toISOString());
  return json(summarizeRead(roster, now));
});
