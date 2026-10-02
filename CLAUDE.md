# HangoverBot (RosterBots)

The spec is `docs/HANDOFF-2026-10-02.docx` (searchable as `.txt`). `docs/DECISIONS.md` is
what has been decided since and where the code reads the handoff cautiously. Read both
before changing behaviour. `docs/ARCHITECTURE.md` is how it fits together.

The stack is fixed: read `docs/STACK.md` before adding anything. Do not bring in a
framework, database, AI provider or push service that is not listed there.

## Where it is (Oct 2 2026, night): the phone beta is built; nothing is deployed or proven

Target: **Sunday Oct 4**, Android first, iPhone if Apple allows, with Sunday automation. The
contract is `docs/BETA.md`: change it before changing an interface. `docs/DEPLOY.md` is the
backend deploy; `apps/mobile/README.md` is the app build. AI provider: Anthropic (see
DECISIONS), but the beta makes no AI calls.

Built, and passing here with no network:

- `packages/core`: domain types, the rules engine, authority, the account gate, and the
  first-weekend guardrails (`guard`, `rosterLooksSane`: T-90 to T-10, 3 a day, sane read,
  kickoff known).
- `packages/connectors`: the connector interface and ESPN (leagues, my team, roster, lineup
  write). Hand-built fixtures only.
- `packages/football-data`: NFL facts and the `GameDayFeed` seam.
- `packages/service`: `protectConnection`, `decideAction`, `manualSwap`, `summarizeRead`,
  `nextCheckAt`, `expoPush`. Platform-neutral: Node in tests, Deno in the Edge Functions.
- `supabase/`: the migration (five tables, RLS, Vault, pg_cron every minute), six Edge
  Functions (`espn-connect`, `connection-setup`, `read`, `decide`, `swap`, `check`) and
  `config.toml`. `functions/_shared/` is a committed copy of `packages/*/src`.
- `apps/mobile`: Expo SDK 57. Anonymous session, ESPN sign-in in a WebView, league pick,
  "What we read from ESPN" with the test swap, protection, claim by email code, Home,
  Activity with Approve/Decline, Settings, push.
- `scripts/espn-check.ts`: the cookie-based ESPN read. For the beta the app's "What we read"
  screen and test swap replace it (no desktop, so no cookies to copy).

The checks, all passing on Oct 2: `npm test` (145 tests, including the `_shared` sync
check), `npm run typecheck` (core, football-data, connectors, service, scripts, mobile),
`npm run functions:check`, `npx -y deno@2 check index.ts` in each `supabase/functions/<fn>`,
and in `apps/mobile` `EXPO_OFFLINE=1 npx expo export --platform android` and `--platform ios`.

**Unverified: nothing has touched a real service.** ESPN, Supabase, Expo and EAS were all
unreachable from the build session.

- **ESPN.** Every read, the fan-profile league lookup and the lineup write (still
  `unverified` in the connector) are untested against ESPN, and whether ESPN answers
  requests from Supabase's servers is unknown. Automatic moves are not gated on a proven
  write: the Saturday test swap is that proof, so it must happen before Sunday.
- **In-app sign-in.** Whether Disney's login works inside a WebView, and whether `espn_s2`
  can be read (native cookie store through an old library on React Native 0.86's interop
  layer; the page-script fallback fails if `espn_s2` is HttpOnly). With no desktop there is
  no other way in if this fails.
- **Supabase.** Not deployed. The migration ran in PGlite as superuser only. CLI flags,
  Management API fields and Edge runtime limits are marked (unverified) in `DEPLOY.md`. The
  built-in email sender reaches only the Supabase organisation's members, so claiming an
  account (and so any automatic move) needs the owner's address invited, or custom SMTP.
- **The app.** Never built natively, never run on a phone. Push delivery, the claim flow and
  the Gradle 9 workaround for `@react-native-cookies/cookies` are untested.
- `rosterLooksSane` has only seen hand-built rosters.

**Next, in order** (no desktop anywhere in the owner's path):

1. Backend, from a cloud session: the owner supplies `SUPABASE_ACCESS_TOKEN`, the project
   ref and the database password, plus network access to `api.supabase.com`,
   `<ref>.supabase.co` and the database pooler host. Then `docs/DEPLOY.md`.
2. App: an Expo account and EAS project. Either an `EXPO_TOKEN` plus network access to
   Expo for a cloud session to run `eas build -p android --profile preview`, or builds started
   on expo.dev from GitHub. The Supabase URL and anon key go into `eas.json`; the APK installs
   from EAS's link on the phone.
3. On the phone, Saturday: sign in to ESPN in the app, compare "What we read" line by line
   with the ESPN app, one test swap, swap back. Only then claim the account and turn on
   Bench Protection.
4. Push is optional for Sunday (everything also lands in Activity): Firebase
   `google-services.json` as an EAS file variable and an FCM V1 key on expo.dev.
5. Once a real read exists, replace the connector's hand-built fixtures with captured ones,
   **cookies and SWIDs stripped**.

**Pending owner decisions** (record answers in `docs/DECISIONS.md`): that adds, drops and IR
are recommendation-only too, and the kickoff-check cutoffs. "Live" is decided: the owner's
own league this season. Do not change AI Rescue's execution behaviour until the autonomy line
is confirmed; the beta does not offer it.

Not started: `packages/ai`, `packages/ui`, `apps/web`, `apps/worker`, `apps/extension`,
Sentry.

## Rules

- **ESPN only at launch.** Other providers are "coming soon" entries, not code.
- **No unattended write for an anonymous account.** Enforced in `core`, not the UI.
- **The rules engine decides; AI only picks from the candidates core gives it.**
- **A write is not a success until a fresh read shows it.**
- **Never log a request to ESPN.** It carries the user's cookies.
- **Team ids are not 1..N, and a negative player id is real** (every D/ST).
- An ESPN status we have not mapped is `unknown`, and `unknown` never moves a player.
- Runs on Node 22.18+ with native TypeScript type stripping: import with `.ts`
  extensions, and no enums, namespaces or parameter properties (`erasableSyntaxOnly`).
- After changing `packages/*/src`, run `npm run functions:build`: the Edge Functions deploy
  from their committed copies, and `npm test` fails while they are stale.
- The app imports only **types** from `@rosterbots/*`; no server code goes into the bundle.
