// Scoring, with no network and no files: pure functions over cases and records.
//
// Judge: every answer is turned into the points the slot would have scored, the way
// production would have acted on it. A null, no answer, or a player who was not offered all
// leave the bench fill in place (production discards an off-list name), so they score the
// bench fill's points, or nothing when there was no bench fill. The worst outcome is a dud:
// starting a player who did not play, or scored nothing, when someone else did. A dud at or
// above the confidence floor would have been made automatically.
//
// Advice has no answer key. Each item is checked against what the input says (the ids are
// real, the add is a free agent, the drop is allowed), mirroring how production treats it:
// an unknown id is thrown out, a rule break loses its one-tap action. Quality is for a human:
// see review.ts.

import type { Advice, AdviceInput } from "@rosterbots/core";
import type { AdviceRecord, JudgeCase, JudgeRecord } from "./types.ts";

/** The user's default `minAiConfidence` (packages/core): at or above it, an answer is a move. */
export const CONFIDENCE_FLOOR = 0.8;
export const DEFAULT_TOLERANCE = 2;

// ---------------------------------------------------------------- Judge

export type JudgeKind = "pick" | "keep" | "no-answer" | "off-list";

export interface JudgeScore {
  kind: JudgeKind;
  /** What the slot scores on this answer. */
  points: number;
  /** The best any option scored. */
  best: number;
  /** best - points: points left on the table. */
  lost: number;
  correct: boolean;
  /** Started a player who did not play or scored zero, when someone else scored. */
  dud: boolean;
  /** Left the slot empty when someone could have filled it. */
  empty: boolean;
  /** At or above the confidence floor: production would have made it without asking. */
  auto: boolean;
}

const pts = (v: number | "DNP" | undefined): number => (typeof v === "number" ? v : 0);

/** Why a case cannot be scored yet, or undefined when it can. */
export function ungraded(c: JudgeCase): string | undefined {
  const need = [...c.input.candidates.map((x) => x.id), ...(c.benchFillId ? [c.benchFillId] : [])];
  const missing = need.filter((id) => !(id in c.outcome));
  if (missing.length === need.length) return "no outcome yet";
  if (missing.length) return `no outcome for ${missing.join(", ")}`;
  return undefined;
}

export function scoreJudge(c: JudgeCase, r: JudgeRecord, floor = CONFIDENCE_FLOOR): JudgeScore {
  const offered = new Set(c.input.candidates.map((x) => x.id));
  const kind: JudgeKind =
    r.pick === undefined ? "no-answer" : r.pick === null ? "keep" : offered.has(r.pick) ? "pick" : "off-list";
  const fill = c.benchFillId ? pts(c.outcome[c.benchFillId]) : 0;
  const points = kind === "pick" ? pts(c.outcome[r.pick as string]) : fill;
  const best = Math.max(fill, ...c.input.candidates.map((x) => pts(c.outcome[x.id])));
  const tolerance = c.tolerance ?? DEFAULT_TOLERANCE;
  const dud = kind === "pick" && points === 0 && best > 0;
  return {
    kind,
    points,
    best,
    lost: Math.max(0, best - points),
    correct: points >= best - tolerance,
    dud,
    empty: kind !== "pick" && !c.benchFillId && best > 0,
    auto: kind === "pick" && (r.confidence ?? 0) >= floor,
  };
}

export interface JudgeSummary {
  model: string;
  calls: number;
  cases: number;
  /** Share of calls that came back with a usable answer. */
  answered: number;
  accuracy: number;
  avgLost: number;
  duds: number;
  autoDuds: number;
  empty: number;
  offList: number;
  noAnswer: number;
  /** Share of cases where every repeat gave the same answer. */
  consistency: number;
  /** Average confidence on right answers and on wrong ones: a model that is sure when wrong is the dangerous one. */
  confRight?: number;
  confWrong?: number;
  latencyAvg: number;
  latencyP95: number;
  cost?: number;
  costPerCall?: number;
  costPerCorrect?: number;
  errors: Record<string, number>;
}

const mean = (xs: number[]): number | undefined => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined);
const p95 = (xs: number[]): number => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(0.95 * s.length) - 1)]!;
};

