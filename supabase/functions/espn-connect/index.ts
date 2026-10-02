// espn-connect: the app's in-app ESPN sign-in hands over SWID and espn_s2.
//   { swid, espnS2, season? } -> { credentialId, leagues: LeagueSummary[], leagueLookupFailed }
//   401 { error: "espn_rejected" } when ESPN refuses them.
// They are tried against ESPN before they are stored, so a bad sign-in never replaces a
// good one. Never log them.

import { AuthError, type LeagueSummary } from "@rosterbots/connectors";
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

  let leagues: LeagueSummary[] = [];
  let leagueLookupFailed = false;
  try {
    leagues = await makeDeps(store).connector(credentials, season(body)).getLeagues();
  } catch (e) {
    if (e instanceof AuthError) throw e; // serve() answers 401 espn_rejected
    leagueLookupFailed = true;
  }
  // The fan-profile read is unproven. An empty list is likelier a shape we do not read
  // than a member in no leagues, so the app offers league-id entry either way.
  if (!leagues.length) leagueLookupFailed = true;

  const credentialId = await store.storeCredential(user.id, credentials);
  await store.resumeAfterSignIn(credentialId, new Date().toISOString());
  console.log(`espn-connect: signed in, ${leagues.length} league(s) found`);
  return json({ credentialId, leagues, leagueLookupFailed });
});
