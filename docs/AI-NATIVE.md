# AI Native: build contract

Draft, Oct 25 2026, for the owner's review. Decisions behind it are in `DECISIONS.md` (Oct 25).
Like `BETA.md`, change this file before changing an interface it describes.

## What it is

The third level of hangover insurance. Auto Protect fixes a broken spot from your own bench.
AI Native also looks outside your roster (free agents, the backup running back), reasons
about timing (the Monday night game, the questionable player in the early London game), and
acts on its own at 15 minutes before kickoff, adding and dropping players if it must.

It is still insurance, not a team manager. It acts only on a **hole**: a starter ESPN projects
for zero, or who is out, injured, suspended, on bye, or an empty slot. It never second-guesses
a player you chose to start.

## The three levels

In-app names are not final. Stored ids stay as they are, so no data migration is needed.

| Level | Stored id | What it does |
|---|---|---|
| **Alert Me** | `ask_me` | Pushes you when a starter is in trouble, with a **Fix it** button on the notification itself: one tap, no need to open the app. Replaces both Alerts and Ask Me; a stored `alerts` reads as `ask_me`. |
| **Auto Protect** | `bench_protection` | Today's Bench Protection. Fills a hole from your bench automatically, from 90 minutes before kickoff. |
| **AI Native** | `ai_rescue` | Everything Auto Protect does, then the AI step at 15 minutes (below). |

Auto Protect and AI Native need a claimed account and one change of yours already seen on
ESPN, as today. AI Native also needs its own opt-in screen that says plainly it may add and
drop players, and which players it may drop.

## One kickoff, start to finish

| When | What happens |
|---|---|
| Any check before game day | A hole is pushed the first time it is seen. |
| T-100 | A questionable or doubtful starter with points is asked about (your call). |
| **T-90** | Auto Protect and AI Native fill holes from the bench, automatically. |
| **T-15** | **AI Native:** fills any hole the bench could not, and may replace a fill RosterBots made with a better free agent. Never touches a player you put in the lineup. |
| T-15 to T-8 | If the AI times out, or a write fails, it tries again on the next minute's check. After T-8 it stops trying; the T-90 bench fix is already in place. |
| T-4 | The last automatic move. Checks run every minute in the last 10 minutes, so a late scratch ESPN shows by then is still fixed. |
| **T-3** | **All clear:** a push saying the lineup is set, or what is still wrong. New for every level. |

Why T-90 still runs for AI Native: if the AI, its provider or the ESPN add fails, the lineup is
already valid. The AI only improves on it or fills what the bench could not.

Time budget at T-15: 11 minutes to the T-4 cutoff, one check a minute. One AI attempt is a
roster read, a free-agent read, the AI's answer (hard limit 60 seconds), the add/drop, the
lineup write and the read that verifies them: one to two minutes at worst.

## Rules the code enforces (not the prompt)

- **The AI picks from candidates the code built.** An answer naming anyone else is
  discarded (`core.afterAi`, as today) and the T-90 fix stands.
- **Outside candidates are free agents only:** not on waivers (they cannot be added on a
  Sunday), game not started, not OUT/IR/suspended, eligible for the slot, projected above zero.
- **Drops come only from your cut list** (owner, Oct 25). With nobody on it, AI Native may
  add only into an open roster spot; anything needing a drop becomes a one-tap suggestion.
- **Never replaces a player you put in the lineup.** Only a hole, or RosterBots' own fill.
- **Every write is verified by a fresh read:** the add, the drop and the lineup move. A
  transaction ESPN does not show is not a success.
- **Counts toward the daily cap** of automatic moves, and obeys every existing guardrail
  (sane read, kickoff known, proven write, claimed account).
- **What the AI provider sees:** your roster's players, statuses, projections and kickoffs,
  and the free-agent candidates. Never ESPN cookies, never your email.

## Interfaces

| Where | Change |
|---|---|
| `packages/core` | `Candidate` gains `add?: Player` and `drop?: Player` (a transaction before the lineup moves). New `outsideCandidates(finding, roster, freeAgents, settings)`. `Settings` gains `cutList: string[]`. `plan` gives AI Native a `consult_ai` step at T-15 for holes the bench could not fill and for RosterBots' own fills. |
| `packages/ai` (new) | Provider-neutral: `interface Judge { pick(input): Promise<AiChoice> }`, one small adapter per provider, model chosen in configuration, structured JSON out, 60-second limit. Server-side only. |
| `packages/connectors` | ESPN `getFreeAgents` (`READ_FREE_AGENTS`) and `addDrop` (`ADD_FREE_AGENT`, `DROP_PLAYER`), both `unverified` until seen working on a real league. |
| `packages/service` | The T-15 AI step inside `protectConnection`, retries to T-8, receipts carrying the AI's reason, and the T-3 all-clear. |
| `supabase/` | A new migration: `connections.cut_list text[]`, and the add and drop permissions. The AI key as a function secret. |
| `apps/mobile` | Level picker with the three names; AI Native opt-in; a cut-list screen; the **Fix it** button on notifications (needs Android push set up first). |

## Open

- **AI provider:** Anthropic is recorded in `STACK.md`; the owner prefers GLM 5.3. Built
  provider-neutral until it is settled. The privacy policy and Data safety form must name it.
- **Post-game waiver suggestions** after an injury: one-tap, later phase.
- **Depth charts** for "the backup RB": ESPN's own player data first; a football data
  provider later if it is not enough.
- **Data for a late scratch faster than ESPN** (the Odunze case): still unpicked.

## Build order

1. This contract, reviewed by the owner.
2. `core`: outside candidates, cut-list drops, the T-15 step, with tests. No network.
3. `packages/ai`: the interface and a fake for tests; the real adapter once the provider is chosen.
4. ESPN free agents and add/drop, against hand-built fixtures until a real read.
5. `service`: the T-15 step, retries, fallback, the T-3 all-clear.
6. Migration, then the app screens.