export function summarizeJudge(cases: JudgeCase[], records: JudgeRecord[], floor = CONFIDENCE_FLOOR): JudgeSummary[] {
  const byId = new Map(cases.map((c) => [c.id, c]));
  const models = [...new Set(records.map((r) => r.model))];
  return models.map((model) => {
    const mine = records.filter((r) => r.model === model && byId.has(r.caseId) && !ungraded(byId.get(r.caseId)!));
    const scored = mine.map((r) => ({ r, s: scoreJudge(byId.get(r.caseId)!, r, floor) }));
    const right = scored.filter((x) => x.s.correct);
    const caseIds = [...new Set(mine.map((r) => r.caseId))];
    const steady = caseIds.filter((id) => new Set(mine.filter((r) => r.caseId === id).map((r) => String(r.pick))).size === 1);
    const costs = mine.map((r) => r.costUsd);
    const priced = costs.every((c) => typeof c === "number");
    const cost = priced ? (costs as number[]).reduce((a, b) => a + b, 0) : undefined;
    const errors: Record<string, number> = {};
    for (const r of mine) if (r.error) errors[r.error] = (errors[r.error] ?? 0) + 1;
    const conf = (xs: typeof scored) => mean(xs.filter((x) => x.s.kind === "pick" && x.r.confidence !== undefined).map((x) => x.r.confidence!));
    const confRight = conf(right);
    const confWrong = conf(scored.filter((x) => !x.s.correct));
    return {
      model,
      calls: mine.length,
      cases: caseIds.length,
      answered: mine.length ? mine.filter((r) => r.pick !== undefined).length / mine.length : 0,
      accuracy: mine.length ? right.length / mine.length : 0,
      avgLost: mean(scored.map((x) => x.s.lost)) ?? 0,
      duds: scored.filter((x) => x.s.dud).length,
      autoDuds: scored.filter((x) => x.s.dud && x.s.auto).length,
      empty: scored.filter((x) => x.s.empty).length,
      offList: scored.filter((x) => x.s.kind === "off-list").length,
      noAnswer: scored.filter((x) => x.s.kind === "no-answer").length,
      consistency: caseIds.length ? steady.length / caseIds.length : 0,
      ...(confRight !== undefined ? { confRight } : {}),
      ...(confWrong !== undefined ? { confWrong } : {}),
      latencyAvg: mean(mine.map((r) => r.latencyMs)) ?? 0,
      latencyP95: p95(mine.map((r) => r.latencyMs)),
      ...(cost !== undefined ? { cost, costPerCall: mine.length ? cost / mine.length : 0, ...(right.length ? { costPerCorrect: cost / right.length } : {}) } : {}),
      errors,
    };
  });
}

// ---------------------------------------------------------------- Advice

export type AdviceFlag =
  /** Names a free agent or roster player who is not in the input: production throws the item out. */
  | "unknown-id"
  /** The add is on waivers: never an add (rule 9). The item keeps its words, loses its tap. */
  | "waiver-add"
  /** Drops a starter who is playing this week (rule 3). */
  | "drops-playing-starter"
  /** Drops someone rostered in more than 65% of leagues without saying his season is over (rule 5). */
  | "drops-popular"
  /** An injury or RB-backup item with no source cited. */
  | "unsourced";

export interface ItemCheck {
  item: Advice;
  flags: AdviceFlag[];
  /** The drop is not switched to Droppable: allowed, but only on the user's tap. Not a fault. */
  needsWaiver: boolean;
}

export function checkAdvice(input: AdviceInput, items: Advice[]): ItemCheck[] {
  const fa = new Map(input.freeAgents.map((p) => [p.id, p]));
  const roster = new Map(input.roster.map((p) => [p.id, p]));
  return items.map((item) => {
    const flags: AdviceFlag[] = [];
    const add = item.action?.add;
    const drop = item.action?.drop;
    if ((add && !fa.has(add)) || (drop && !roster.has(drop))) flags.push("unknown-id");
    if (add && fa.get(add)?.onWaivers) flags.push("waiver-add");
    const d = drop ? roster.get(drop) : undefined;
    if (d) {
      const starting = d.slot !== undefined && d.slot !== "BENCH" && d.slot !== "IR";
      if (starting && (d.projection ?? 0) > 0 && (d.status === "active" || d.status === "questionable")) flags.push("drops-playing-starter");
      if ((d.percentRostered ?? 0) > 65 && !item.action?.outForSeason) flags.push("drops-popular");
    }
    if ((item.kind === "injury" || item.kind === "rb_backup") && !item.sources.some((s) => s !== "ESPN")) flags.push("unsourced");
    return { item, flags, needsWaiver: Boolean(drop && roster.has(drop) && !input.droppable.includes(drop)) };
  });
}

export interface AdviceSummary {
  model: string;
  runs: number;
  answered: number;
  itemsPerRun: number;
  withAction: number;
  clean: number;
  flags: Record<AdviceFlag, number>;
  latencyAvg: number;
  latencyP95: number;
  cost?: number;
  costPerRun?: number;
  webSearches: number;
  errors: Record<string, number>;
}

