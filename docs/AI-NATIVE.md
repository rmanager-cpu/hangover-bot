# AI Native: build contract

Draft, Oct 25 2026, revised the same day with the owner's direction. Decisions behind it are
in `DECISIONS.md` (Oct 25). Like `BETA.md`, change this file before changing an interface it
describes. Model: **Claude Sonnet 5.5** (`claude-sonnet-5-5`), Anthropic, id in configuration.

## What it is

The third level of hangover insurance, with two jobs:

1. **Fix holes, at 15 minutes before kickoff.** Auto Protect fixes a broken spot from your
   bench at T-90. AI Native then looks outside your roster (free agents, the backup running
   back) when the bench couldn't fix it, or when a free agent is clearly better than the
   bench fill RosterBots made. It may add and drop, only within the No-Cray Rules below.
2. **Roster Advice: help you get ahead.** It scans your roster, plus a limited web search,
   and suggests moves on three things: **injuries and bye weeks** (before they bite),
   **team construction** (a position with no backup), and **player fit**. It keeps a special
   eye on **running backs who got hurt**, on your team or any team, and on who backs them up.
   Advice is never automatic: each item has a one-tap action, from the notification or from
   the Advice list. This is the only feature that leaves the app, and the only one close to
   active team management, kept to injuries, byes and staying ahead.

It never second-guesses a healthy starter you chose. Two healthy QBs, one projected 15 and one
23, is not RosterBots' concern.

## The three levels

In-app names are not final. Stored ids stay as they are, so no data migration is needed.

| Level | Stored id | What it does |
|---|---|---|
| **Alert Me** | `ask_me` | Pushes you when a starter is in trouble, with a **Fix it** button on the notification itself. Replaces both Alerts and Ask Me; a stored `alerts` reads as `ask_me`. |
| **Auto Protect** | `bench_protection` | Fills a hole from your bench automatically, from 90 minutes before kickoff. |
| **AI Native** | `ai_rescue` | Everything Auto Protect does, the T-15 step, and Roster Advice. |

Auto Protect and AI Native need a claimed account and one change of yours already seen on
ESPN, as today.

## Choosing AI Native: one screen, droppable or not

Selecting AI Native opens **one screen** listing every player on your roster with a switch:
**Droppable** or **Not droppable** (owner, Oct 25; replaces the cut list). Everyone starts as
Not droppable, and so does anyone RosterBots adds later. It says plainly that AI Native may
add and drop players, and only ever drops a player switched to Droppable. Change it any time
in Settings.

## One kickoff, start to finish

| When | What happens |
|---|---|
| Any check before game day | A hole is pushed the first time it is seen. |
| T-100 | A questionable or doubtful starter with points is asked about (your call). |
| **T-90** | Auto Protect and AI Native fill holes from the bench, automatically. |
| **T-15** | **AI Native:** fills any hole the bench couldn't, or replaces RosterBots' own fill with a clearly better free agent. Never touches a player you put in the lineup. |
| T-15 to T-8 | If the AI times out or a write fails, it tries again on the next minute's check. After T-8 it stops; the T-90 bench fix is already in place. |
| T-4 | The last automatic move. Checks run every minute in the last 10 minutes. |
| **T-3** | **All clear:** a push saying the lineup is set, or what is still wrong. Every level. |

Why T-90 still runs for AI Native: if the AI, Anthropic or the ESPN add fails, the lineup is
already valid. Time budget at T-15: 11 minutes to the cutoff, one check a minute; one attempt
(roster and free-agent reads, the AI's answer with a 60-second limit, the add/drop, the lineup
write, the verifying read) takes one to two minutes at worst.

## Roster Advice

- **When it runs:** after each game window (the injury that happened today), once a day
  midweek, and Saturday evening (byes and questionable tags for Sunday).
- **What it suggests,** each with the reason and its sources:
  - a starter's injury that ESPN hasn't turned into a zero yet, and the fix;
  - a running back who got hurt, yours or any team's, and whether his backup is a free agent
    worth grabbing now, before the waiver run;
  - next week's bye problems ("three starters on bye in Week 9");
  - a position with no backup at all (your only TE, your only QB);
  - a free agent who fits a weak spot better than what you have.
- **One tap** from the push, or from the **Advice** list, carries it out: same checks, same
  verifying read, same receipt as any move. Nothing happens without that tap.
- **Web search, limited:** Claude's own web search in Anthropic's API (no new vendor), for
  injury news, depth charts and named players only. Queries never carry your email, league
  name or anything else about you. Search is billed per use on the same key: check the
  current price before launch.
