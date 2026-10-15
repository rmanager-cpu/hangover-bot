// connection-setup: watch one league with the user's stored ESPN sign-in.
//   { credentialId, leagueId, season? } -> { connection: ConnectionRow, read: ReadSummary }
// Re-running it for the same league refreshes what ESPN says and keeps the user's
// protection settings.

import { ProviderError } from "@rosterbots/connectors";
import { nextCheckAt, summarizeRead } from "@rosterbots/service";
import { requireUser } from "../_lib/auth.ts";
import { makeDeps } from "../_lib/deps.ts";
import { espnRejected, HttpError, json, providerId, readBody, season, serve, uuid } from "../_lib/http.ts";
import { adminClient, createStore } from "../_lib/store.ts";

serve("connection-setup", async (req) => {
  const db = adminClient();
  const user = await requireUser(req, db);
  const body = await readBody(req);
  const credentialId = uuid(body, "credentialId");
  const leagueId = providerId(body, "leagueId");
  const year = season(body);
  const store = createStore(db);

  // Someone else's credential answers exactly like a missing one.
  if ((await store.credentialOwner(credentialId)) !== user.id) {
    throw new HttpError(404, "not_found", "Sign in to ESPN first.");
  }
  const creds = await store.credentials(credentialId);
  if (!creds) throw espnRejected();

  const connector = makeDeps(store).connector(creds, year);
  let team: { teamId: string; teamName: string; leagueName: string };
  try {
    team = await connector.getMyTeam(leagueId);
  } catch (e) {
    if (e instanceof ProviderError && e.httpStatus === 200) {
      throw new HttpError(422, "not_in_league", `Your ESPN account does not manage a team in league ${leagueId}.`);
    }
    if (e instanceof ProviderError && e.httpStatus === 404) {
      throw new HttpError(404, "league_not_found", `ESPN has no ${year} league ${leagueId}.`);
    }
    throw e;
  }
  const roster = await connector.getRoster(leagueId);

  const now = new Date();
  const connection = await store.upsertConnection({
    userId: user.id,
    credentialId,
    leagueId,
    season: year,
    teamId: roster.teamId,
    teamName: roster.teamName || team.teamName,
    leagueName: team.leagueName,
    roster,
    readAt: now.toISOString(),
    nextCheckAt: nextCheckAt(roster, now).toISOString(),
  });
  console.log(`connection-setup: connection ${connection.id} ready`);
  return json({ connection, read: summarizeRead(roster, now) });
});
