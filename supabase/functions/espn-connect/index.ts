// espn-connect: the app's in-app ESPN sign-in hands over SWID and espn_s2.
//   { swid, espnS2, season? } -> { credentialId, leagues: LeagueSummary[], leagueLookupFailed }
//   401 { error: "espn_rejected" } when ESPN's league API refuses them.
// A user who already watches a league has the new cookies tried against it first, so a
// bad sign-in never replaces a good one. A first sign-in is stored as it is: picking a
// league (connection-setup) is its proof. Never log the cookies.

import { AuthError, ProviderError, type LeagueSummary } from "@rosterbots/connectors";
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
  const credentials = { swid: cleanSwid(str(body, "swid")), espnS2: cleanS2(str(body, "espnS2")) };
  const store = createStore(db);
  const deps = makeDeps(store);

  // The league list comes from ESPN's fan profile, a read this code has never seen answer.
  // Nothing it does says anything about the sign-in, a 401 from it included: a refusal
  // there would otherwise loop the user through sign-in for ever, with league-id entry
  // never reached. An empty list is likelier a shape we do not read than a member in no
  // leagues, so the app offers league-id entry either way.
  let leagues: LeagueSummary[] = [];
  try {
    leagues = await deps.connector(credentials, season(body)).getLeagues();
  } catch {
    // Unproven read: the league id can be typed.
  }
  const leagueLookupFailed = leagues.length === 0;

  // The league API is what every read uses, so a league the user already watches is the
  // place to prove the new cookies. A refusal there keeps the stored sign-in (401 to the
  // app); any other failure replaces nothing either (serve() answers 502, the app offers
  // "Try again" with the session still in its WebView).
  const watched = await store.watchedLeagues(user.id);
  let proven = false;
  if (watched.length) {
    const { leagueId, season: year } = watched[0]!;
    try {
      await deps.connector(credentials, year).getMyTeam(leagueId);
      proven = true;
    } catch (e) {
      if (e instanceof AuthError) throw e; // serve() answers 401 espn_rejected
      // A working session that manages no team there is a different ESPN account: stored,
      // because the user chose it, but it resumes nothing; the checker says "wrong team".
      if (!(e instanceof ProviderError && e.httpStatus === 200)) throw e;
    }
  }

  const credentialId = await store.storeCredential(user.id, credentials);
  if (proven) await store.resumeAfterSignIn(credentialId, new Date().toISOString());
  console.log(`espn-connect: signed in, ${leagues.length} league(s) listed${watched.length ? (proven ? ", checked against a watched league" : ", not the watched team's account") : ""}`);
  return json({ credentialId, leagues, leagueLookupFailed });
});
