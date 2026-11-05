// The bench's command line. See bench/README.md.
//
//   node bench/run.ts judge   [--models a,b] [--repeats 3] [--cases dir] [--examples] [--ungraded] [--tag t] [--concurrency 4] [--dry]
//   node bench/run.ts advice  [--models a,b] [--repeats 2] [--cases dir] [--examples] [--web] [--concurrency 2] [--dry]
//   node bench/run.ts report  bench/results/judge-....jsonl     (re-score a run, e.g. after grading more cases)
//   node bench/run.ts models  [author ...]                       (OpenRouter's current ids, newest first)
//
// Keys come from the environment: OPENROUTER_API_KEY, ANTHROPIC_API_KEY. Node loads a .env
// with `node --env-file=.env bench/run.ts ...`.

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { appendRecord, BENCH, loadJson, loadModels, readRecords, stamp } from "./lib/files.ts";
import { contender, openRouterCatalog, preflight, type Contender } from "./lib/providers.ts";
import { adviceTable, CONFIDENCE_FLOOR, judgeTable, summarizeAdvice, summarizeJudge, ungraded } from "./lib/score.ts";
import type { AdviceCase, AdviceRecord, JudgeCase, JudgeRecord, ModelEntry, RunRecord } from "./lib/types.ts";

const { values: opts, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    models: { type: "string" },
    repeats: { type: "string" },
    cases: { type: "string" },
    examples: { type: "boolean", default: false },
    ungraded: { type: "boolean", default: false },
    tag: { type: "string" },
    web: { type: "boolean", default: false },
    concurrency: { type: "string" },
    floor: { type: "string" },
    out: { type: "string" },
    dry: { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
});

const command = positionals[0];
const log = (s: string): void => void process.stderr.write(s + "\n");
const floor = opts.floor ? Number(opts.floor) : CONFIDENCE_FLOOR;
/** A counter on a terminal; nothing when the output is a file or a pipe. */
const progress = (done: number, total: number): void => {
  if (process.stderr.isTTY) process.stderr.write(`\r${done}/${total}`);
};

function pickModels(all: ModelEntry[]): ModelEntry[] {
  if (!opts.models) return all.filter((m) => !m.off);
  const wanted = opts.models.split(",").map((s) => s.trim()).filter(Boolean);
  const unknown = wanted.filter((w) => !all.some((m) => m.name === w));
  if (unknown.length) throw new Error(`Not in models.json: ${unknown.join(", ")}. Names there: ${all.map((m) => m.name).join(", ")}`);
  return all.filter((m) => wanted.includes(m.name));
}

/** Runs tasks with at most `n` at once, in order of the list. */
async function pool<T>(tasks: (() => Promise<T>)[], n: number): Promise<T[]> {
  const out: T[] = new Array(tasks.length);
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const i = next++;
      out[i] = await tasks[i]!();
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(n, tasks.length)) }, worker));
  return out;
}

async function ready(models: ModelEntry[]): Promise<Contender[]> {
  const { problems, warnings, prices } = await preflight(models, process.env);
  for (const w of warnings) log(`warning: ${w}`);
  if (problems.length) {
    for (const p of problems) log(`stop: ${p}`);
    process.exit(1);
  }
  return models.map((m) => contender(m, process.env, prices));
}

function save(path: string, title: string, table: string, footer: string[]): void {
  const md = [`# ${title}`, "", `Results: \`${path}\``, "", table, "", ...footer].join("\n");
  const mdPath = path.replace(/\.jsonl$/, ".md");
  writeFileSync(mdPath, md + "\n");
  console.log("\n" + table + "\n");
  log(`Report: ${mdPath}`);
}

const JUDGE_FOOTER = (n: number) => [
  `Floor for an automatic move: confidence ${floor}. ${n} graded case(s).`,
  "",
  "- **Right**: within the case's tolerance (default 2 points) of the best option that week.",
  "- **Auto dud**: started a player who didn't play or scored 0, confidently enough that production would have done it without asking. The number that matters most.",
  "- **Empty slot**: no fix when one existed. **Off-list**: named a player who wasn't offered (production ignores it; the bench fill stands).",
  "- **Conf. right / wrong**: average confidence on right and wrong picks. Close numbers mean the model can't tell when it's wrong.",
];

const ADVICE_FOOTER = [
  "Rule checks only; quality needs a human (node bench/review.ts).",
  "",
  "- **Unknown id**: names a player who isn't there. Production throws the item out.",
  "- **Waiver add / Drops playing starter / Drops 65%+**: break a No-Cray rule. Production keeps the words and removes the tap.",
  "- **Unsourced**: an injury or RB-backup claim with no source.",
];

