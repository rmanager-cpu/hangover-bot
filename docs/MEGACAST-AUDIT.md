# Megacast audit: what HangoverBot takes from rr-draft-megacast

Audited 2026-10-02 against `rr-draft-megacast` at `master` (75b92af) plus the lineup-swap
script added the same day on `claude/vigilant-fermat-qooyqm`. Megacast is plain ESM
JavaScript run on one laptop; HangoverBot is TypeScript on a server. So everything here is
**ported**, not imported, and nothing is shared at runtime.

No secrets were copied. Megacast keeps its ESPN cookies in a gitignored `.env`; this
repository has none and must never have any.

## Item by item

| Asked to audit | Megacast file | Verdict for HangoverBot |
|---|---|---|
| package.json | `package.json` | Node 22, ESM, two runtime deps (`ws`, Anthropic SDK). Nothing to take; confirms Node 22 + native `fetch` is enough for ESPN. |
| Login capture | `scripts/login.mjs` | Opens a separate Chrome profile with Playwright, user signs in, reads the `SWID` and `espn_s2` cookies for `fantasy.espn.com`, then calls the league API to say **which member and team** the cookies belong to. **The pattern carries over; the mechanism does not.** A server cannot open a browser for a consumer, so capture moves into the browser extension (`apps/extension`), which reads the same two cookies with `chrome.cookies` and hands them to the backend. The "say whose cookies these are" check is kept and runs server-side on receipt. |
| League identification | `scripts/league-info.mjs`, `server/league.mjs` | Ported to `packages/connectors/src/espn`. `mSettings + mTeam + mStatus` gives name, teams, members, roster slot counts. A member's own team is the one whose `owners` contains their SWID. |
| ESPN adapter/client | `server/league.mjs`, `server/players.mjs`, `server/lineup.mjs`, `server/draftwire.mjs` | League, roster and lineup-write ported. The draft-room WebSocket (`draftwire`, `initdecode`, `src-room`) is **not** ported: drafts are not HangoverBot's job. |
| `.env.example` | `.env.example` | Three ESPN values: league id, `SWID` (keeps its braces), `espn_s2`. In HangoverBot these are per user, stored encrypted in Supabase Vault, never in an env file. |
| Session persistence | `data/chrome-profile/`, `.env` | One operator's browser profile on disk. Not reusable for many users. Replaced by Vault-stored cookies per league connection. |
| Player/team id normalization | `server/players.mjs`, `server/league.mjs` | Ported, with its hard-won rules (below). Position and pro-team maps moved to `packages/football-data`. |
| Request/response fixtures | `test/fixtures/` | All four are draft-room wire captures (`init-*.txt`, `selected-snake.txt`, `timeline-snake.txt`). **None covers rosters, injuries or lineup writes**, so HangoverBot's connector tests use hand-built fixtures in ESPN's shape, labelled as such. Capturing real ones is an early task once a session can reach ESPN. |
| Authentication refresh | `src-live.mjs:95`, `probe.mjs`, `league-info.mjs` | **There is none.** ESPN cookies cannot be refreshed by a script; a 401/403 is reported as "cookies are stale, sign in again". HangoverBot inherits that limit: a connection goes `needs_reauth`, the user is told, and the extension re-captures on their next ESPN visit. This is the single biggest operational risk in the ESPN integration (see OPEN-DECISIONS). |

## Rules learned the hard way, now encoded in the connector

- **Team ids are not 1..N.** The real league runs 1-9 and 11-13. Never derive a team from
  a counter; always from `teams[].id` and `owners`.
- **A player id can be negative and real.** Every D/ST is. Only `-1` (and `0`) mean an
  empty pick, and only in draft data.
- **The league API is blind during a live draft.** Irrelevant in season, but do not use it
  to watch a draft.
- **The player table** is `players?view=kona_player_info` with an `x-fantasy-filter`
  header and an explicit limit; `players_wl` is paged to 50 and is the wrong endpoint. It
  works without cookies.
- **Position ids** include punters, defensive positions, head coaches and a team-QB
  aggregate (7, 9-15). Unmapped ids render as "?"; map them explicitly.
- **Never log a request.** It carries the member's cookies. Megacast's rule, kept.

## Unproven, and must be proven before anyone relies on it

- **The lineup write.** `POST lm-api-writes.../transactions/` with a `ROSTER` transaction
  of `LINEUP` items. It is the request the ESPN site sends when a player is moved, written
  in Megacast on 2026-10-02 and never yet run: the cloud session could not reach ESPN.
  The connector therefore always re-reads the roster after writing and reports success
  only if the slots actually changed.
- `lineupLocked`, `injuryStatus`, `eligibleSlots`, projected `stats` and the
  `proTeamSchedules_wl` view are read the way the ESPN site and community clients read
  them, but Megacast never used any of them except `eligibleSlots` and `lineupLocked`.