export function summarizeAdvice(inputs: Map<string, AdviceInput>, records: AdviceRecord[]): AdviceSummary[] {
  const models = [...new Set(records.map((r) => r.model))];
  return models.map((model) => {
    const mine = records.filter((r) => r.model === model && inputs.has(r.caseId));
    const checks = mine.flatMap((r) => (r.items ? checkAdvice(inputs.get(r.caseId)!, r.items) : []));
    const flags = { "unknown-id": 0, "waiver-add": 0, "drops-playing-starter": 0, "drops-popular": 0, unsourced: 0 } as Record<AdviceFlag, number>;
    for (const c of checks) for (const f of c.flags) flags[f]++;
    const costs = mine.map((r) => r.costUsd);
    const cost = costs.every((c) => typeof c === "number") ? (costs as number[]).reduce((a, b) => a + b, 0) : undefined;
    const errors: Record<string, number> = {};
    for (const r of mine) if (r.error) errors[r.error] = (errors[r.error] ?? 0) + 1;
    const answered = mine.filter((r) => r.items !== undefined);
    return {
      model,
      runs: mine.length,
      answered: mine.length ? answered.length / mine.length : 0,
      itemsPerRun: answered.length ? checks.length / answered.length : 0,
      withAction: checks.filter((c) => c.item.action).length,
      clean: checks.filter((c) => !c.flags.length).length,
      flags,
      latencyAvg: mean(mine.map((r) => r.latencyMs)) ?? 0,
      latencyP95: p95(mine.map((r) => r.latencyMs)),
      ...(cost !== undefined ? { cost, costPerRun: mine.length ? cost / mine.length : 0 } : {}),
      webSearches: mine.reduce((a, r) => a + (r.webSearches ?? 0), 0),
      errors,
    };
  });
}

// ---------------------------------------------------------------- Tables

const pct = (x: number): string => `${Math.round(x * 100)}%`;
const usd = (x: number | undefined, digits = 4): string => (x === undefined ? "—" : `$${x.toFixed(digits)}`);
const sec = (msv: number): string => `${(msv / 1000).toFixed(1)}s`;
const errs = (e: Record<string, number>): string => Object.entries(e).map(([k, v]) => `${k} ×${v}`).join(", ") || "—";

export function judgeTable(rows: JudgeSummary[]): string {
  const sorted = [...rows].sort((a, b) => b.accuracy - a.accuracy || a.autoDuds - b.autoDuds || (a.costPerCorrect ?? Infinity) - (b.costPerCorrect ?? Infinity));
  const head = "| Model | Right | Pts lost / call | Auto duds | Duds | Empty slot | Off-list | No answer | Same answer each time | Conf. right / wrong | Avg / p95 time | Cost / call | Cost / right call |";
  const rule = "|" + "---|".repeat(13);
  const body = sorted.map(
    (s) =>
      `| ${s.model} | ${pct(s.accuracy)} | ${s.avgLost.toFixed(1)} | ${s.autoDuds} | ${s.duds} | ${s.empty} | ${s.offList} | ${s.noAnswer} | ${pct(s.consistency)} | ${s.confRight?.toFixed(2) ?? "—"} / ${s.confWrong?.toFixed(2) ?? "—"} | ${sec(s.latencyAvg)} / ${sec(s.latencyP95)} | ${usd(s.costPerCall)} | ${usd(s.costPerCorrect)} |`,
  );
  const errLines = sorted.filter((s) => Object.keys(s.errors).length).map((s) => `- ${s.model}: ${errs(s.errors)}`);
  return [head, rule, ...body, ...(errLines.length ? ["", "Errors:", ...errLines] : [])].join("\n");
}

export function adviceTable(rows: AdviceSummary[]): string {
  const sorted = [...rows].sort((a, b) => (b.withAction ? b.clean / Math.max(1, b.withAction) : 0) - (a.withAction ? a.clean / Math.max(1, a.withAction) : 0));
  const head = "| Model | Answered | Items / run | With a tap | Clean | Unknown id | Waiver add | Drops playing starter | Drops 65%+ | Unsourced | Avg / p95 time | Cost / run | Searches |";
  const rule = "|" + "---|".repeat(13);
  const body = sorted.map(
    (s) =>
      `| ${s.model} | ${pct(s.answered)} | ${s.itemsPerRun.toFixed(1)} | ${s.withAction} | ${s.clean} | ${s.flags["unknown-id"]} | ${s.flags["waiver-add"]} | ${s.flags["drops-playing-starter"]} | ${s.flags["drops-popular"]} | ${s.flags.unsourced} | ${sec(s.latencyAvg)} / ${sec(s.latencyP95)} | ${usd(s.costPerRun)} | ${s.webSearches} |`,
  );
  const errLines = sorted.filter((s) => Object.keys(s.errors).length).map((s) => `- ${s.model}: ${errs(s.errors)}`);
  return [head, rule, ...body, ...(errLines.length ? ["", "Errors:", ...errLines] : [])].join("\n");
}