async function judge(): Promise<void> {
  const repeats = Number(opts.repeats ?? 3);
  const dir = opts.cases ?? join(BENCH, "cases", "judge");
  const all = loadJson<JudgeCase>(dir);
  const cases = all.filter((c) => (opts.examples || !c.example) && (opts.ungraded || !ungraded(c)) && (!opts.tag || c.tags?.includes(opts.tag)));
  const skipped = all.length - cases.length;
  const models = pickModels(loadModels());
  log(`${cases.length} case(s) × ${models.length} model(s) × ${repeats} = ${cases.length * models.length * repeats} calls${skipped ? ` (${skipped} skipped: examples, ungraded or other tags)` : ""}.`);
  if (!cases.length) return log("Nothing to run. Add graded cases, or pass --examples to try the bench on the made-up ones.");
  log(`Models: ${models.map((m) => m.name).join(", ")}`);
  if (opts.dry) return;
  const contenders = await ready(models);
  const path = opts.out ?? join(BENCH, "results", `judge-${stamp()}.jsonl`);
  let done = 0;
  const total = cases.length * contenders.length * repeats;
  const tasks: (() => Promise<JudgeRecord>)[] = [];
  for (let rep = 1; rep <= repeats; rep++)
    for (const c of cases)
      for (const k of contenders)
        tasks.push(async () => {
          const call = await k.judge(c.input);
          const r: JudgeRecord = {
            job: "judge",
            model: k.entry.name,
            caseId: c.id,
            rep,
            at: new Date().toISOString(),
            latencyMs: call.latencyMs,
            ...call.usage,
            ...(call.answer ? { pick: call.answer.playerId, confidence: call.answer.confidence, reason: call.answer.reason } : {}),
            ...(call.error ? { error: call.error } : {}),
          };
          appendRecord(path, r);
          progress(++done, total);
          return r;
        });
  const records = await pool(tasks, Number(opts.concurrency ?? 4));
  if (process.stderr.isTTY) log("");
  save(path, `Judge bench, ${new Date().toLocaleString()}`, judgeTable(summarizeJudge(cases, records, floor)), JUDGE_FOOTER(cases.length));
}

async function advice(): Promise<void> {
  const repeats = Number(opts.repeats ?? 2);
  const dir = opts.cases ?? join(BENCH, "cases", "advice");
  const all = loadJson<AdviceCase>(dir);
  const cases = all.filter((c) => opts.examples || !c.example);
  const models = pickModels(loadModels());
  log(`${cases.length} case(s) × ${models.length} model(s) × ${repeats} = ${cases.length * models.length * repeats} calls, web search ${opts.web ? "on (OpenRouter rows use OpenRouter's web plugin)" : "off for OpenRouter rows"}.`);
  if (!cases.length) return log("Nothing to run. Add cases, or pass --examples.");
  if (opts.dry) return;
  const contenders = await ready(models);
  const path = opts.out ?? join(BENCH, "results", `advice-${stamp()}.jsonl`);
  let done = 0;
  const total = cases.length * contenders.length * repeats;
  const tasks: (() => Promise<AdviceRecord>)[] = [];
  for (let rep = 1; rep <= repeats; rep++)
    for (const c of cases)
      for (const k of contenders)
        tasks.push(async () => {
          const call = await k.advise(c.input, { web: opts.web ?? false });
          const r: AdviceRecord = {
            job: "advice",
            model: k.entry.name,
            caseId: c.id,
            rep,
            at: new Date().toISOString(),
            latencyMs: call.latencyMs,
            ...call.usage,
            ...(call.answer ? { items: call.answer } : {}),
            ...(call.error ? { error: call.error } : {}),
          };
          appendRecord(path, r);
          progress(++done, total);
          return r;
        });
  const records = await pool(tasks, Number(opts.concurrency ?? 2));
  if (process.stderr.isTTY) log("");
  save(path, `Advice bench, ${new Date().toLocaleString()}`, adviceTable(summarizeAdvice(new Map(cases.map((c) => [c.id, c.input])), records)), ADVICE_FOOTER);
  log(`Blind review: node bench/review.ts export ${path}`);
}

function report(): void {
  const path = positionals[1];
  if (!path) throw new Error("Which results file? node bench/run.ts report bench/results/judge-....jsonl");
  const records: RunRecord[] = readRecords(path);
  if (records[0]?.job === "advice") {
    const cases = loadJson<AdviceCase>(opts.cases ?? join(BENCH, "cases", "advice"));
    save(path, "Advice bench (re-scored)", adviceTable(summarizeAdvice(new Map(cases.map((c) => [c.id, c.input])), records as AdviceRecord[])), ADVICE_FOOTER);
  } else {
    const cases = loadJson<JudgeCase>(opts.cases ?? join(BENCH, "cases", "judge"));
    const graded = cases.filter((c) => !ungraded(c));
    save(path, "Judge bench (re-scored)", judgeTable(summarizeJudge(graded, records as JudgeRecord[], floor)), JUDGE_FOOTER(graded.length));
  }
}

async function models(): Promise<void> {
  const authors = positionals.slice(1).length ? positionals.slice(1) : ["anthropic", "openai", "google", "x-ai", "z-ai", "deepseek", "moonshotai", "qwen"];
  const catalog = await openRouterCatalog();
  for (const a of authors) {
    const ids = catalog
      .filter((m) => m.id.startsWith(a + "/") && !m.id.endsWith(":batch"))
      .sort((x, y) => (y.created ?? 0) - (x.created ?? 0))
      .slice(0, 8);
    console.log(`\n${a}`);
    for (const m of ids) {
      const p = Number(m.pricing?.prompt) * 1e6;
      const c = Number(m.pricing?.completion) * 1e6;
      console.log(`  ${m.id.padEnd(48)} ${Number.isFinite(p) ? `$${p.toFixed(2)} in / $${c.toFixed(2)} out per M tokens` : ""}`);
    }
  }
}

const HELP = `node bench/run.ts <judge|advice|report|models> [options]   (details in bench/README.md)`;

try {
  if (opts.help || !command) console.log(HELP);
  else if (command === "judge") await judge();
  else if (command === "advice") await advice();
  else if (command === "report") report();
  else if (command === "models") await models();
  else throw new Error(`Unknown command "${command}". ${HELP}`);
} catch (e) {
  log((e as Error).message);
  process.exit(1);
}
