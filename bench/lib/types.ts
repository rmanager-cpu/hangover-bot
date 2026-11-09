// Shapes the bench passes around. A case is one real decision with its answer key; a record
// is one model's answer to one case, one line of a results file.

import type { Advice, AdviceInput, Authority, FreeAgent, JudgeInput, Roster, Status } from "@rosterbots/core";

export type Via = "openrouter" | "anthropic" | "mock";

/** One entry in bench/models.json. */
export interface ModelEntry {
  /** The label in reports. */
  name: string;
  /** openrouter: any model on OpenRouter. anthropic: the production adapter, unchanged. mock: offline, for testing the bench. */
  via: Via;
  /** The provider's model id (OpenRouter's "author/model", Anthropic's "claude-…", or a mock name). */
  model: string;
  /** OpenRouter's unified reasoning effort. Production runs the Judge at low and the Advisor at medium. */
  reasoning?: "none" | "low" | "medium" | "high";
  /** For a direct Anthropic call: the OpenRouter id whose listed price stands in for its cost. */
  priceFrom?: string;
  /** Skipped unless named with --models. */
  off?: boolean;
  note?: string;
}

/** A Judge case: one hole, the options the code built, and what each option actually scored. */
export interface JudgeCase {
  id: string;
  note?: string;
  /** A made-up case for testing the bench. Left out of runs unless --examples. */
  example?: boolean;
  tags?: string[];
  /** Exactly what production sent the Judge (or would have). */
  input: JudgeInput;
  /** The player id of the bench fill, when there was one: what a null answer keeps. */
  benchFillId?: string;
  /** Fantasy points each candidate and the bench fill scored that week, or "DNP". Empty until graded. */
  outcome: Record<string, number | "DNP">;
  /** Points within the best that still count as right. Default 2. */
  tolerance?: number;
}

/** An Advice case: one advice run's input. Graded by rule checks and blind review, not a key. */
export interface AdviceCase {
  id: string;
  note?: string;
  example?: boolean;
  input: AdviceInput;
}

export interface Usage {
  inputTokens?: number;
  outputTokens?: number;
  /** Dollars, as OpenRouter reports it, or tokens times the listed price. */
  costUsd?: number;
  webSearches?: number;
  webFetches?: number;
}

/** One tool call, as far as the provider itemizes it (Anthropic does; OpenRouter gives counts). */
export interface ToolUse {
  /** web_search, web_fetch, x_search, datetime, … */
  tool: string;
  /** The search words, when the provider says. */
  query?: string;
  /** The page asked for, for a fetch. */
  url?: string;
  /** What came back: the pages found or read. */
  results?: { url: string; title?: string }[];
  error?: string;
}

/** What a model did on the way to its answer: tools, reasoning, and what it wrote besides. */
export interface Trace {
  /** Who served it (OpenRouter routes a model to one of several hosts). */
  provider?: string;
  /** The reasoning the provider shows (Anthropic's summarized thinking, OpenRouter's reasoning text or summaries). */
  reasoning?: string;
  /** Some or all of the reasoning came back encrypted or redacted. */
  reasoningHidden?: boolean;
  /** Each tool call, when itemized. */
  tools: ToolUse[];
  /** Counts by tool from the provider's usage, when calls are not itemized. */
  toolCounts?: Record<string, number>;
  /** The pages the answer drew on, with a snippet (OpenRouter's url_citation annotations). */
  citations?: { url: string; title?: string; snippet?: string }[];
  /** Words written outside the report, or instead of it. */
  text?: string;
  /** The report's raw arguments, when production's parser kept fewer items than the model sent. */
  rawReport?: string;
  /**
   * The research call's report didn't fit production's form (with OpenRouter's server tools the
   * function schema isn't enforced: Nov 7, GPT wrote `detail` for `body`), so a second, forced
   * call put the same advice into the form. Its time and cost are included.
   */
  reformatted?: boolean;
  /** Why the last response stopped. */
  finish?: string;
}

/** What one call came back with. `answer` undefined is no usable answer, as production sees it. */
export interface Call<T> {
  answer: T | undefined;
  latencyMs: number;
  usage: Usage;
  /** A short name, never a body. */
  error?: string;
  trace?: Trace;
}

