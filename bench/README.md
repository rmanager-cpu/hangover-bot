# Model bench

Tests other AI models on RosterBots' two AI jobs, against what Claude Sonnet 5.5 does in
production today. Dev tooling only: nothing in `packages/` or `supabase/` imports it, and it
doesn't change which provider production uses (`docs/STACK.md`).

## What gets tested

| Job | When it runs in production | How the bench grades it |
|---|---|---|
| **Judge** | T-90 and T-15, when a starting slot has a hole: picks one candidate the code built, or keeps the bench fill | Against what actually happened: who played, who scored |
| **Advisor** (Roster Advice) | 10 AM ET Tue–Sat and 6 PM Sat: suggests up to 5 moves | Rule checks automatically, then your own blind review |

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
