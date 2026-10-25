# RosterBots: Hangover Protection

The spec is `docs/HANDOFF-2026-10-02.docx` (searchable as `.txt`). `docs/DECISIONS.md` is
what has been decided since and where the code reads the handoff cautiously. Read both
before changing behaviour. `docs/ARCHITECTURE.md` is how it fits together.

The stack is fixed: read `docs/STACK.md` before adding anything. Do not bring in a
framework, database, AI provider or push service that is not listed there.

## Where it is (Oct 3 2026): built, reviewed and fixed; nothing is deployed or proven

Target: **Sunday Oct 4**, Android first, iPhone if Apple allows, with Sunday automation. The
contract is `docs/BETA.md`: change it before changing an interface. `docs/DEPLOY.md` is the
backend deploy, written for a session with the Supabase and Expo MCP connectors and no
shell access to either; `apps/mobile/README.md` is the app build. AI provider: Anthropic
(see DECISIONS), but the beta makes no AI calls.

Built, and passing here with no network:

- `packages/core`: domain types, the rules engine, authority, the account gate, and the
  first-weekend guardrails (`guard`, `rosterLooksSane`: **T-90 to T-4** (owner, Oct 3),
  3 a day, sane read, kickoff known).
- `packages/connectors`: the connector interface and ESPN (leagues, my team, roster, lineup
  write). Hand-built fixtures only. A missing pro team is an unknown schedule, never a bye.
- `packages/football-data`: NFL facts and the `GameDayFeed` seam.
- `packages/service`: `protectConnection`, `decideAction`, `manualSwap`, `summarizeRead`,
  `nextCheckAt` (every minute inside T-10), `expoPush`. Platform-neutral: Node in tests,
  Deno in the Edge Functions. The Oct 3 review's automation-safety fixes live here, each
  with a test in `test/safety.test.ts`: a failed write holds every automatic move for the
  week, an approval re-checks the reason, stale proposals are withdrawn, a write a dead run
  left in flight is settled, status changes are conditional, one ESPN refusal is re-read
  before anyone is told to sign in, and **the first automatic move in a league waits for the
  user's own proof** (`write_verified_at`: the test swap or an approval seen on ESPN). The
  second Oct 3 review's fixes are there too: an incomplete read (half a payload, or no
  kickoffs) is a failed read that is never judged, the read that verifies a write is
  patient, an automatic move the user undoes comes back as a proposal rather than silence,
  and every next check sits on the minute boundary the cron tick lands on.
- `supabase/`: the migration (five tables, RLS, Vault, pg_cron every minute,
  `write_verified_at`, credential delete for "Forget my ESPN sign-in"), six Edge Functions
  (`espn-connect`, `connection-setup`, `read`, `decide`, `swap`, `check`) and `config.toml`
  with `verify_jwt = false` for all six (the functions check the caller themselves; the
  database key comes from `_lib/keys.ts`, newer `sb_secret_` names or the legacy one).
  `functions/_shared/` is a committed copy of `packages/*/src`; `npm run functions:bundle`
  writes the per-function folders `deploy_edge_function` takes.
- `apps/mobile`: Expo SDK 57. Anonymous session, ESPN sign-in in a WebView (cookies cleared
  on leaving the screen; handover after two identical reads), league pick, "What we read
  from ESPN" with the test swap, protection, claim by email code, **sign in to a claimed
  account by email code**, Home, Activity with Approve/Decline, Settings (with **Forget my
  ESPN sign-in**), push.
- `scripts/espn-check.ts`: the cookie-based ESPN read. For the beta the app's "What we read"
  screen and test swap replace it (no desktop, so no cookies to copy).

The checks, all passing on Oct 3: `npm test` (187 tests, including the `_shared` sync check
and the bundle check), `npm run typecheck` (core, football-data, connectors, service,
scripts, mobile), `npm run functions:check`, `npx -y deno@2 check index.ts` in each
`supabase/functions/<fn>` and in each `supabase/.bundle/<fn>`, and in `apps/mobile`
`EXPO_OFFLINE=1 npx expo export --platform android` and `--platform ios`.

**Unverified: nothing has touched a real service.** ESPN, Supabase, Expo and EAS were all
unreachable from the build and fix sessions.

- **ESPN.** Every read, the fan-profile league lookup and the lineup write (still
  `unverified` in the connector) are untested against ESPN, and whether ESPN answers
  requests from Supabase's servers is unknown. There is no feature flag on the write
  (owner, Oct 3): the Saturday test swap is the proof, and a league where no change of the
  user's has landed gets proposals, not moves.