interface RecordBase extends Usage {
  model: string;
  caseId: string;
  rep: number;
  at: string;
  latencyMs: number;
  error?: string;
}

export interface JudgeRecord extends RecordBase {
  job: "judge";
  /** A candidate's id, null to keep the bench fill, undefined when there was no usable answer. */
  pick?: string | null;
  confidence?: number;
  reason?: string;
}

export interface AdviceRecord extends RecordBase {
  job: "advice";
  items?: Advice[];
  /** "production": the app's request as is. "all": every tool the model's provider offers, no search cap. */
  tools?: "production" | "all";
  trace?: Trace;
}

/**
 * A replay case: the last minutes before one kickoff, run through the app's real check loop
 * with the model as the Judge. Scored on who is in the lineup at kickoff, not on one answer.
 */
export interface ReplayCase {
  id: string;
  note?: string;
  example?: boolean;
  tags?: string[];
  /** When the first check runs. The app's own cadence takes it from there to kickoff. */
  start: string;
  /** When the slot locks: the replay ends here. */
  kickoff: string;
  /** The team as ESPN shows it at `start`. */
  roster: Roster;
  freeAgents: FreeAgent[];
  /** Default ai_rescue (AI Native). */
  authority?: Authority;
  droppable?: string[];
  replacementOrder?: string[];
  /** What ESPN shows, and from when: a player's status and projection change at `at`. */
  timeline: { at: string; playerId: string; status?: Status; projection?: number }[];
  /** Fantasy points each player who could end up in the slot scored, or "DNP". */
  outcome: Record<string, number | "DNP">;
  /** The most the listed players could have scored from the lineup. Default: the best any one of them scored. */
  best?: number;
}

/** One Judge call inside a replay. */
export interface ReplayCall {
  at: string;
  ms: number;
  offered: string[];
  pick?: string | null;
  confidence?: number;
  reason?: string;
  error?: string;
}

export interface ReplayRecord extends RecordBase {
  job: "replay";
  points: number;
  zeroAtLock: boolean;
  holeMinutes: number;
  autoMoves: number;
  aiCalls: ReplayCall[];
  log: string[];
}

/** One piece of game-day news, as a feed would carry it. */
export interface ScratchNews {
  /** When it was published, ISO. Null when no source shows the time: kept for the record, never shown. */
  at: string | null;
  /** "Adam Schefter on X", "RotoWire via CBS", "team". */
  source: string;
  /** The source's own key wording. */
  words: string;
  url?: string;
}

/**
 * A scratch case: one player's game-day news, minute by minute, and whether he played. The
 * model is asked at each moment how sure it is he will not play (a draft of a feature that is
 * not built: acting on news before ESPN shows OUT). Real cases only, every fact with a source.
 */
export interface ScratchCase {
  id: string;
  note?: string;
  example?: boolean;
  tags?: string[];
  /** A: did not play after game-day doubt. B: played despite it. C: a misleading report. */
  group: "A" | "B" | "C";
  player: { name: string; position: string; team: string };
  opponent: string;
  kickoff: string;
  /** Friday's injury report. */
  designation?: "questionable" | "doubtful" | "none";
  /** The official inactive list, about 90 minutes before kickoff. */
  inactiveList?: { at: string; result: "active" | "inactive" };
  news: ScratchNews[];
  /** When the first report that he is out appeared (official or an insider). Acting before it is a guess. */
  confirmedAt?: string;
  /** When to ask. Default: T-100, and a minute after each dated item and the inactive list. */
  asks?: string[];
  outcome: "played" | "did_not_play";
  /** Box score or game log. */
  outcomeSource?: string;
  /** Words to hide in the hidden-names run (team nicknames, cities, a coach), real → stand-in. */
  aliases?: Record<string, string>;
}

export interface ScratchRecord extends RecordBase {
  job: "scratch";
  /** The names were hidden: the model could not know how the day went. */
  hidden: boolean;
  /** The moment asked, ISO. */
  asked: string;
  /** The model's probability that he does not play, 0 to 1. */
  out?: number;
  reason?: string;
}

