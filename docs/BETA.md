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

Automatic moves only for **hard** problems (starter OUT / IR / suspended / bye, or an empty
slot) with a **deterministic** fix (the user's replacement order, else highest projection),
at Bench Protection, for a **claimed** account, with bench swaps on. On top of that, the
first-weekend guardrails (`core.guard`):

1. Only inside the window **T-90 to T-10** minutes, where T is the earliest kickoff among the
   players the move touches (`finding.deadline`). Before T-90: a proposal that says it will
   happen automatically at T-90 ("autoAt"). After T-10: a proposal only.
2. At most `maxAutoMovesPerDay` (default 3) automatic moves per connection per UTC day.
3. If the ESPN read does not look sane (`core.rosterLooksSane`), no automatic move: proposal.
4. Kickoff unknown: proposal.

Every automatic move is re-validated against a fresh read immediately before the write,
verified by another fresh read after it (`core.applied`), and receipted. A failed or partial
write is never retried automatically: the user gets an ACTION_FAILED push.

## Core additions (`packages/core`)

```ts
export interface AutomationPolicy { autoFromMinutes: number; autoUntilMinutes: number; maxAutoMovesPerDay: number }
export const BETA_AUTOMATION: AutomationPolicy = { autoFromMinutes: 90, autoUntilMinutes: 10, maxAutoMovesPerDay: 3 };

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
  updateAction(id: string, patch: { status: ActionStatus; result?: unknown; decidedAt?: string; executedAt?: string }): Promise<void>;
  /** Count of kind 'execute' actions with status 'done' or 'failed' and executedAt >= sinceIso. */
  autoMovesSince(connectionId: string, sinceIso: string): Promise<number>;
  addActivity(e: ActivityEntry): Promise<void>;
  pushTokens(userId: string): Promise<string[]>;
}
export interface Push { send(tokens: string[], msg: { title: string; body: string; data?: Record<string, unknown> }): Promise<void> }
export type ConnectorFactory = (creds: { swid: string; espnS2: string }, season: number) => FantasyConnector;
export interface Deps { store: Store; push: Push; connector: ConnectorFactory; now: () => Date; policy: AutomationPolicy }

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

/** Cadence: 2 min if any rostered player kicks off within 100 min; 15 min if any kicks off within 12 h; else 60 min. */
export function nextCheckAt(roster: Roster | null, now: Date): Date;

export function expoPush(fetchImpl?: typeof fetch): Push; // POST https://exp.host/--/api/v2/push/send, channelId "default"
```

`protectConnection`, in order: credentials → connector → `getRoster` (an `AuthError` marks
the connection `needs_reauth`, writes ACTION_REQUIRED "Sign in to ESPN again", pushes, and
stops) → `rosterLooksSane` → settings (authority, `accountClaimed`, bench swaps, order;
`ai_rescue` treated as `bench_protection`) → `evaluate` → `plan` → `guard` → per step:

- **Dedupe** by `signature` against `actionsFor(connection, findingKey, period)`. The same
  step is never announced twice. A pending proposal for the same finding with **different**
  moves is marked `superseded` before the new one is created.
- `notify` / `ask_user` / `wait`: record (status `done`), activity + push once.
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
not started; then write, verify, receipt. The approval **is** the user's authority, so it does
not depend on Bench Protection or a claimed account. The verifying read is kept with
`saveRoster`, so Home is not a check behind after the user's own tap.

`manualSwap` (the Saturday test swap): both players on the user's team, both unlocked,
different slots, each eligible for the other's slot, neither on IR (IR is out of scope).
Write both moves, verify, `saveRoster`, receipt. It records no `actions` row, so it never
counts toward the daily limit.

## Database (`supabase/migrations`)

All tables RLS-on. Clients use the anon key; Edge Functions use the service role.

| Table | Columns | Client access |
|---|---|---|
| `credentials` | `id uuid pk`, `user_id uuid → auth.users`, `provider text default 'espn'`, `secret_id uuid` (Vault), `status text`, `created_at`, `updated_at`, unique (`user_id`,`provider`) | select own, **not** `secret_id` (column grants) |
| `connections` | `id`, `user_id`, `credential_id → credentials`, `provider`, `league_id text`, `season int`, `team_id text`, `team_name`, `league_name`, `status text check (active, needs_reauth, paused)`, `authority text check (alerts, ask_me, bench_protection, ai_rescue) default 'ask_me'`, `bench_swaps bool default true`, `replacement_order text[] default '{}'`, `max_auto_moves_per_day int default 3`, `last_checked_at`, `next_check_at default now()`, `last_roster jsonb`, `last_roster_at`, `created_at`, unique (`user_id`,`league_id`,`season`) | select own; update own **only** `authority`, `bench_swaps`, `replacement_order`, `status` (to `paused` or `active`) |
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
| `espn-connect` | user JWT | `{swid, espnS2, season?}` → `{credentialId, leagues: LeagueSummary[], leagueLookupFailed}`; 401 `{error:"espn_rejected"}` on `AuthError` |
| `connection-setup` | user JWT | `{credentialId, leagueId, season?}` → `{connection, read: ReadSummary}` |
| `read` | user JWT | `{connectionId}` → `ReadSummary` (fresh read, saves `last_roster`); 409 `wrong_team` if the sign-in now manages a different team |
| `decide` | user JWT | `{actionId, decision}` → `DecisionResult` |
| `swap` | user JWT | `{connectionId, playerIdA, playerIdB}` → `SwapResult` |
| `check` | `x-cron-secret` (verify_jwt off) | runs `protectConnection` for up to 25 due connections → `{checked, deferred, results: CheckSummary[]}` |

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

Flow: anonymous Supabase session on first launch → Welcome ("HangoverBot. Fantasy help for
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
again, About).

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
window edges are inside it (exactly T-90 and exactly T-10 still act). `BETA_AUTOMATION` is
frozen; a per-connection limit is a copy, and `connections.max_auto_moves_per_day` overrides
the shared default. "Starting slots known" means `starterSlots` is non-empty and every starter
sits in one of them, no more to a slot than the league has; a wrong rejection only turns an
automatic move into a proposal.

**Service.**
- A decline stands for the week: that finding is never executed automatically afterwards.
  One automatic attempt per finding per period: after a `done` or `failed` execute, a later
  execute for it is a proposal. After a failed write, the rest of that check proposes only.
- An automatic execute row is inserted as `approved` before the write, then set `done` or
  `failed`, so a crash mid-write cannot lead to a second write.
- Dedupe ignores `superseded` rows, so a withdrawn step that comes back is news again. A
  proposal that promised "automatically at 11:30" and is still only a proposal after 11:30 is
  re-announced once, with the reason.
- Missing credentials, and a read whose team is not the connection's (`WrongTeamError`), are
  treated like `AuthError`: `needs_reauth`, told once. A `needs_reauth` connection is still
  checked, hourly and silently, and a good read makes it `active` again. `paused` is skipped.
- On an `error` outcome the next check is at most 5 minutes away.
- Approve also refuses a move whose destination the player cannot fill or that would overfill
  a starting slot: a stale proposal becomes `superseded`, a locked or started one `expired`.
- Receipts use US Eastern time, marked "ET". The app shows times in the phone's own zone.

**Database and functions.**
- `dueConnections` returns `active` and `needs_reauth` connections and leases them (sets
  `next_check_at` 5 minutes ahead), so two overlapping cron runs cannot take the same league.
  `check` stops starting connections after 90 s and hands the rest back.
- `espn-connect` tries the cookies against ESPN before storing them (a bad sign-in never
  replaces a good one), then makes that user's `needs_reauth` connections `active`. An empty
  league list sets `leagueLookupFailed`, so the app offers league-id entry.
- Stricter than the table: a connection's credential must belong to the same user (composite
  foreign key); check constraints on kinds, statuses and activity types; a client may set
  `status` only to `active` or `paused`, and cannot clear `needs_reauth` (only a new ESPN
  sign-in does); a push token moves to whoever signs in on that phone; deleting a credential
  deletes its Vault secret.

**App.** Settings also has a pause switch and "Watch another league". The in-app ESPN sign-in
clears the WebView's cookies before and after the handover, so the phone keeps no ESPN session
and signing in again means typing the ESPN password again.
