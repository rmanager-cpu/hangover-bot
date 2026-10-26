# RosterBots: Hangover Protection

The spec is `docs/HANDOFF-2026-10-02.docx` (searchable as `.txt`). `docs/DECISIONS.md` is
what has been decided since and where the code reads the handoff cautiously. Read both
before changing behaviour. `docs/ARCHITECTURE.md` is how it fits together.

The stack is fixed: read `docs/STACK.md` before adding anything. Do not bring in a
framework, database, AI provider or push service that is not listed there.

## Where it is (Oct 25 2026): the AI layer is built; the next build carries it

Target: the Google Play closed test (friends, a fake league), AI Native included, since a
runaway AI is the risk that matters (owner). The contracts: `docs/BETA.md` for the beta,
`docs/AI-NATIVE.md` for AI Native; change them before changing an interface. `docs/DEPLOY.md`
is the backend deploy for a session with the Supabase and Expo MCP connectors;
`apps/mobile/README.md` is the app build. The company is Turbo Devs; the app id is
`com.rosterbots.app`; support is support@rosterbots.com.

Built, and passing here with no network:

- `packages/core`: domain types, the rules engine, authority, the account gate, the guardrails
  (T-90 to T-3, 3 a day, sane read, kickoff known), and **the No-Cray Rules** (`outside.ts`:
  free agents as the fix for a hole, room made open spot → IR → drop, a test per rule) and the
  `Judge` / `Advisor` interfaces (`ai.ts`). The AI only ever judges a hole.
- `packages/ai`: core's Judge and Advisor over the Anthropic SDK (`claude-sonnet-5-5`):
  structured output for the Judge, web search plus one strict report tool for the Advisor.
  One live call each on Oct 25 proved the request shapes.
- `packages/connectors`: the connector interface and ESPN (leagues, my team, roster, lineup
  write, **free agents, add/drop**). Hand-built fixtures only. A missing pro team is an
  unknown schedule, never a bye. Bench and IR sizes are the league's own.
- `packages/football-data`: NFL facts and the `GameDayFeed` seam.
- `packages/service`: `protectConnection` (the check, with AI Native's **T-15 step** and the
  **T-3 all-clear**), `decideAction` (approves a bench move, an add, or a piece of advice),
  `manualSwap`, `adviseConnection` (**Roster Advice**), `summarizeRead`, `nextCheckAt`,
  `expoPush`. Platform-neutral: Node in tests, Deno in the Edge Functions. The Oct 3 and 4
  safety rules all stand (`test/safety.test.ts`): a failed write holds the week, the first
  automatic move waits for the user's own proof, every write is verified by a fresh read.
- `supabase/`: two migrations (the beta's five tables; Oct 25's `droppable`, `advised_at`,
  `actions.transaction`, `actions.sources`, kind `advise`), eight Edge Functions
  (`espn-connect`, `connection-setup`, `read`, `decide`, `swap`, `check`, `delete-account`,
  `leagues`), `verify_jwt = false` for all (each checks its caller). `functions/_shared/` is
  a committed copy of `packages/*/src`; `npm run functions:bundle` and `functions:compile`
  make what `deploy_edge_function` takes.
