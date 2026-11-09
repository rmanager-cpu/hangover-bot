# Model bench

Tests other AI models on RosterBots' two AI jobs, against what Claude Sonnet 5.5 does in
production today. Dev tooling only: nothing in `packages/` or `supabase/` imports it, and it
doesn't change which provider production uses (`docs/STACK.md`).

## What gets tested

| Job | When it runs in production | How the bench grades it |
|---|---|---|
| **Judge** | T-90 and T-15, when a starting slot has a hole: picks one candidate the code built, or keeps the bench fill | Against what actually happened: who played, who scored |
| **Advisor** (Roster Advice) | 10 AM ET Tue–Sat and 6 PM Sat: suggests up to 5 moves | Rule checks automatically, then your own blind review |
| **Injury judge** (not built) | Planned: before WaiverBot drops a hurt player, is his season over? | Against what happened: his ESPN game log |
| **Shared research** (not built) | Planned: Sunday, Monday after the late game, early Tuesday, once for everyone; WaiverBot and GameDayBot read its brief | Fact checks automatically (ids, names, labels, sources, byes), coverage counted, then your own read |

Every model gets **production's exact request**: the bench calls `packages/ai` with a fake
fetch, captures the system prompt, input and schema it would send, and sends those to every
model. Answers are parsed by production's own parsers, and scored the way production would
act on them: a name nobody offered is ignored and the bench fill stands, an answer below
the confidence floor (0.8) is a question rather than a move. Change the prompt in
`packages/ai` and the bench tests the new one with no edits here.

## Setup

```
cp .env.example .env    # or edit your existing .env
# add:
OPENROUTER_API_KEY=...  # https://openrouter.ai/keys — one key reaches GPT, Gemini, Grok, GLM, DeepSeek, Kimi
ANTHROPIC_API_KEY=...   # the Claude rows go through packages/ai itself, on your Anthropic credits
```

Node loads it with `--env-file`:

```
node --env-file=.env bench/run.ts judge
```

Models live in `bench/models.json`. Rows marked `"off": true` are skipped unless named with
`--models`. Before spending anything the runner checks every OpenRouter id still exists and
suggests the newest ones if not. To see what's current:

```
node bench/run.ts models            # newest ids and prices from each lab
node bench/run.ts models z-ai x-ai  # just these
```

## Commands

```
node --env-file=.env bench/run.ts judge                       # all graded cases × all models × 3 repeats
node --env-file=.env bench/run.ts judge --models "sonnet-5.5 (prod),grok-4.7" --repeats 5
node --env-file=.env bench/run.ts judge --tag late-scratch    # only cases tagged so
node bench/run.ts judge --dry                                 # how many calls, spending nothing
node --env-file=.env bench/run.ts advice                      # web search off for OpenRouter rows
node --env-file=.env bench/run.ts advice --web                # OpenRouter rows get OpenRouter's web plugin
node bench/run.ts research-case --week 10                     # who the research covers, ESPN's statuses fresh (free, no cookie)
node --env-file=.env bench/run.ts research                    # every model, every tool, the owner's question
node bench/run.ts report bench/results/judge-....jsonl        # re-score a run (after grading more cases)
node bench/review.ts export bench/results/advice-....jsonl    # blind review sheet for the advice
node bench/review.ts tally  bench/results/advice-...-review.csv
node --test bench/test/*.test.ts                              # the bench's own tests, offline
```

Try it offline first, on the made-up examples, with the mock models:

```
node bench/run.ts judge --examples --models mock-best,mock-keep,mock-unsure
```

Each run writes `bench/results/<job>-<time>.jsonl` (every answer, one per line, written as it
arrives) and a `.md` report beside it. `bench/results/` is git-ignored.

## The Judge report