- An advice item expires when its moment passes (kickoff, the waiver run).

## The No-Cray Rules (proposed, owner to confirm)

Enforced in code, not in the prompt. The AI only picks from options the code built, and the
code throws out anything that breaks a rule. **The goal for every automatic move is one
thing: a full lineup, every starting slot filled by a player who is playing and projected
above zero.** Nothing else.

1. **Automatic moves only fix a hole.** An add or drop happens on its own only to fill a
   starting slot that would otherwise be empty or score zero at kickoff. Advice waits for
   your tap.
2. **Only players you switched to Droppable.** Everyone starts Not droppable, including
   anyone RosterBots adds.
3. **Never drop a starter who is playing this week.**
4. **Never drop an injured player** (questionable, doubtful, out, IR). Injuries heal; dropping
   a hurt star is the classic panic move. Advice may raise it; it never happens on its own.
5. **Never drop anyone rostered in more than half of ESPN leagues,** Droppable or not.
6. **The add must be a real upgrade:** projected at least 2 points more this week than the
   best bench fill, and above zero.
7. **Never leave a position short:** never drop the only player at a position your lineup
   needs.
8. **Free agents only:** no waiver claims, no FAAB bids, ever.
9. **No churn:** one add/drop per hole, at most two a week, never drop a player added in the
   last 7 days, never re-add a player RosterBots dropped this season.
10. **When in doubt, ask:** anything that fails a rule becomes a one-tap suggestion, never a
    move.

**Your tap is your call:** a suggestion you approve can drop the player it names. But the AI
only ever suggests drops that pass rules 3 to 9.

## Other rules the code enforces

- **The AI picks from candidates the code built.** An answer naming anyone else is discarded
  (`core.afterAi`, as today) and the T-90 fix stands.
- **Outside candidates are free agents only:** not on waivers, game not started, not
  OUT/IR/suspended, eligible for the slot, projected above zero.
- **Every write is verified by a fresh read:** the add, the drop and the lineup move.
- **Counts toward the daily cap,** and obeys every existing guardrail (sane read, kickoff
  known, proven write, claimed account).
- **What Anthropic sees:** your roster's players, statuses, projections and kickoffs, and the
  candidates. Never ESPN cookies, never your email.

## Interfaces

| Where | Change |
|---|---|
| `packages/core` | `Candidate` gains `add?: Player` and `drop?: Player`. New `outsideCandidates(finding, roster, freeAgents, settings)` and `noCray(transaction, context)`, one test per rule. `Settings` gains `droppable: string[]`. `plan` gives AI Native a `consult_ai` step at T-15. |
| `packages/ai` (new) | `interface Judge { pick(input): Promise<AiChoice> }` and `interface Advisor { advise(input): Promise<Advice[]> }`, an Anthropic adapter (Sonnet 5.5, structured output, web search for Advisor only, 60-second limit), a fake for tests. Server-side only. |
| `packages/connectors` | ESPN `getFreeAgents` (`READ_FREE_AGENTS`), `addDrop` (`ADD_FREE_AGENT`, `DROP_PLAYER`), and percent rostered per player (rule 5). All `unverified` until seen on a real league. |
| `packages/service` | The T-15 step, retries to T-8, the T-3 all-clear, the advice runs, and executing an advice item on tap. |
| `supabase/` | A migration: `connections.droppable text[]`, an `advice` table, the add and drop permissions. `ANTHROPIC_API_KEY` as a function secret. |
| `apps/mobile` | The three levels; the Droppable screen; the Advice list; Fix it on notifications (needs Android push first). The modern look from the Oct 25 mockups, with the new neon art. |

## Open

- **The No-Cray thresholds:** 50% rostered (rule 5), 2 points (rule 6), two a week (rule 9).
- **A "Powered by Claude" mark** waits on Anthropic's approval (`DECISIONS.md`).
- **Depth charts:** ESPN's player data and web search first; a data provider later if needed.
- **Data for a late scratch faster than ESPN** (the Odunze case): still unpicked.

## Build order

1. This contract, confirmed by the owner (the No-Cray Rules especially).
2. `core`: outside candidates, the No-Cray Rules with a test each, the T-15 step. No network.
3. `packages/ai`: interfaces and a fake; the Anthropic adapter.
4. ESPN free agents, add/drop and percent rostered, against fixtures until a real read.
5. `service`: the T-15 step, retries, fallback, the all-clear, Roster Advice.
6. Migration, then the app screens.