- `apps/mobile`: Expo SDK 57. Anonymous session, the ESPN disclosure then sign-in in a
  WebView, league pick (and "Watch another league" from the stored sign-in's list), "What we
  read from ESPN" with the test swap, the three levels (**Alert Me, Auto Protect, AI Native**),
  the **Droppable** screen, **Sign in with Google** (links this phone's anonymous account, or
  switches to the account that Google account already has; no email code since Oct 26), Home,
  Activity with Approve/Decline, **Roster Advice** with Do it / Not now, Settings, account
  deletion, push.

The checks, all passing on Oct 25: `npm test` (296, including the `_shared` sync check and
the bundle check), `npm run typecheck` (core, football-data, connectors, ai, service,
scripts, mobile), `npm run functions:check`, `npx -y deno@2 check index.ts` in
`supabase/functions/{check,decide,leagues,connection-setup}`, and in `apps/mobile`
`EXPO_OFFLINE=1 npx expo export --platform android`.

**Deployed (Oct 25, 8:50 PM ET):** the AI Native migration, `ANTHROPIC_API_KEY`, and the AI
layer's `check`, `decide` and `leagues`, each verified byte for byte against the local build;
the first live check of both leagues came back `ok` with the key present. `espn-connect`,
`connection-setup`, `read`, `swap` and `delete-account` are the earlier Oct 25 versions,
compatible, to refresh when convenient. Android build `81e28a42` (commit `0dc994e`) carries
the AI layer's screens. The in-app ESPN sign-in and the league list worked on the owner's phone. **Unverified against ESPN:** the
free-agent read and the FREEAGENT add/drop (hand-built fixtures), where ESPN places an add,
and the lineup write itself (still `unverified` in the connector; the Saturday test swap is
the proof). Push needs Firebase (`google-services.json` as an EAS file variable, FCM V1 key).

**Google sign-in (Oct 26): built, not set up, not yet built into an APK.** The code passes the
checks above; nothing has signed in with Google yet. It needs the owner's Google Cloud and
Supabase settings (`docs/DEPLOY.md` §5a–5b; the EAS key's SHA-1 is filled in there), then the
Web client's id in `apps/mobile/eas.json` and a build. Accounts claimed by email before Oct 26
are reached by signing in with Google as the same Gmail address.

**Next, in order:** the owner's Google setup (§5a–5b); the Web client id into `eas.json`; push
and `build_run` the Android preview; the owner signs in with Google on the phone; then the
closed test, after adding Google Play's app-signing SHA-1 as a second Android client. After
that: the Fix it button on the notification (needs push), the Oct 25 mockups' look, real ESPN
captures for the fixtures, and refreshing the five older functions.

Not started: `packages/ui`, `apps/web`, `apps/worker`, `apps/extension`, Sentry.

## Rules

- **ESPN only at launch.** Other providers are "coming soon" entries, not code.
- **No unattended write for an anonymous account.** Enforced in `core`, not the UI.
- **The rules engine decides; AI only picks from the candidates core gives it.** A hole is a
  starter projected for zero (or OUT/IR/suspended/bye); the fix is one bench player in, with
  playing starters shifted along to make room. A playing starter is never benched and a
  lineup with no hole is never touched (owner, Oct 3). A hole is filled automatically even
  after the user undoes the fix in ESPN; only their Decline in the app stops it (owner, Oct 4).
  Anyone ESPN projects can fill a hole: questionable when nobody healthy can, doubtful as the
  last resort (Oct 4; `docs/DECISIONS.md`). A questionable starter ESPN still projects is the
  user's call at every level: **the AI never overrules a choice** (owner, Oct 25).
- **The No-Cray Rules are code** (`docs/AI-NATIVE.md`, `packages/core/src/outside.ts`), never
  prompt text: an add only for a hole, drops only from the Droppable switches, never a playing
  starter, never a player who will be back, never anyone most ESPN leagues roster, judged on
  the rest of the season, a real upgrade, never a position left short, free agents only, no
  churn, and when in doubt a question for the user. A rule that fails for want of ESPN data
  or the Droppable switch is a question; every other rule stands whoever asks.
- **A write is not a success until a fresh read shows it.** An add is three writes (IR move,
  add/drop, lineup), each read back before the next.
- **Never log a request to ESPN.** It carries the user's cookies. The AI sees players,
  statuses, projections and kickoffs: never a cookie, never an email. Log AI errors by name.
- **Team ids are not 1..N, and a negative player id is real** (every D/ST).
- An ESPN status we have not mapped is `unknown`, and `unknown` never moves a player.
- **A player projected for zero points is never moved into the lineup** (owner, Oct 3):
  not automatically, not as a proposal, not as an option. A missing projection is not zero.
- Runs on Node 22.18+ with native TypeScript type stripping: import with `.ts`
  extensions, and no enums, namespaces or parameter properties (`erasableSyntaxOnly`).
- After changing `packages/*/src`, run `npm run functions:build`: the Edge Functions deploy
  from their committed copies, and `npm test` fails while they are stale. The deploy itself
  goes through `npm run functions:bundle` and `functions:compile` (`docs/DEPLOY.md`).
- `verify_jwt` stays off for every Edge Function; each checks its caller in code.
- The app imports only **types** from `@rosterbots/*`; no server code goes into the bundle.
- **No attribution lines in commits or PRs** (owner, Oct 25): no Co-Authored-By, no
  "Generated with" footer.
