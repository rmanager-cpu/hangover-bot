# Architecture

Read `PRODUCT.md` and the handoff first; `DECISIONS.md` says where this departs from it. The one sentence that shapes everything here: **the rules engine
is in charge; AI is a specialist that gets called when needed.**

## As built: the beta

```
 Phone app (Expo) ──own rows, RLS──▶ Supabase Postgres (5 tables, Vault)
   └──▶ Edge Functions: espn-connect, connection-setup,         ▲
        read, decide, swap, delete-account ─────────────────────┤
 pg_cron, every minute ──▶ check ──▶ ESPN (read, lineup write)  │
                             ├──────────────────────────────────┘
                             └──▶ Expo push ──▶ phone
```

The beta has no worker, web app or extension. Supabase Cron calls the `check` Edge Function
every minute; it runs `protectConnection` (`packages/service`) for each league that is due.
Phone actions that need ESPN (sign-in handover, league setup, a fresh read, approving a
proposal, the test swap) are Edge Functions that check the caller's session themselves.
`packages/service` runs in Node for the tests and in Deno in the functions, from committed
copies in `supabase/functions/_shared`. The functions, tables and requests are listed in
`BETA.md`; the deploy is `DEPLOY.md`.

The shape below is the target after the beta. The engine, the loop and the data rules apply
to both.

## Target shape (after the beta)

```
  extension ──(ESPN cookies, once)──▶ web /api/connections/espn ──▶ Supabase (Vault)
                                                                       ▲   │
  mobile ◀──(Expo push)── worker ──(reads/writes rosters)──▶ ESPN      │   │
  web    ◀──(Supabase, RLS)─────────────────────────────────────────── ┘   │
                          worker ◀──(connections, settings, credentials)───┘
```

One worker does all the watching and all the acting. Clients never talk to ESPN, never
hold an ESPN credential, and never call the AI. They read and write their own rows in
Supabase under Row Level Security, and they receive pushes.

## Packages

| Package | What it is | Depends on |
|---|---|---|
| `packages/core` | Domain types and **the rules engine**. Pure functions: roster in, findings and a plan out. No I/O. | nothing |
| `packages/football-data` | NFL facts: team abbreviations, positions, and the `GameDayFeed` interface for a future data provider. | nothing |
| `packages/connectors` | Providers behind one `FantasyConnector` interface with capability flags (handoff section 14). ESPN only at launch, ported from Megacast; the rest are listed as coming soon. | core |
| `packages/ai` | The judgment call. Anthropic Claude API with structured outputs (a strict JSON schema); the model tier per route is configuration. The model **chooses among candidates core supplied**; it cannot invent a move. | core |
| `packages/ui` | Brand tokens and user-facing copy shared by web, mobile and extension. | core |
| `packages/config` | Shared TypeScript config. | |

| App | What it is |
|---|---|
| `apps/worker` | Long-running Node process. Schedules and runs `runConnection` for every active league connection. The only holder of the Supabase service-role key, the Anthropic API key and decrypted ESPN cookies. |
| `apps/web` | Next.js. Sign-in, connections, authority settings, the activity log. Also the endpoint the extension posts cookies to. |
| `apps/mobile` | Expo. The same screens as web, plus push registration and approve/decline on proposals. |
| `apps/extension` | Manifest V3. Reads the two ESPN cookies when the user clicks Connect, and sends them to the web endpoint with the user's Supabase session. |

## The engine

`core.evaluate(roster, now, settings)` returns **findings**. Each finding is a problem in a
starting slot, with its fix if the rules have one:

| Finding | Hard or soft | Deterministic fix |
|---|---|---|
| `empty_slot` | hard (a hole) | one bench player in, playing starters shifted to make room |
| `starter_on_bye` | hard (a hole) | the same |
| `starter_out` (OUT, IR, suspended) | hard (a hole) | the same |
| `starter_zero` (ESPN projects 0 points) | hard (a hole) | the same |
| `starter_doubtful` | soft | none: judgment |
| `starter_questionable` | soft | none: judgment |
| `starter_status_unknown` | soft | none: tell the user |

A playing starter is never benched and a lineup with no hole is never touched. Who may
fill a hole (questionable when nobody healthy can, doubtful as the last resort; never
anyone projected for zero) is in `DECISIONS.md`, Oct 3 and 4.

Ranking follows handoff section 9, as amended Oct 3 and 4: eligible for the slot, not locked
or started, not OUT/IR, never projected for zero; healthy players before questionable, and
doubtful only as the last resort; then the user's replacement order; then the highest
projection. The rules have the answer when the top
player is clean and is ranked by something real. With no order and no projections it
is a judgment call. One bench player is never promised to two findings.

`core.plan(finding, settings, now)` turns a finding into one step. The authority used is
`effectiveAuthority()`: **an unclaimed account is capped at Ask Me.**

| Authority | Rules have the answer | Judgment needed | Nothing possible |
|---|---|---|---|
| Alerts | notify | notify | notify |
| Ask Me | propose, act on approval | ask the user, options laid out | notify |
| Bench Protection | **execute**, then receipt | ask the user, options laid out | notify |
| AI Rescue | **execute**, then receipt | consult AI: execute if confident, else propose | notify |

A soft problem (questionable, doubtful) is a `wait` until 100 minutes before kickoff.
Automatic execution also needs the matching permission toggle (bench swaps today; IR,
free-agent adds and drops arrive with Phase 2 and 6).

Every step has a **deadline**: the earliest kickoff among the players it would move. A
proposal nobody answers expires at its deadline and is logged as expired, not silently
dropped.

## The loop, for one connection

In the beta this is `protectConnection`, run by the `check` Edge Function; later it moves to
the worker. Step 4 is not in the beta, which makes no AI calls: a judgment step asks the user.

1. Load the connection, its authority settings and its decrypted cookies.
2. `connector.getRoster()`. A 401/403 is read again after a short pause; a second one
   marks the connection `needs_reauth` and pushes, once.
3. `evaluate`, then `plan` each finding.
4. For judgment steps, call `ai.judge` with the candidates. Its answer is validated
   against them; anything else is discarded and the step falls back to notify.
5. Execute only steps the authority allows. After a write, **re-read the roster** and record
   success only if the slots actually changed (the Megacast rule).
6. Record every finding, step and outcome in `activity`, and push the user one message
   per outcome, in plain words.

Findings are keyed by `(connection, period, kind, player)` so a re-run is idempotent: the
same problem is not re-announced every five minutes.

Cadence is per connection and tightens toward kickoff: hourly midweek, every 15 minutes on
game days, every 2 minutes in the 100 minutes before each kickoff (the inactives window),
every minute in the last 10 (the automation window ends at T-4).

## Data (Supabase)

See `supabase/migrations/`. Every table a client can read has RLS keyed to `auth.uid()`.
ESPN cookies live in **Supabase Vault**; the table holds only the Vault secret id, and the
read function is executable by `service_role` alone.

## Rules that hold everywhere

- **Never log a request to ESPN.** It carries the user's cookies.
- **AI picks from a list; it never writes a move.** Validated in code, not by prompt.
- **A write is not a success until a fresh read shows it.**
- **Nothing reaches a user that the engine did not decide.** AI text appears only as the
  stated reason for a pick it was allowed to make.
