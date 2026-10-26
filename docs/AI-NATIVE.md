# AI Native: build contract

Draft, Oct 25 2026, revised the same day with the owner's direction, and **built later that
day** (see "As built" at the end). Decisions behind it are in `DECISIONS.md` (Oct 25). Like
`BETA.md`, change this file before changing an interface it describes. Model: **Claude
Sonnet 5.5** (`claude-sonnet-5-5`), Anthropic, id in configuration (`ANTHROPIC_MODEL`).

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
23, is not RosterBots' concern. A questionable starter ESPN still projects is the user's
call at every level: the AI only ever judges a hole.

## The three levels

In-app names are the owner's, Oct 25. Stored ids stay as they are, so no data migration is needed.

| Level | Stored id | What it does |
|---|---|---|
| **Alert Me** | `ask_me` | One option for "tell me" and "ask me first" (owner): pushes you when a starter is in trouble, with the fix one tap away in the app. A stored `alerts` reads as `ask_me`. (A Fix it button on the notification itself needs Android push first.) |
| **Auto Protect** | `bench_protection` | Fills a hole from your bench automatically, from 90 minutes before kickoff. |
| **AI Native** | `ai_rescue` | Everything Auto Protect does, the T-15 step, and Roster Advice. |

Auto Protect and AI Native need a claimed account and one change of yours already seen on
ESPN, as today. An unclaimed AI Native account gets Alert Me's behaviour and nothing from
outside the roster.

## Choosing AI Native: one screen, droppable or not

Selecting AI Native opens **one screen** listing every player on your roster with a switch:
**Droppable** or **Not droppable** (owner, Oct 25; replaces the cut list). Everyone starts as
Not droppable, and so does anyone RosterBots adds later. It says plainly that AI Native may
add and drop players, and only ever drops a player switched to Droppable. Change it any time
in Settings. Saving the screen is what turns AI Native on (`connections.droppable` and
`authority` in one update).

## One kickoff, start to finish

| When | What happens |
|---|---|
| Any check before game day | A hole is pushed the first time it is seen. |
| T-100 | A questionable or doubtful starter with points is asked about (your call). |
| **T-90** | Auto Protect and AI Native fill holes from the bench, automatically. A hole whose bench options all have something to doubt and no projection: AI Native asks the AI which; below it, the user. |
| **T-15** | **AI Native:** fills any hole the bench couldn't, or replaces RosterBots' own fill with a clearly better free agent. Never touches a player you put in the lineup. |
| T-15 to T-8 | If the AI times out, or ESPN won't list the free agents, it tries again on the next minute's check (AI Native is checked every minute from T-16). From T-8 the best option is offered for a tap instead. A write ESPN did not apply is a failed write like any other: said once, and nothing more automatic that week. |
| T-4 | The last automatic move. |
| **T-3** | **All clear:** a push saying the lineup is set for that kickoff, or what is still wrong (a locked hole included) and how many moves wait for a tap. Every level, once per kickoff. |

Why T-90 still runs for AI Native: if the AI, Anthropic or the ESPN add fails, the lineup is
already valid. Time budget at T-15: 11 minutes to the cutoff, one check a minute; one attempt
(roster and free-agent reads, the AI's answer with a 60-second limit, the add/drop, the lineup
write, the verifying reads) takes one to two minutes at worst. Measured on Oct 25 with a real
call: the Judge answered in 5 seconds.

## Roster Advice

