// Shadow mode: on a live Sunday, every hole the Judge sees is also put to the other models,
// silently. Only the primary's answer is used; the rest are logged with the input. On
// Monday you grade the logged holes (who played, who scored) and the same scorer as the
// bench ranks every model on real, unrehearsed decisions, breaking news included, which a
// backtest can't give you.
//
// Not wired into production. Doing so means calling the other providers from the `check`
// Edge Function, which docs/STACK.md does not list, so it is the owner's call. The wiring,
// if wanted, is in bench/README.md ("Shadow mode").
//
//   node bench/shadow.ts import shadow-log.jsonl   → cases/judge/live-*.json (ungraded) + results/shadow-*.jsonl

import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AiChoice, Judge, JudgeInput } from "@rosterbots/core";
import { appendRecord, BENCH, readRecords, stamp } from "./lib/files.ts";
import type { JudgeCase, JudgeRecord } from "./lib/types.ts";

export interface ShadowAnswer {
  model: string;
  primary: boolean;
  pick?: string | null;
  confidence?: number;
  reason?: string;
  latencyMs: number;
  error?: string;
}

/** One hole, as logged on game day: the input every model saw and what each said. */
export interface ShadowRecord {
  at: string;
  input: JudgeInput;
  answers: ShadowAnswer[];
}

export interface Named {
  name: string;
  judge: Judge;
}

async function timed(n: Named, input: JudgeInput, primary: boolean): Promise<{ answer: AiChoice | undefined; log: ShadowAnswer }> {
  const t0 = performance.now();
  try {
    const answer = await n.judge.pick(input);
    const latencyMs = Math.round(performance.now() - t0);
    return {
      answer,
      log: { model: n.name, primary, latencyMs, ...(answer ? { pick: answer.playerId, confidence: answer.confidence, reason: answer.reason } : { error: "no answer" }) },
    };
  } catch (e) {
    return { answer: undefined, log: { model: n.name, primary, latencyMs: Math.round(performance.now() - t0), error: e instanceof Error ? e.name : "error" } };
  }
}

/**
 * A Judge that answers with `primary` and, on the side, asks every shadow the same question.
 * The primary's answer comes back as soon as it has one: shadows never slow a move down.
 * `background` keeps the shadow work alive after the answer (in an Edge Function,
 * `(p) => EdgeRuntime.waitUntil(p)`); `sink` stores the record and must not throw.
 */
export function shadowJudge(
  primary: Named,
  shadows: Named[],
  sink: (r: ShadowRecord) => Promise<void> | void,
  background: (p: Promise<unknown>) => void = (p) => void p.catch(() => {}),
): Judge {
  return {
    async pick(input: JudgeInput): Promise<AiChoice | undefined> {
      const at = new Date().toISOString();
      const side = shadows.map((s) => timed(s, input, false));
      const main = await timed(primary, input, true);
      background(
        Promise.all(side)
          .then((rest) => sink({ at, input, answers: [main.log, ...rest.map((r) => r.log)] }))
          .catch(() => {}),
      );
      return main.answer;
    },
  };
}

/** A logged hole as an ungraded case. Its outcome, and the bench fill's id if there was one, are filled in on Monday. */
export function caseFromShadow(r: ShadowRecord, id: string): JudgeCase {
  return {
    id,
    note: `Live, ${r.at}. Grade: put each candidate's points (or "DNP") in outcome${r.input.benchFill ? `, and set benchFillId to ${r.input.benchFill.name}'s ESPN id with his points` : ""}.`,
    tags: ["live"],
    input: r.input,
    outcome: {},
  };
}

/** The logged answers as bench records, so `run.ts report` scores them once the cases are graded. */
export function recordsFromShadow(r: ShadowRecord, caseId: string): JudgeRecord[] {
  return r.answers.map((a) => ({
    job: "judge",
    model: a.model,
    caseId,
    rep: 1,
    at: r.at,
    latencyMs: a.latencyMs,
    ...(a.pick !== undefined ? { pick: a.pick } : {}),
    ...(a.confidence !== undefined ? { confidence: a.confidence } : {}),
    ...(a.reason !== undefined ? { reason: a.reason } : {}),
    ...(a.error ? { error: a.error } : {}),
  }));
}

function importLog(path: string): void {
  const logged = readRecords(path) as unknown as ShadowRecord[];
  const out = join(BENCH, "results", `shadow-${stamp()}.jsonl`);
  let n = 0;
  for (const r of logged) {
    const id = `live-${r.at.slice(0, 19).replace(/:/g, "-")}-${String(++n).padStart(2, "0")}`;
    writeFileSync(join(BENCH, "cases", "judge", `${id}.json`), JSON.stringify(caseFromShadow(r, id), null, 2) + "\n");
    for (const rec of recordsFromShadow(r, id)) appendRecord(out, rec);
  }
  console.log(`${n} hole(s) → bench/cases/judge/live-*.json (grade them), answers → ${out}`);
  console.log(`After grading: node bench/run.ts report ${out}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [cmd, file] = process.argv.slice(2);
  if (cmd === "import" && file) importLog(file);
  else console.log("node bench/shadow.ts import <shadow-log.jsonl>");
}
