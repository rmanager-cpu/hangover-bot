// Shapes the bench passes around. A case is one real decision with its answer key; a record
// is one model's answer to one case, one line of a results file.

import type { Advice, AdviceInput, JudgeInput } from "@rosterbots/core";

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
}

/** What one call came back with. `answer` undefined is no usable answer, as production sees it. */
export interface Call<T> {
  answer: T | undefined;
  latencyMs: number;
  usage: Usage;
  /** A short name, never a body. */
  error?: string;
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
}

export type RunRecord = JudgeRecord | AdviceRecord;
