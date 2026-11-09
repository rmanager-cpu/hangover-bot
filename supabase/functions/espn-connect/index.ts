// espn-connect: the app's in-app ESPN sign-in hands over SWID and espn_s2.
//   { swid, espnS2, swids?, season? } -> { credentialId, leagues: LeagueSummary[], leagueLookupFailed }
//   401 { error: "espn_rejected" } when ESPN's league API refuses them.
//   409 { error: "espn_not_signed_in" } when every SWID offered is a signed-out visitor's:
//   ESPN has not finished the sign-in, and nothing is stored. The app keeps waiting.
//   409 { error: "wrong_team" } when they are a different ESPN account from the one that
//   owns the team the user already watches (nothing is stored).
// A user who already watches a league has the new cookies tried against it first, so a
// bad sign-in never replaces a good one. A first sign-in is stored as it is: picking a
// league (connection-setup) is its proof. Never log the cookies.

import { AuthError, NotSignedInError, ProviderError, type LeagueSummary } from "@rosterbots/connectors";
import { requireUser } from "../_lib/auth.ts";
import { makeDeps } from "../_lib/deps.ts";
import { HttpError, json, readBody, season, serve, str } from "../_lib/http.ts";
import { adminClient, createStore } from "../_lib/store.ts";

const notASignIn = () => new HttpError(400, "bad_request", "That does not look like an ESPN sign-in. Sign in to ESPN again.");

// The connector matches team owners by SWID with its braces, and cookie stores hand it
// over braced, percent-encoded or quoted.
function cleanSwid(raw: string): string {
  let s = raw.trim();
  if (s.startsWith('"') && s.endsWith('"')) s = s.slice(1, -1);
  if (s.toUpperCase().startsWith("%7B")) {
    try {
      s = decodeURIComponent(s);
    } catch {
      throw notASignIn();
    }
  }
  if (!s.startsWith("{")) s = "{" + s + "}";
  if (s.length > 64 || !/^[{][0-9A-Za-z-]+[}]$/.test(s)) throw notASignIn();
  return s;
}

// espn_s2 goes into a Cookie header exactly as ESPN set it, so it may not contain
// anything that would end the value or the header: controls, space, quote, comma,
// semicolon, backslash.
const FORBIDDEN = new Set([0x22, 0x2c, 0x3b, 0x5c]);
function cleanS2(raw: string): string {
  let s = raw.trim();
  if (s.startsWith('"') && s.endsWith('"')) s = s.slice(1, -1);
  if (s.length < 20 || s.length > 4096) throw notASignIn();
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c <= 0x20 || c >= 0x7f || FORBIDDEN.has(c)) throw notASignIn();
  }
  return s;
}

serve("espn-connect", async (req) => {
  const db = adminClient();
  const user = await requireUser(req, db);
  const body = await readBody(req);
  const espnS2 = cleanS2(str(body, "espnS2"));
  const store = createStore(db);
  const deps = makeDeps(store);

  // ESPN gives every signed-out visitor a SWID and writes the account's own as a separate
  // step, so the phone may hold both and hand over the visitor's (Nov 9: three sign-ins,
  // each a visitor's SWID with a real espn_s2; no leagues listed, the typed league "not
  // your team"). The app sends every SWID it can see; the fan profile tells a visitor's
  // ("fan not found") from the account's, and the first account wins.
  const offered = [str(body, "swid"), ...(Array.isArray(body.swids) ? body.swids.filter((x): x is string => typeof x === "string") : [])];
  const candidates: string[] = [];
  for (const raw of offered.slice(0, 6)) {
    try {
      const s = cleanSwid(raw);
      if (!candidates.includes(s)) candidates.push(s);
    } catch {
      // Not a SWID; the others may be.
    }
  }
  if (candidates.length === 0) throw notASignIn();

  // The fan profile's league list was unproven until Nov 9; any failure of it other than
  // "a visitor" says nothing about the sign-in, so that SWID is used with no list and the
  // app offers league-id entry (a 401 here would loop the user through sign-in for ever).
  let credentials: { swid: string; espnS2: string } | null = null;
  let leagues: LeagueSummary[] = [];
  for (const swid of candidates) {
    try {
      leagues = await deps.connector({ swid, espnS2 }, season(body)).getLeagues();
      credentials = { swid, espnS2 };
      break;
    } catch (e) {
      if (e instanceof NotSignedInError) continue;
      credentials = { swid, espnS2 };
      leagues = [];
      break;
    }
  }
  if (!credentials) {
    console.log(`espn-connect: not signed in yet (${candidates.length} visitor SWID(s))`);
    throw new HttpError(409, "espn_not_signed_in", "ESPN hasn't finished signing you in. Finish signing in on ESPN's page, then wait a moment.");
  }
  const leagueLookupFailed = leagues.length === 0;

  // The league API is what every read uses, so a league the user already watches is the
  // place to prove the new cookies. A refusal there keeps the stored sign-in (401 to the
  // app); any other failure replaces nothing either (serve() answers 502, the app offers
  // "Try again" with the session still in its WebView).
  const watched = await store.watchedLeagues(user.id);
  const first = watched[0];
  if (first) {
    let managed: string | null = null;
    try {
      managed = (await deps.connector(credentials, first.season).getMyTeam(first.leagueId)).teamId;
    } catch (e) {
      if (e instanceof AuthError) throw e; // serve() answers 401 espn_rejected
      // ESPN took the session, but its account manages no team there (NoTeamError).
      if (!(e instanceof ProviderError && e.httpStatus === 200)) throw e;
    }
    // A different ESPN account from the one that owns the watched team is refused, never
    // stored: it would replace the working sign-in every watched league reads with, and the
    // app would say all is well (owner, Nov 6: a phone's sign-in that managed no team was
    // saved over a good one and the league went unread for 12 days). Switching ESPN accounts
    // on purpose goes through "Forget my ESPN sign-in", which stops watching first.
    if (managed === null || (first.teamId !== null && managed !== first.teamId)) {
      console.log(`espn-connect: refused, not the watched team's ESPN account (${leagues.length} league(s) listed)`);
      const team = first.teamName ?? "the team you watch";
      throw new HttpError(
        409,
        "wrong_team",
        `This ESPN account doesn't manage ${team}. Go back and sign in to ESPN with the account that does. To watch a different ESPN account's leagues, use Forget my ESPN sign-in in Settings first.`,
      );
    }
  }

  const credentialId = await store.storeCredential(user.id, credentials);
  if (first) await store.resumeAfterSignIn(credentialId, new Date().toISOString());
  console.log(`espn-connect: signed in, ${leagues.length} league(s) listed${first ? ", checked against a watched league" : ""}`);
  return json({ credentialId, leagues, leagueLookupFailed });
});
