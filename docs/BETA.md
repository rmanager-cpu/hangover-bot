# Beta: build contract (Sunday Oct 4, 2026)

The owner wants a phone beta running this weekend, **Android first, iPhone too if Apple
allows**, with **Sunday automation**. This file is the contract every part of the beta is
built to. Change it before changing an interface.

## Scope

| In | Out (later) |
|---|---|
| ESPN sign-in **inside the app** (no desktop, no cookie copying) | Browser extension (optional desktop path, later) |
| League pick, "what we read from ESPN" screen, test swap | Web app |
| Alerts, Ask Me (one-tap approve), Bench Protection (automatic) | AI Rescue, any AI call |
| Scheduled checker, receipts, push | Free agents, drops, IR, waivers |
| Claim account by email code (required for automation) | Apple/Google sign-in, purchases |

AI Rescue is not offered in the beta. A connection that somehow has `ai_rescue` is treated
as `bench_protection` by the service.

## The automation rule for this weekend

Automatic moves only for **hard** problems (a starter ESPN projects for zero points, or
OUT / IR / suspended / bye, or an empty slot; owner, Oct 3: zero is the source of truth)
with a **deterministic** fix (the user's replacement order, else highest projection; the
fix may shift playing starters along to make room, and never benches one),
at Bench Protection, for a **claimed** account, with bench swaps on. A bench player ESPN
projects for zero points is never a candidate, automatic or proposed (owner, Oct 3; a
missing projection is not zero). On top of that, the first-weekend guardrails (`core.guard`):