- **In-app sign-in.** Whether Disney's login works inside a WebView, and whether `espn_s2`
  can be read (native cookie store through an old library on React Native 0.86's interop
  layer; the page-script fallback fails if `espn_s2` is HttpOnly). With no desktop there is
  no other way in if this fails.
- **Supabase.** Not deployed. The migration ran in PGlite as superuser only, before the
  Oct 3 edits. MCP tool parameters and dashboard paths are marked (unverified) in
  `DEPLOY.md`. `CRON_SECRET` is the one value no tool sets: the owner adds it in the
  dashboard. The built-in email sender reaches only the Supabase organisation's members, so
  claiming an account (and so any automatic move) needs the owner's address invited, or
  custom SMTP; the Change-email and Magic-link templates must carry `{{ .Token }}`.
- **The app.** Never built natively, never run on a phone. Push delivery, the claim flow,
  the sign-in-by-email flow and the Gradle 9 workaround for `@react-native-cookies/cookies`
  are untested.
- `rosterLooksSane` has only seen hand-built rosters.

**Next, in order** (no desktop anywhere in the owner's path):

1. Backend, from a cloud session with the Supabase MCP connector: `docs/DEPLOY.md` steps
   1 to 7. The owner's part is the four dashboard settings it lists, on the phone.
2. App, from the same session with the Expo MCP connector: the owner links the GitHub repo
   to the EAS project on expo.dev (base directory `apps/mobile`), the branch is pushed, then
   `build_run` for Android (`preview`) builds that commit from GitHub, and the APK goes from
   the build page onto the phone. `eas.json` already carries the Supabase URL and
   publishable key.
3. On the phone, Saturday: sign in to ESPN in the app, compare "What we read" line by line
   with the ESPN app, one test swap, swap back. The first swap's receipt says it unlocked
   automatic moves. Only then claim the account and turn on Bench Protection.
4. Push is optional for Sunday (everything also lands in Activity): Firebase
   `google-services.json` as an EAS file variable and an FCM V1 key on expo.dev.
5. Once a real read exists, replace the connector's hand-built fixtures with captured ones,
   **cookies and SWIDs stripped**, and take `WRITE_LINEUP` out of `unverified` once a real
   swap has been seen.

**Pending owner decisions** (record answers in `docs/DECISIONS.md`): the in-app names for
the three levels. AI provider decided Oct 25: Anthropic, Claude Sonnet, model id in config. The AI level's contract is `docs/AI-NATIVE.md`. Decided Oct 25: three levels, Alert Me, Auto
Protect (automatic from T-90) and AI Native (Claude Sonnet 5.5: fixes holes at T-15, may add and drop only players marked
Droppable and only within the No-Cray Rules; Roster Advice, one tap, never automatic). "Live"
is decided: the owner's own league this season.

Not started: `packages/ai`, `packages/ui`, `apps/web`, `apps/worker`, `apps/extension`,
Sentry.

## Rules

- **ESPN only at launch.** Other providers are "coming soon" entries, not code.
- **No unattended write for an anonymous account.** Enforced in `core`, not the UI.
- **The rules engine decides; AI only picks from the candidates core gives it.** A hole is a
  starter projected for zero (or OUT/IR/suspended/bye); the fix is one bench player in, with
  playing starters shifted along to make room. A playing starter is never benched and a
  lineup with no hole is never touched (owner, Oct 3). A hole is filled automatically even
  after the user undoes the fix in ESPN; only their Decline in the app stops it (owner, Oct 4).
  Anyone ESPN projects can fill a hole: questionable when nobody healthy can, doubtful as the
  last resort (Oct 4; `docs/DECISIONS.md`).
- **A write is not a success until a fresh read shows it.**
- **Never log a request to ESPN.** It carries the user's cookies.
- **Team ids are not 1..N, and a negative player id is real** (every D/ST).
- An ESPN status we have not mapped is `unknown`, and `unknown` never moves a player.
- **A player projected for zero points is never moved into the lineup** (owner, Oct 3):
  not automatically, not as a proposal, not as an option. A missing projection is not zero.
- Runs on Node 22.18+ with native TypeScript type stripping: import with `.ts`
  extensions, and no enums, namespaces or parameter properties (`erasableSyntaxOnly`).
- After changing `packages/*/src`, run `npm run functions:build`: the Edge Functions deploy
  from their committed copies, and `npm test` fails while they are stale. The deploy itself
  goes through `npm run functions:bundle` (`docs/DEPLOY.md`).
- `verify_jwt` stays off for every Edge Function; each checks its caller in code.
- The app imports only **types** from `@rosterbots/*`; no server code goes into the bundle.