/** One player the shared research covers: on some RosterBots team, or a free agent one could add. */
export interface ResearchTarget {
  id: string;
  name: string;
  position: string;
  proTeam: string;
  /** ESPN's status when the case was built. */
  status: Status;
  percentRostered?: number;
  byeWeek?: number;
  /** ESPN's projection for the week researched, when it sent one. */
  projection?: number;
  /** On a RosterBots roster, a free agent, or both (in different leagues). */
  on: "roster" | "free agent" | "both";
}

/**
 * A research case: one week's question and everyone it covers (owner, Nov 7: one agent does the
 * research leading up to waiver day, and that's the data each RosterBot goes off). Built from
 * the live advice cases with ESPN's statuses refreshed (run.ts research-case).
 */
export interface ResearchCase {
  id: string;
  note?: string;
  example?: boolean;
  season: number;
  week: number;
  /** The owner's words, as asked. */
  question: string;
  /** When ESPN's statuses were read. */
  builtAt: string;
  targets: ResearchTarget[];
}

export type FactKind = "injury" | "return" | "role" | "trade" | "release" | "suspension" | "bye" | "pickup" | "other";
/** Confirmed: the team or league, a national news organization, or two or more sites; reported, one other source; speculation, a take (owner, Nov 8). */
export type FactTier = "confirmed" | "reported" | "speculation";
export type SourceKind = "team" | "national_insider" | "beat_reporter" | "outlet" | "fantasy_site" | "other";

export interface Fact {
  /** An id from the case, or null for a player not listed or a whole team. */
  playerId: string | null;
  player: string;
  team: string;
  kind: FactKind;
  tier: FactTier;
  sourceKind: SourceKind;
  claim: string;
  sources: string[];
  asOf?: string;
}

export interface Brief {
  summary: string[];
  facts: Fact[];
  /** Facts the model sent that weren't facts (a missing field, an unknown kind): left out. */
  malformed: number;
}

export interface ResearchRecord extends RecordBase {
  job: "research";
  brief?: Brief;
  trace?: Trace;
}

/** A moment the injury bench asks: when, and the NFL week whose games come next. */
export interface SeasonAsk {
  at: string;
  week: number;
}

/**
 * An injury case: is his fantasy season over? One real injury, the news as it was published,
 * and whether he played again by the last week of the fantasy regular season (owner, Nov 8:
 * go by the AI's confidence, not by which site said it). Real cases only, every fact sourced.
 */
export interface SeasonCase {
  id: string;
  note?: string;
  example?: boolean;
  tags?: string[];
  /** A: he did not play again by lastWeek. B: he did. */
  group: "A" | "B";
  season: number;
  player: { name: string; position: string; team: string; espnId?: string };
  /** What he hurt and when, as known at the first ask: "torn ACL, Week 7 (Oct 20)". */
  injury: string;
  /** Usually the Tuesday after the injury, 10 AM ET (waiver day), and at most one later Tuesday. */
  asks: SeasonAsk[];
  /** Everything published by the last ask, oldest first. Each ask sees only what came before it. */
  news: ScratchNews[];
  /** The fantasy regular season's last week: 17. */
  lastWeek: number;
  /** The first regular-season week he played again, or null if not by lastWeek. */
  backWeek: number | null;
  /** His game log for that season. */
  outcomeSource: string;
  /** Words to hide in the hidden-names run (nicknames, cities, coaches, stadiums), real → stand-in. */
  aliases?: Record<string, string>;
}

export interface SeasonRecord extends RecordBase {
  job: "season";
  /** The names were hidden: the model could not know how the season went. */
  hidden: boolean;
  /** The moment asked, ISO. */
  asked: string;
  /** The model's probability that his fantasy season is over, 0 to 1. */
  over?: number;
  /** Its guess at the week he plays again, null for not this season. */
  backWeek?: number | null;
  reason?: string;
}

export type RunRecord = JudgeRecord | AdviceRecord | ReplayRecord | ScratchRecord | ResearchRecord | SeasonRecord;