1. Only inside the window **T-90 to T-4** minutes (owner, Oct 3: T-4, not T-10, so a late
   scratch that ESPN shows after T-10, like Odunze's, can still be fixed), where T is the
   earliest kickoff among the players the move touches (`finding.deadline`). Before T-90: a
   proposal that says it will happen automatically at T-90 ("autoAt"). After T-4: a proposal
   only. The checker looks every minute once any rostered player is within 10 minutes of
   kickoff, so the end of the window gets a look.
2. At most `maxAutoMovesPerDay` (default 3) automatic moves per connection per UTC day.
3. If the ESPN read does not look sane (`core.rosterLooksSane`), or shows no kickoff for
   anyone who could play, it is not a lineup to judge (Oct 3, second review): the check
   fails, nothing is proposed or announced from it, the read is not kept as the last
   roster, and it is read again within 5 minutes. `guard` still turns an execute into a
   proposal when the fresh read taken just before a write looks off.
4. Kickoff unknown for the players a move touches: proposal.
5. **The first automatic move in a league waits for the user's own proof** (owner, Oct 3):
   one change made through RosterBots (the Saturday test swap, or an approved proposal)
   must have shown on a fresh read in that league (`connections.write_verified_at`). Until
   then every automatic move is a proposal that says to do the test swap or approve. The
   receipt for that first change says it is the one that unlocks automatic moves. A test
   swap ESPN does not apply clears the proof again. This is per league, not a feature flag:
   automatic writes are not held behind a proven connector.

Every automatic move is re-validated against a fresh read immediately before the write,
verified by another fresh read after it (`core.applied`), and receipted. The verifying read
is patient (Oct 3, second review): one more try after a 3 s pause on any failure but the
wrong team, and a second look after a pause when the first read does not show the change,
because that verdict is never retried and holds the week; the write itself is never sent
twice. A failed or partial write is never retried automatically: the user gets an
ACTION_FAILED push, and for the rest of that week every automatic move on that connection
is a proposal.

## Core additions (`packages/core`)

```ts
export interface AutomationPolicy { autoFromMinutes: number; autoUntilMinutes: number; maxAutoMovesPerDay: number }
export const BETA_AUTOMATION: AutomationPolicy = { autoFromMinutes: 90, autoUntilMinutes: 4, maxAutoMovesPerDay: 3 };

// The propose step gains an optional `held`:
| { do: "propose"; finding: Finding; candidate: Candidate; source: "rules" | "ai"; held?: { reason: string; autoAt?: string } }

export interface GuardContext { now: Date; autoMovesToday: number; readLooksSane: boolean; policy: AutomationPolicy }
/** Only ever turns an `execute` into a held `propose`. Every other step passes through unchanged. */
export function guard(step: Step, ctx: GuardContext): Step;

/** Non-empty, no duplicate player ids, starting slots known, at most 3 starters OUT/IR/suspended at once. */
export function rosterLooksSane(roster: Roster): boolean;
```

## Service (`packages/service`, new)

Platform-neutral TypeScript (runs under Node for tests and Deno in Edge Functions). No
Supabase or Deno imports: everything outside comes in through `Deps`.

```ts
import type { Authority, AutomationPolicy, Move, Roster } from "@rosterbots/core";
import type { FantasyConnector } from "@rosterbots/connectors";

export type ConnectionStatus = "active" | "needs_reauth" | "paused";
export interface ConnectionRow {
  id: string; userId: string; credentialId: string;
  leagueId: string; season: number;
  teamId: string | null; teamName: string | null; leagueName: string | null;
  status: ConnectionStatus;
  authority: Authority; benchSwaps: boolean; replacementOrder: string[]; maxAutoMovesPerDay: number;
  lastCheckedAt: string | null; nextCheckAt: string | null;
  /** When a change the user made through RosterBots was last seen on a fresh read here; null until then. */
  writeVerifiedAt: string | null;
}

export type ActionKind = "notify" | "wait" | "propose" | "ask_user" | "execute";
export type ActionStatus = "pending" | "approved" | "declined" | "expired" | "superseded" | "done" | "failed";
export interface NewAction {
  connectionId: string; userId: string;
  findingKey: string; period: number;
  kind: ActionKind; status: ActionStatus;
  moves: Move[];
  summary: string;   // one line a person reads: "Start Jaylen Wright at RB instead of De'Von Achane"
  reason: string;    // why: "Achane was ruled OUT"
  deadline: string | null; autoAt: string | null;
  signature: string; // kind + finding key + moves, for dedupe
}
export interface ActionRow extends NewAction {
  id: string; createdAt: string; decidedAt: string | null; executedAt: string | null; result: unknown;
}

export type ActivityType =
  | "STATUS_CHANGED" | "ACTION_REQUIRED" | "ACTION_RECOMMENDED"
  | "ACTION_COMPLETED" | "ACTION_FAILED" | "PREGAME_WARNING";
export interface ActivityEntry { userId: string; connectionId: string; type: ActivityType; title: string; body: string; data?: Record<string, unknown> }

export interface Store {
  dueConnections(nowIso: string, limit: number): Promise<ConnectionRow[]>;
  getConnection(id: string): Promise<ConnectionRow | null>;
  credentials(credentialId: string): Promise<{ swid: string; espnS2: string } | null>;
  accountClaimed(userId: string): Promise<boolean>;
  saveCheck(connectionId: string, patch: { status?: ConnectionStatus; lastCheckedAt: string; nextCheckAt: string; lastRoster?: Roster }): Promise<void>;
  /** A read outside a check (approve, test swap, the app's Read again): keeps last_roster, leaves the schedule alone. */
  saveRoster(connectionId: string, roster: Roster, readAt: string): Promise<void>;
  actionsFor(connectionId: string, findingKey: string, period: number): Promise<ActionRow[]>;
  getAction(id: string): Promise<ActionRow | null>;
  insertAction(a: NewAction): Promise<ActionRow>;
  /** With `onlyIf`, changes the row only while its status is still that one (one conditional UPDATE); returns whether it changed. */
  updateAction(id: string, patch: { status: ActionStatus; result?: unknown; decidedAt?: string; executedAt?: string }, onlyIf?: ActionStatus): Promise<boolean>;
  /** Count of kind 'execute' actions with status 'approved', 'done' or 'failed' created at or after sinceIso: a write in flight counts. */
  autoMovesSince(connectionId: string, sinceIso: string): Promise<number>;
  /** This connection's actions still open, any period: proposals 'pending' and writes in flight ('approved'). Oldest first. */
  openActions(connectionId: string): Promise<ActionRow[]>;
  /** Writes in this period a fresh read did not confirm: kind 'execute' or 'propose' with status 'failed'. */
  failedWrites(connectionId: string, period: number): Promise<number>;
  /** A change of the user's was seen on a fresh read (`at`), or a test swap was not (null). */
  setWriteVerified(connectionId: string, at: string | null): Promise<void>;
  addActivity(e: ActivityEntry): Promise<void>;
  pushTokens(userId: string): Promise<string[]>;
}
export interface Push { send(tokens: string[], msg: { title: string; body: string; data?: Record<string, unknown> }): Promise<void> }
export type ConnectorFactory = (creds: { swid: string; espnS2: string }, season: number) => FantasyConnector;
export interface Deps {
  store: Store; push: Push; connector: ConnectorFactory; now: () => Date; policy: AutomationPolicy;
  /** Waits before a second look at ESPN after one refusal. Defaults to a timer; tests pass one that returns at once. */
  pause?: (ms: number) => Promise<void>;
}

export interface CheckSummary { connectionId: string; outcome: "ok" | "needs_reauth" | "error" | "skipped"; findings: number; executed: number; proposed: number; notified: number; nextCheckAt: string; error?: string }
export function protectConnection(deps: Deps, conn: ConnectionRow): Promise<CheckSummary>;

export type DecisionResult = { ok: true; status: ActionStatus; message: string } | { ok: false; error: string; message: string };
export function decideAction(deps: Deps, userId: string, actionId: string, decision: "approve" | "decline"): Promise<DecisionResult>;

export type SwapResult = { ok: true; message: string; after: ReadSummary } | { ok: false; error: string; message: string };
export function manualSwap(deps: Deps, userId: string, connectionId: string, playerIdA: string, playerIdB: string): Promise<SwapResult>;

/** What the app's "What we read from ESPN" screen shows. */
export interface ReadSummary {
  teamName: string; period: number; readAt: string;
  players: { id: string; name: string; position: string; proTeam: string; slot: string; status: string; kickoff: string | null; bye: boolean; locked: boolean; projection: number | null }[];
  warnings: string[];
}
export function summarizeRead(roster: Roster, now: Date): ReadSummary;

/** Cadence: 1 min if any rostered player kicks off within 10 min (the window runs to T-4); 2 min within 100 min; 15 min within 12 h; else 60 min. Counted from the minute boundary `now` is in, so the cron tick that follows takes it. */
export function nextCheckAt(roster: Roster | null, now: Date): Date;

export function expoPush(fetchImpl?: typeof fetch): Push; // POST https://exp.host/--/api/v2/push/send, channelId "default"
```

`protectConnection`, in order: credentials → connector → `getRoster` (one refusal is read
again after a 3 s pause; a second `AuthError` marks the connection `needs_reauth`, writes
ACTION_REQUIRED "Sign in to ESPN again", pushes, and stops) → incomplete? (`rosterLooksSane`
false, or no kickoff for anyone who could play: outcome `error`, the roster not saved, the
next check within 5 minutes, and on the third in a row the user told once a period) → settle
writes a dead run left in flight → settings (authority, `accountClaimed`, bench swaps, order;
`ai_rescue` treated as `bench_protection`) → `evaluate` → `plan` → `guard` → per step, then
withdraw proposals for problems the read no longer shows:

- **Dedupe** by `signature` against `actionsFor(connection, findingKey, period)`. The same
  step is never announced twice. A pending proposal for the same finding with **different**
  moves is marked `superseded` before the new one is created.
- `notify` / `ask_user` / `wait`: record (status `done`), activity + push once. A pending
  proposal whose moves are still among the finding's candidates is kept, and nothing new is
  said: the user already has the question. One whose fix the engine no longer offers is
  `superseded` first.
- `propose`: record `pending`, activity ACTION_RECOMMENDED + push ("Tap to approve", plus
  "I'll do it automatically at 11:30" when `held.autoAt`). A pending proposal past its
  deadline is marked `expired`.
- `execute`: **re-read**, re-run `evaluate`/`plan`/`guard` on the fresh roster and continue
  only if the same moves still come out as `execute`; then supersede any pending proposal for
  the finding; `setLineup`; re-read; `applied` → `done` + ACTION_COMPLETED receipt, else
  `failed` + ACTION_FAILED. Never retried. (Re-validating first is a correction: superseding
  first withdrew the user's proposal even when re-validation then stopped the write.)

Then `saveCheck` with the roster and `nextCheckAt`. Exceptions other than `AuthError` are
caught per connection (outcome `error`); one bad connection never stops the others.

`decideAction`: the action must belong to `userId` and be `pending`. Decline → `declined`.
Approve → fresh read; every move's player must still be at its `from` slot, unlocked, game
not started, **and the reason must still hold**: `evaluate` on the fresh read must still
give the finding, with these exact moves among its fixes (otherwise `superseded`, with
"not needed any more" or "out of date"); then write, verify, receipt. The approval **is**
the user's authority, so it does not depend on Bench Protection or a claimed account. The
verifying read is kept with `saveRoster`, so Home is not a check behind after the user's
own tap. A change ESPN shows sets `write_verified_at`; the first one's receipt says so.

`manualSwap` (the Saturday test swap): both players on the user's team, both unlocked,
different slots, each eligible for the other's slot, neither on IR (IR is out of scope).
Write both moves, verify, `saveRoster`, receipt. It records no `actions` row, so it never
counts toward the daily limit. A swap ESPN shows sets `write_verified_at` (the first one's
receipt says so); one ESPN does not apply clears it.

## Database (`supabase/migrations`)

All tables RLS-on. Clients use the anon key; Edge Functions use the service role.

| Table | Columns | Client access |
|---|---|---|
| `credentials` | `id uuid pk`, `user_id uuid → auth.users`, `provider text default 'espn'`, `secret_id uuid` (Vault), `status text`, `created_at`, `updated_at`, unique (`user_id`,`provider`) | select own, **not** `secret_id` (column grants); **delete own** ("Forget my ESPN sign-in": cascades to connections, actions and activity, and a trigger removes the Vault secret) |
| `connections` | `id`, `user_id`, `credential_id → credentials`, `provider`, `league_id text`, `season int`, `team_id text`, `team_name`, `league_name`, `status text check (active, needs_reauth, paused)`, `authority text check (alerts, ask_me, bench_protection, ai_rescue) default 'ask_me'`, `bench_swaps bool default true`, `replacement_order text[] default '{}'`, `max_auto_moves_per_day int default 3`, `last_checked_at`, `next_check_at default now()`, `last_roster jsonb`, `last_roster_at`, `write_verified_at`, `created_at`, unique (`user_id`,`league_id`,`season`) | select own; update own **only** `authority`, `bench_swaps`, `replacement_order`, `status` (to `paused` or `active`) |
| `actions` | `id`, `connection_id`, `user_id`, `finding_key`, `period int`, `kind`, `status`, `moves jsonb`, `summary`, `reason`, `deadline`, `auto_at`, `signature`, `created_at`, `decided_at`, `executed_at`, `result jsonb` | select own |
| `activity` | `id`, `user_id`, `connection_id`, `type`, `title`, `body`, `data jsonb`, `created_at` | select own |
| `devices` | `id`, `user_id`, `expo_push_token text unique`, `platform`, `updated_at` | select/insert/update/delete own |

Vault functions, `security definer`, executable by `service_role` only:
`store_credential(p_user uuid, p_provider text, p_secret jsonb) returns uuid` (create or
replace the user's credential for that provider) and `read_credential(p_credential uuid)
returns jsonb` (`{"swid": ..., "espnS2": ...}`). `account_claimed(p_user uuid) returns
boolean` reads `auth.users.is_anonymous`.

Cron: `pg_cron` + `pg_net`, every minute, POST `{project_url}/functions/v1/check` with header
`x-cron-secret`. `project_url` and `cron_secret` are Vault secrets inserted at deploy time,
read by the cron SQL at run time.

## Edge Functions (`supabase/functions`)

Deno. Shared code is copied from `packages/*/src` into `supabase/functions/_shared/` by
`npm run functions:build` (committed; `npm run functions:check` and
`scripts/build-functions.test.ts`, part of `npm test`, check it is in sync). Each function has a
`deno.json` import map for `@rosterbots/*` and `npm:@supabase/supabase-js@2`.

| Function | Auth | Request → response |
|---|---|---|
| `espn-connect` | user JWT | `{swid, espnS2, season?}` → `{credentialId, leagues: LeagueSummary[], leagueLookupFailed}`. The fan-profile lookup never refuses the sign-in (any failure is `leagueLookupFailed`). When the user already watches a league, the cookies are tried against it first: 401 `{error:"espn_rejected"}` keeps the stored sign-in; 502 replaces nothing either. |
| `connection-setup` | user JWT | `{credentialId, leagueId, season?}` → `{connection, read: ReadSummary}` |
| `read` | user JWT | `{connectionId}` → `ReadSummary` (fresh read, saves `last_roster`); 409 `wrong_team` if the sign-in now manages a different team |
| `decide` | user JWT | `{actionId, decision}` → `DecisionResult` |
| `swap` | user JWT | `{connectionId, playerIdA, playerIdB}` → `SwapResult` |
| `check` | `x-cron-secret` | runs `protectConnection` for up to 25 due connections → `{checked, deferred, results: CheckSummary[]}`; 503 `not_configured` while `CRON_SECRET` is unset |

"User JWT" is checked **by the function** (`_lib/auth.ts`, `auth.getUser` on the bearer
token), not by the gateway: `verify_jwt` is off for all six in `config.toml` and on
deploy, because the gateway's check knows only the legacy JWT secret and this project uses
the newer keys. The database key is whichever the runtime provides (`_lib/keys.ts`:
`SUPABASE_SECRET_KEYS`, `SUPABASE_SECRET_KEY`, then the legacy `SUPABASE_SERVICE_ROLE_KEY`).

Every refusal is `{error, message}`, `message` being words the app can show as they are:
400 `bad_request`, 401 `unauthorized` (no user) or `espn_rejected`, 404 `not_found` /
`league_not_found`, 409 `wrong_team`, 422 `not_in_league`, 502 `espn_unavailable`, 500
`internal`. `decide` and `swap` answer 200 with `ok: false` for a refusal, since their results
carry `ok`. `season` defaults to 2026.

**Never log a request to ESPN, its headers, or a credential.** Log connection ids and outcomes only.

## Mobile (`apps/mobile`)

Expo (latest SDK), TypeScript, expo-router. Package / bundle id `com.turbolabs.hangoverbot`.
Brand from the handoff: Midnight `#070A24`, Deep navy `#0C102F`, Turbo purple `#6726E8`,
Electric purple `#7B2FF7`, Turbo orange `#FF7A00`, Action blue `#2962F3`, Paper `#F6F7FB`.

Flow: anonymous Supabase session on first launch → Welcome ("RosterBots. Fantasy help for
real life." / **Sync a League**) → provider list (ESPN; others "Coming soon") → **ESPN sign-in
in a WebView**; when an `espn_s2` cookie exists, read `SWID` + `espn_s2` from the native cookie
store (`@react-native-cookies/cookies`, WebKit store on iOS), falling back to `document.cookie`
→ `espn-connect` → league list (manual league-id entry if lookup failed) → `connection-setup`
→ **What we read** (players, slots, statuses, kickoffs, locks, plus **Test swap**) →
Protection (Alerts / Ask Me / Bench Protection; AI Rescue "Coming soon"; Bench Protection
needs a claimed account) → Claim (email + 6-digit code: `updateUser({email})` then
`verifyOtp({type:'email_change'})`) → Home ("YOU'RE COVERED" or "ACTION NEEDED", next kickoff,
watched starters, protection level, last receipt) · Activity (receipts; proposals with
Approve / Decline) · Settings (protection, replacement order with up/down, sign in to ESPN
again, **Forget my ESPN sign-in**, About).

**Sign in to a claimed account** (Welcome, Settings, and the claim screen when the email
is taken): email + 6-digit code, `signInWithOtp({email, options:{shouldCreateUser:false}})`
then `verifyOtp({type:'email'})`, so a reinstall or a second phone gets the same account
back instead of starting a new anonymous one beside it. Before the code is verified, the
anonymous account's own `credentials` row is deleted, so nothing keeps running as it. The
"Magic Link" email template must carry `{{ .Token }}` too.

Push: `expo-notifications`, token upserted into `devices`. The app creates the Android
channel `default` at high importance before asking for a token, and the service names it on
every push (`expo-notifications` plugin `defaultChannel: "default"` too). Android push needs a Firebase
`google-services.json` (EAS file env var `GOOGLE_SERVICES_JSON`); the app must build and run
without it.

`EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` come from `eas.json` build
profiles (public values). `eas.json` profiles: `preview` (Android APK, internal) and
`production` (iOS, store, for TestFlight).

## As built (Oct 2): where the contract was silent

Each of these was chosen while building and is now part of the contract.

**Guardrails (`core`).** The before-T-90 hold reads "too early for an automatic move". Both
window edges are inside it (exactly T-90 and exactly T-4 still act). `BETA_AUTOMATION` is
frozen; a per-connection limit is a copy, and `connections.max_auto_moves_per_day` overrides
the shared default. "Starting slots known" means `starterSlots` is non-empty and every starter
sits in one of them, no more to a slot than the league has; a wrong rejection only turns an
automatic move into a proposal.

**Service.**
- A decline stands for the week: that finding is never executed automatically afterwards.
  One automatic attempt per finding per period: after a `done` or `failed` execute, a later
  execute for it is a proposal, the **same** moves included (Oct 3, second review: the user
  undoing the move in the ESPN app, or ESPN reverting it, used to be met with silence until
  kickoff), said once with "already tried automatically" or "an earlier change for this
  failed"; only a write still in flight (`approved`) keeps the checker silent. After a
  failed write, the rest of that check proposes only.
- An automatic execute row is inserted as `approved` before the write, then set `done` or
  `failed`, so a crash mid-write cannot lead to a second write.
- Dedupe ignores `superseded` rows, so a withdrawn step that comes back is news again. A
  proposal that promised "automatically at 11:30" and is still only a proposal after 11:30 is
  re-announced once, with the reason.
- Missing credentials, and a read whose team is not the connection's (`WrongTeamError`), are
  treated like `AuthError`: `needs_reauth`, told once. A `needs_reauth` connection is still
  checked, every 5 minutes and silently (a passing refusal costs minutes, not the window),
  sooner on the last whole read's kickoff cadence (every minute inside T-10, Oct 4), and a
  good read makes it `active` again. `paused` is skipped.
- On an `error` outcome the next check is at most 5 minutes away, and on the last whole
  read's kickoff cadence when that is sooner (`ops.retryAt`, `Store.lastRoster`, Oct 4).
- (Oct 4) The automatic window is judged at the cron tick the check belongs to, so the T-4
  check acts. A write ESPN could not be read back on stays `approved` with
  `result.unconfirmed`, and the next check settles it at once (done with a receipt, or failed).
  A fill undone moments after it was made is made again (only a write in flight, or one that
  finished after this run's fresh read began, stops it). When the fresh read before a write
  gives the same hole a different automatic fix, that fix is made. A pending proposal whose
  "automatically at" time has passed is withdrawn when the step becomes a question, and the
  question is asked. Holes the user declined are passed to `evaluate` as `release`.
- (Oct 3) An `execute` row still `approved` after 3 minutes belongs to a run that died
  mid-write: the next check settles it from its own read (receipt if ESPN shows the change,
  ACTION_FAILED if not), and it counts against the day meanwhile. Status changes that race
  (a decline against a supersede, an approval against the checker) are one conditional
  UPDATE each, and the connection's status and protection are read again just before a write.
- (Oct 3) After any failed write in a period, every automatic move on that connection is a
  proposal for the rest of the period, including findings that first appear later.
- (Oct 3) Pending proposals whose problem a whole read no longer shows are withdrawn and said
  once ("No change needed"); ones past their deadline or with a locked player expire quietly.
- (Oct 3, second review) An incomplete read is counted as `notify` rows (status `done`) of a
  finding of its own, `<period>:incomplete_read`; a whole read marks the count's rows
  `superseded` so a run starts again, and the third in a row inserts the told row and says
  STATUS_CHANGED "ESPN's data looks incomplete" once a period. `inform()` names an
  unreadable kickoff when that is why a hard finding is the user's call.
- (Oct 3, second review) Every next check (`nextCheckAt`, the error retry, the sign-out
  retry) is on a minute boundary, so the cron tick that follows takes it.
- Approve also refuses a move whose destination the player cannot fill or that would overfill
  a starting slot: a stale proposal becomes `superseded`, a locked or started one `expired`.
- Receipts use US Eastern time, marked "ET". The app shows times in the phone's own zone.

**Database and functions.**
- `dueConnections` returns `active` and `needs_reauth` connections and leases them (sets
  `next_check_at` 160 seconds ahead; 5 minutes until Oct 4, which could carry a dead run's
  connection past T-4), so two overlapping cron runs cannot take the same league.
  `check` passes it a clock 30 s ahead, so a row due on the minute boundary is not missed by
  the milliseconds between the tick and the function's own clock. It stops starting
  connections after 90 s and hands the rest back.
- `espn-connect` tries the cookies against a league the user already watches before storing
  them (a bad sign-in never replaces a good one; a first sign-in is stored as it is, and
  `connection-setup` is its proof), then makes that user's `needs_reauth` connections
  `active`. The fan-profile lookup, unproven, can only set `leagueLookupFailed`, never refuse.
- Setting a league up again keeps its status: a pause is the user's off switch. Only a
  league waiting for a sign-in resumes, since the setup read is one.
- Stricter than the table: a connection's credential must belong to the same user (composite
  foreign key); check constraints on kinds, statuses and activity types; a client may set
  `status` only to `active` or `paused`, and cannot clear `needs_reauth` (only a new ESPN
  sign-in does); a push token moves to whoever signs in on that phone; deleting a credential
  deletes its Vault secret.

**App.** Settings also has a pause switch and "Watch another league". The in-app ESPN sign-in
clears the WebView's cookies before the handover, after it, and when the screen is left, so the
phone keeps no ESPN session and signing in again means typing the ESPN password again. The
cookies are handed over only once two looks two seconds apart have seen the same SWID and
`espn_s2` pair, since ESPN sets a visitor SWID first and the account's SWID and `espn_s2` as
separate steps.
