# Architecture

Read `PRODUCT.md` first. The one sentence that shapes everything here: **the rules engine
is in charge; AI is a specialist that gets called when needed.**

## Shape

```
  extension ──(ESPN cookies, once)──▶ web /api/connections/espn ──▶ Supabase (Vault)
                                                                       ▲   │
  mobile ◀──(Expo push)── worker ──(reads/writes rosters)──▶ ESPN      │   │
  web    ◀──(Supabase, RLS)─────────────────────────────────────────── ┘   │
                          worker ◀──(connections, settings, credentials)───┘
```

One worker does all the watching and all the acting. Clients never talk to ESPN, never
hold an ESPN credential, and never call OpenAI. They read and write their own rows in
Supabase under Row Level Security, and they receive pushes.

## Packages

| Package | What it is | Depends on |
|---|---|---|
| `packages/core` | Domain types and **the rules engine**. Pure functions: roster in, findings and a plan out. No I/O. | nothing |
| `packages/football-data` | NFL facts: team abbreviations, positions, and the `GameDayFeed` interface for a future data provider. | nothing |
| `packages/connectors` | Fantasy platforms behind one `Connector` interface. ESPN only, ported from Megacast. Translates between ESPN's numbers and core's types in both directions. | core, football-data |
| `packages/ai` | The judgment call. OpenAI Responses API with a strict JSON schema. The model **chooses among candidates core supplied**; it cannot invent a move. | core |
| `packages/ui` | Brand tokens and user-facing copy shared by web, mobile and extension. | core |
| `packages/config` | Shared TypeScript config. | |

| App | What it is |
|---|---|
| `apps/worker` | Long-running Node process. Schedules and runs `runConnection` for every active league connection. The only holder of the Supabase service-role key, the OpenAI key and decrypted ESPN cookies. |
| `apps/web` | Next.js. Sign-in, connections, authority settings, the activity log. Also the endpoint the extension posts cookies to. |
| `apps/mobile` | Expo. The same screens as web, plus push registration and approve/decline on proposals. |
| `apps/extension` | Manifest V3. Reads the two ESPN cookies when the user clicks Connect, and sends them to the web endpoint with the user's Supabase session. |

## The engine

`core.evaluate(roster, now, settings)` returns **findings**. Each finding is a problem in a
starting slot, with its fix if one is obvious:

| Finding | Hard or soft | Deterministic fix |
|---|---|---|
| `empty_slot` | hard | the best eligible bench player |
| `starter_on_bye` | hard | the best eligible bench player |
| `starter_out` (OUT, IR, suspended) | hard | the best eligible bench player |
| `starter_doubtful` | soft | none: judgment |
| `starter_questionable` | soft | none: judgment |
| `starter_status_unknown` | soft | none: tell the user |

"Best eligible bench player" means: on the bench, eligible for the slot, not locked, has a
game this week that has not started, not OUT/IR/doubtful. A fix is **obvious** when there
is exactly one such player, or when the top one's projection beats the next by the
configured margin. Otherwise the candidates go to judgment. One bench player is never
promised to two findings. Pinned players are never moved.

`core.plan(finding, authority)` turns a finding into one step:

| Authority | Obvious fix | Judgment needed | Nothing possible |
|---|---|---|---|
| `alert` | notify | notify | notify |
| `confirm` | propose, act on approval | ask AI, propose its pick | notify |
| `autopilot` | **execute**, then notify | ask AI, propose its pick | notify |
| `full` | **execute**, then notify | ask AI, **execute** if confident, else propose | notify |

Every step has a **deadline**: the earliest kickoff among the players it would move. A
proposal nobody answers expires at its deadline and is logged as expired, not silently
dropped.

## The worker's loop, for one connection

1. Load the connection, its authority settings and its decrypted cookies.
2. `connector.getRoster()`. A 401/403 marks the connection `needs_reauth` and pushes.
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
game days, every 2 minutes in the 95 minutes before each kickoff window (the inactives
window).

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