- **When it runs:** 10 AM Eastern, Tuesday to Saturday (the week's injuries, before the
  waiver run), and 6 PM Eastern Saturday (Sunday's byes and tags). The checker runs it for
  one league per minute, the first time that league is checked after each moment.
- **What it suggests,** each with the reason and its sources:
  - a starter's injury that ESPN hasn't turned into a zero yet, and the fix;
  - a running back who got hurt, yours or any team's, and whether his backup is a free agent
    worth grabbing now, before the waiver run;
  - next week's bye problems ("three starters on bye in Week 9");
  - a position with no backup at all (your only TE, your only QB);
  - a free agent who fits a weak spot better than what you have.
- **One tap** from the **Advice** list carries it out: same checks, same verifying read,
  same receipt as any move. Nothing happens without that tap. An item whose move a rule
  forbids keeps its words and loses its tap (a heads-up); one naming a player who is not
  there is not advice at all.
- **Web search, limited:** Claude's own web search in Anthropic's API (no new vendor), at
  most six searches a run, for injury news, depth charts and named players only. Queries
  never carry your email, league name or anything else about you. Search is billed per use
  on the same key. Measured on Oct 25: one run, two searches, 32 seconds.
- An advice item expires when its moment passes (kickoff, the waiver run).

## The No-Cray Rules (owner, Oct 25)

Enforced in code, not in the prompt (`packages/core/src/outside.ts`, one test per rule in
`test/outside.test.ts`). The AI only picks from options the code built, and the code throws
out anything that breaks a rule. **The goal for every automatic move is one thing: a full
lineup, every starting slot filled by a player who is playing and projected above zero.**
Nothing else.

**Making room, in this order** (owner): an open roster spot needs nothing; else, if an IR
slot is open and a player qualifies for it (ESPN's IR eligibility, and OUT or IR), he moves
to IR, the hole's own starter first; only then a drop, and the drop is the
**out-for-the-season** droppable player if there is one, else the droppable player with the
**lowest rest-of-season value**. Room comes from the bench or from the hole's own starter,
never by emptying another starting slot (a player whose season is over is the one
exception: dead weight wherever he sits). Bench and IR sizes are the league's own, read
from ESPN's settings on every read; without them no spot is ever taken to be open.

1. **Automatic moves only fix a hole.** An add or drop happens on its own only to fill a
   starting slot that would otherwise be empty or score zero at kickoff. Advice waits for
   your tap.
2. **Only players you switched to Droppable.** Everyone starts Not droppable, including
   anyone RosterBots adds.
3. **Never drop a starter who is playing this week.**
4. **Never drop a player who will be back:** questionable, doubtful, out this week, or on IR
   with a return expected. **Out for the season is the first to go** (owner). An automatic
   season-ending drop needs the provider's own data to say so (a structured flag, which ESPN
   does not send, so it never happens there); a report the AI found on the web makes it a
   one-tap suggestion, not a move: the Advisor's word travels on the item, and only the tap
   takes it.
5. **Never drop anyone rostered in more than 65% of ESPN leagues,** Droppable or not, unless
   he is out for the season (dead leagues keep those around 50%; owner).
6. **Judge drops on the rest of the season, never this week alone** (owner). A bye or one bad
   projection never makes a player droppable: he goes on a bye only if he is also the least
   valuable droppable player, or out for the season. Value is ESPN's season projection and
   percent rostered for now; better rankings later.
7. **The add must be a real upgrade:** projected at least 2 points more this week than the
   best bench fill, and above zero, and never worth less for the rest of the season than the
   player dropped for him (unless that player is out for the season).
8. **Never leave a position short:** never drop the only player at a position your lineup
   needs.
9. **Free agents only:** no waiver claims, no FAAB bids, ever.
10. **No churn:** one add/drop per hole, at most two a week, never drop a player added in the
    last 7 days, never re-add a player RosterBots dropped this season.
11. **When in doubt, ask:** anything that fails a rule becomes a one-tap suggestion, never a
    move. In code: the Droppable switch, and data ESPN did not send (percent rostered, a
    rest-of-season projection), are the questions a tap may answer; every other rule stands
    whoever asks.

**Your tap is your call:** a suggestion you approve can drop the player it names. But the AI
only ever suggests drops that pass rules 3 to 10.

## Other rules the code enforces

- **The AI picks from candidates the code built.** An answer naming anyone else is discarded
  (`core.afterAi`, as today) and the T-90 fix stands; an answer below the confidence floor is
  a proposal.
- **Outside candidates are free agents only:** not on waivers, game not started, not
  OUT/IR/suspended/doubtful, eligible for the slot, projected above zero, kickoff known.
- **Every write is verified by a fresh read,** stage by stage: the IR move, the add (with the
  drop), then the lineup move, each read back before the next; the first ESPN does not show
  stops it, and the receipt says how far it got. The option is rebuilt on fresh reads of the
  team and the free agents, under the same rules, before anything is written.
- **Counts toward the daily cap,** and obeys every existing guardrail (sane read, kickoff
  known, proven write, claimed account, the user's Decline, a failed write that week, bench
  swaps on). An add whose lineup move then failed is still an add for the no-churn rule.
- **An add proposal lives as long as its hole, or the fill it would replace:** withdrawn when
  either is gone, and a tap on one is re-checked against the hole first.
- **What Anthropic sees:** your roster's players, statuses, projections and kickoffs, and the
  candidates. Never ESPN cookies, never your email.

## Interfaces, as built

| Where | What |
|---|---|
| `packages/core` | `Player` gains `percentRostered`, `seasonProjection`, `outForSeason`, `byeWeek`; `Roster` gains `benchSlots`, `irSlots`; `FreeAgent`; `Candidate.add?: { to, room }` with `Room` open / ir / drop; `Settings.droppable`. `outside.ts`: `NO_CRAY`, `AI_WINDOW`, `noCray(transaction, context)` → a verdict (ok, or the rule, why, and whether a tap may waive it), `outsideCandidates(freeAgents, context)` → `{ moves, asks, rejected }`. `ai.ts`: `Judge`, `Advisor` and their inputs. `plan` consults the AI for a hole only; `permitted` needs the add and drop permissions for an add. |
| `packages/ai` (new) | `anthropicAi({ apiKey, model?, ... })` → `{ judge, advisor }` over `@anthropic-ai/sdk`: the Judge with structured output (`output_config.format`), the Advisor with `web_search_20260209` and one strict `report_advice` tool, adaptive thinking, `pause_turn` continued. Errors are names only, never bodies. |
| `packages/connectors` | ESPN `getFreeAgents(leagueId, period, { slots?, limit? })` (view `kona_player_info`, header `x-fantasy-filter`), `addDrop(leagueId, { add, drop? }, period)` (the FREEAGENT transaction), percent rostered, season projection, bye week and the league's bench and IR sizes on every read. All `unverified` until seen on a real league. |
| `packages/service` | `check.ts` (what a check carries); `outside.ts` (the T-15 step: targets, the AI, `executeOutside`); `advise.ts` (`adviseConnection`, `adviceDue`); `ops.writeOutsideAndVerify`; the T-3 all-clear in `protect.ts`; `decideAction` approves an add (rebuilt on fresh reads, the rules re-checked); `Deps.ai?: { judge, advisor? }`; a bench move and an add for the same hole are two separate questions. |
| `supabase/` | Migration `20261025000000_ai_native.sql`: `connections.droppable text[]`, `connections.advised_at`; `actions.kind` gains `advise`, `actions."transaction" jsonb`, `actions.sources jsonb`; activity types `ALL_CLEAR`, `ADVICE`. `ANTHROPIC_API_KEY` (and optional `ANTHROPIC_MODEL`) as function secrets; without the key AI Native runs as Auto Protect plus questions. `check` runs one league's advice per minute when due. A new `leagues` function lists the stored sign-in's leagues for "Watch another league". |
| `apps/mobile` | The three levels on Protection; the Droppable screen (`app/droppable.tsx`, AI Native's opt-in); the Advice list (`app/advice.tsx`, Do it / Not now); Settings rows; "Watch another league" lists the leagues, no id to type. The modern look from the Oct 25 mockups is still to do. |

## Open

- **A Fix it button on the notification itself:** needs Android push (Firebase) first.
- **A "Powered by Claude" mark** waits on Anthropic's approval (`DECISIONS.md`).
- **Depth charts:** ESPN's player data and web search first; a data provider later if needed.
- **Data for a late scratch faster than ESPN** (the Odunze case): still unpicked.
- **The Oct 25 mockups' look** for the screens.

## As built (Oct 25)

Built and checked with no network except two real Anthropic calls: `npm test` (291, a test
per No-Cray rule), `npm run typecheck`, Deno check of `check`, `decide`, `leagues` and
`connection-setup` with the SDK under `npm:`, and the offline Android export. Unverified:
ESPN's free-agent payload and the FREEAGENT transaction (hand-built fixtures), and whether
ESPN places an add where the transaction asks (the code copes with the bench either way).