| Column | Means |
|---|---|
| **Right** | Within 2 points (the case's `tolerance`) of the best option that week. |
| **Pts lost / call** | Average points left on the table versus the best option. |
| **Auto duds** | Started a player who didn't play or scored 0, confident enough that production would have done it without asking. **The number that matters most.** |
| Duds | The same, at any confidence. |
| Empty slot | Left a hole unfilled when someone could have filled it. |
| Off-list / No answer | Named a player who wasn't offered, or gave nothing usable. Production keeps the bench fill. |
| Same answer each time | Share of cases where every repeat agreed. |
| Conf. right / wrong | Average confidence on right and wrong picks. If they're close, the model can't tell when it's wrong, and the 0.8 floor won't protect you. |
| Cost / right call | Total cost divided by right answers: the price that matters, not price per token. |

Rows are ordered by Right, then fewest auto duds, then cheapest per right call.

## The replay (speed, and picks that aren't final)

`judge` scores one answer as if it were final. It isn't: inside T-10 the app checks every
minute, and a pick that ESPN later shows OUT is a new hole the next check sees. `replay` runs
the last minutes before a kickoff through the app's real check loop (`protectConnection` on the
repo's own test fakes), with the model as the Judge and every answer costing its real time on
the clock. ESPN's statuses change when the case's timeline says. Nobody taps anything.

```
node --env-file=.env.local bench/run.ts replay --examples
```

| Column | Means |
|---|---|
| **Pts lost / run** | Against the best possible. A wrong pick a later check fixes costs nothing. |
| **Zero in lineup at kickoff** | A player who scored nothing was starting when the slot locked. |
| **Minutes with a hole** | From the first check to kickoff, time a starting slot held a hole the app could see. Lower is faster. |
| AI calls / run | An answer below the confidence floor is only a suggestion, so the next check asks again, every minute until T-3. |
| AI answer avg / p95 | Per call. An answer that lands after T-3 is no move. |
| **no AI (rules only)** | The app with the AI step answering nothing: what the rules do alone. |

Replay cases (`bench/cases/replay/*.json`) carry the whole team, not one question: `start`,
`kickoff`, `roster`, `freeAgents`, `droppable`, a `timeline` of ESPN status changes, and the
`outcome`. The four `example-*` ones are the Judge's scratch trap with the room and ESPN's
timing varied: caught and fixed, caught with no room left to fix it, ESPN too late for T-3,
and OUT before T-15 (the usual case, where the engine never offers him).

## The scratch bench (will he play?)

A **draft of a feature that is not built**: acting on news before ESPN shows a player OUT. The
owner's line for it: "a confirmed out, or a wild confidence score that a player will in fact be
out." Each case is a real game day: the Friday designation, the official inactive list (90
minutes out), and the news as it was published, each item with its time. At T-100 and a minute
after each later item, every model gives its probability that the player sits. It is scored on
what happened (every outcome checked against ESPN's game logs).

```
node --env-file=.env.local bench/run.ts scratch               # real names and hidden names
node --env-file=.env.local bench/run.ts scratch --names hidden
```

| Column | Means |
|---|---|
| **Played, but it would have benched him** | Reached the bar (0.95, the owner's "wild confidence"; or 0.8, today's floor) on a day he played. The worst outcome. |
| **Sat, and it caught it** | Reached the bar before kickoff on a day he sat. |
| Caught on a guess | Reached 0.95 before any report said he was out (`confirmedAt`): right, but a guess. |
| Names | Real, or hidden behind Player A / Team A / Team B (and coaches, cities, fan sites), so the model cannot remember how the day went. A gap between the two is memory, not judgment. |

Cases (`bench/cases/scratch/*.json`, `ScratchCase` in `lib/types.ts`): group A did not play after
game-day doubt (Odunze, ruled out at T-5 after being active, is the anchor), B played despite
it, C carry misleading items (last week's "inactive" showing on this week's game day). The
prompt is the bench's own (`lib/scratch.ts`); when the feature is built, capture its real request
instead, as the Judge's is.

## The injury bench (is his season over?)

A draft of a judgment the app doesn't make yet. WaiverBot may drop a hurt player only when his
season is over (owner, Nov 7), and how to know it is the AI's confidence, not which site said it
(Nov 8: "Let's go by AI confidence... Team site is a wild benchmark to use for the truth"). Each
case is a real injury from a past season, asked on the Tuesday after it (waiver day) and sometimes
once more, from the news as it was published by then. Every model gives its probability that the
player plays no more regular-season games through week 17, and its guess at the week he's back.

```
node bench/run.ts season-check                                   # every case against its ESPN game log (free)
node --env-file=.env.local bench/run.ts season --models "opus-5.5,gpt-6.1-sol"
node --env-file=.env.local bench/run.ts season --names hidden    # only the run a model can't remember
```

| Column | Means |
|---|---|
| **Came back, but it was sure he was done** | Reached 0.95 (the owner's "wild confidence"), or 0.8, and he played again by week 17. RosterBots would have dropped a player who came back. The worst outcome. |
| **Season over, and it was sure** | He didn't play again, and it reached the bar. |
| Brier | Mean squared error of every answer against what happened. Always answering 0.5 scores 0.25. |
| Calibration | Every model's hidden-name answers by how sure they were, and how often the season really was over. 0.95 should mean about 95%. |
| Names | Real, or hidden behind Player A / Team A, coaches and dates taken out, times shown as "3 days before now". |

Cases (`bench/cases/season/*.json`, `SeasonCase` in `lib/types.ts`): group A didn't play again by
week 17, group B did. `season-check` must agree with every case's `backWeek` before a run means
anything.

## The shared research bench (what do I need to know this week?)

A draft of a job that isn't built (owner, Nov 7): one research run a few times a week, for
everyone, instead of every team's Advisor searching on its own. Every model gets the owner's
question word for word, "Tell me what I need to know about week 10, please?", and every player
on the RosterBots rosters and free-agent lists, and returns a brief: facts labeled confirmed
(the team or league, a national newsroom such as ESPN, or the same fact on two or more sites),
reported (one other source) or speculation (a take, not a fact: rankings, start-or-sit calls,
who to add), each with its sources, plus a summary of at most 10 lines (owner, Nov 8). Every tool its provider offers, no search cap,
medium effort for all; Grok is told to search X.

`research-case --week N` builds the case from `cases/advice-live/`, every player once, with
status, % rostered and the week's projection read from ESPN's public player data (no league,
no cookie). Build it right before the run: a brief is only as fresh as the statuses it starts from.

Code checks each fact the way the app would have to before acting on it: the id is one we sent
and the words name him (Roster Advice's own check), "confirmed" is backed by a team, league or
national-newsroom page or by two different sites, every fact
but a bye cites a page, and a bye matches ESPN's schedule. Coverage is counted: the listed
players ESPN shows hurt that a fact covers, and the week's bye teams the brief names. Whether
the facts are true, and are the ones that matter, is yours to read in the run-by-run section.

## Cases

### Judge cases (`bench/cases/judge/*.json`)

```json
{
  "id": "2026-w9-achane-out",
  "tags": ["rb", "late-scratch"],
  "input": { "problem": "...", "slot": "RB", "now": "...", "kickoff": "...", "benchFill": { "name": "...", "projection": 6.1 }, "candidates": [ ... ] },
  "benchFillId": "4430807",
  "outcome": { "4430807": 5.4, "4362628": 14.2, "4567048": "DNP" },
  "tolerance": 2
}
```

- `input` is exactly what production sends the Judge (`JudgeInput` in `packages/core/src/ai.ts`).
- `outcome` is what each candidate and the bench fill scored in the league's scoring, or
  `"DNP"`. A case runs only once every candidate has an outcome; `--ungraded` overrides.
- `benchFillId` is the bench fill's player id, when there was one. Leave it out when the slot
  had no fix: then keeping or not answering scores 0.
- Hard cases are worth the most: game-time decisions, a player ruled out an hour before
  kickoff, a questionable starter who sat, a free agent who is only a marginal upgrade.

You need **30 or more graded cases** before the differences mean much; with fewer, one lucky
answer swings a model by several points. The four `example-*` cases are made up, to test the
bench, and are skipped unless `--examples`.

### Advice cases (`bench/cases/advice/*.json`)

`{ "id", "input" }`, where `input` is an `AdviceInput` (`packages/core/src/ai.ts`). No answer key:
the report flags rule breaks (ids that aren't there, waiver adds, dropping a playing starter or
a player rostered in 65%+ of leagues, injury claims with no source), and `review.ts` gives you a
sheet with model names hidden behind letters to score 1–5 yourself.

## Where real cases come from

**Shadow mode, live Sundays** (the honest test, and the only fair one for breaking news):
`bench/shadow.ts` has `shadowJudge(primary, shadows, sink, background)`, a Judge that answers
with the primary model at once and asks the others on the side, then logs the input and every
answer. `node bench/shadow.ts import <log.jsonl>` turns the log into ungraded cases plus a
results file; grade the cases Monday and `node bench/run.ts report` ranks every model on real
decisions.

**It is not wired in.** Doing so means calling other providers from the `check` Edge Function,
which `docs/STACK.md` doesn't list, so it's the owner's call. If yes: in
`supabase/functions/_lib/deps.ts`, wrap the Judge from `anthropicAi(...)` with `shadowJudge`,
using OpenRouter judges built the way `bench/lib/providers.ts` builds them, `sink` inserting
into a small table, and `background` as `(p) => EdgeRuntime.waitUntil(p)`. The Judge only runs
on a hole in an AI Native league, so expect a handful of cases a Sunday from the closed test.

**By hand, from past weeks:** a hole you remember, with the candidates the code would have
offered and what they scored.

## Caveats

- **Grok's X advantage isn't tested by this.** Through OpenRouter, Grok is the model; its live
  X search is xAI's own tool on xAI's own API. A fair test of the news edge needs an `xai`
  provider here, run on the Advisor, and shadow mode for the Judge.
- **Web search isn't apples to apples.** Production's Claude searches as it goes (up to 6
  searches); OpenRouter's web plugin searches once, up front, with its own engine. Compare
  `--web` rows with each other; compare against the prod row with care.
- **Cost:** a Judge call is a few thousand tokens. At frontier prices (around $2 in / $10 out
  per million), 40 cases × 3 repeats comes to roughly a dollar per model, more for models that
  think at length. The Advisor costs more per call; web searches are billed on top and counted
  in the Searches column. Run `--dry` first.
- **The direct Anthropic rows** are priced from OpenRouter's listing for the same model
  (`priceFrom` in models.json), tokens only.
