// The bench's command line. See bench/README.md.
//
//   node bench/run.ts judge   [--models a,b] [--repeats 3] [--cases dir] [--examples] [--ungraded] [--tag t] [--concurrency 4] [--dry]
//   node bench/run.ts advice  [--models a,b] [--repeats 2] [--cases dir] [--examples] [--web] [--tools all] [--concurrency 2] [--dry]
//   node bench/run.ts replay  [--models a,b] [--repeats 2] [--cases dir] [--examples] [--tag t] [--concurrency 4] [--dry]
//   node bench/run.ts scratch [--models a,b] [--repeats 1] [--cases dir] [--examples] [--names real|hidden|both] [--tag t] [--concurrency 6] [--dry]
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
import { replay } from "./lib/replay.ts";
import { asksFor, parseScratch, scratchInput, SCRATCH_SCHEMA, SCRATCH_SYSTEM } from "./lib/scratch.ts";
import { adviceDetails } from "./lib/detail.ts";
import { adviceTable, CONFIDENCE_FLOOR, judgeTable, replayTable, scratchCaseTable, scratchTable, summarizeAdvice, summarizeJudge, summarizeReplay, summarizeScratch, ungraded, WILD } from "./lib/score.ts";
import type { AdviceCase, AdviceRecord, Call, JudgeCase, JudgeRecord, ModelEntry, ReplayCase, ReplayRecord, RunRecord, ScratchCase, ScratchRecord } from "./lib/types.ts";
import type { AiChoice, JudgeInput } from "@rosterbots/core";

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
    tools: { type: "string" },
    concurrency: { type: "string" },
    floor: { type: "string" },
    names: { type: "string" },
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
  "- **Words ≠ move**: the words name someone other than the move's ids (a Kimi run said \"drop Joe Milton\" with Chig Okonkwo's id). Production's integrity check throws the item out.",
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
  const tools = opts.tools === "all" ? "all" : "production";
  if (opts.tools && opts.tools !== "all" && opts.tools !== "production") throw new Error(`--tools is "all" or "production", not "${opts.tools}"`);
  log(
    `${cases.length} case(s) × ${models.length} model(s) × ${repeats} = ${cases.length * models.length * repeats} calls, ` +
      (tools === "all" ? "every tool each provider offers (search, fetch, date; X search for Grok), no search cap." : `web search ${opts.web ? "on (OpenRouter rows use OpenRouter's web plugin)" : "off for OpenRouter rows"}.`),
  );
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
          const call = await k.advise(c.input, { web: opts.web ?? false, tools });
          const r: AdviceRecord = {
            job: "advice",
            model: k.entry.name,
            caseId: c.id,
            rep,
            at: new Date().toISOString(),
            latencyMs: call.latencyMs,
            ...call.usage,
            tools,
            ...(call.answer ? { items: call.answer } : {}),
            ...(call.error ? { error: call.error } : {}),
            ...(call.trace ? { trace: call.trace } : {}),
          };
          appendRecord(path, r);
          progress(++done, total);
          return r;
        });
  const records = await pool(tasks, Number(opts.concurrency ?? 2));
  if (process.stderr.isTTY) log("");
  save(path, `Advice bench, ${new Date().toLocaleString()}`, adviceTable(summarizeAdvice(new Map(cases.map((c) => [c.id, c.input])), records)), [...ADVICE_FOOTER, "", adviceDetails(cases, records)]);
  log(`Blind review: node bench/review.ts export ${path}`);
}

const REPLAY_FOOTER = [
  "Each run is the case's last minutes before kickoff through the app's real check loop, the model as the Judge, every answer costing its real time on the clock. Nobody taps anything.",
  "",
  "- **Pts lost / run**: against the best possible on that case. A wrong pick a later check fixes costs nothing here.",
  "- **Zero in lineup at kickoff**: a player who scored nothing was starting when the slot locked.",
  "- **Minutes with a hole**: from the first check to kickoff, time a starting slot held a hole the app could see. Lower is faster.",
  "- **AI answer avg / p95**: per call. **No AI (rules only)** is the app with the AI step answering nothing: what the rules do alone.",
];

/** The app with no AI answer at all: the rules alone, as a baseline row. */
const NO_AI = "no AI (rules only)";
const silent = async (): Promise<Call<AiChoice>> => ({ answer: undefined, latencyMs: 0, usage: { costUsd: 0 }, error: "no AI" });

async function replayCmd(): Promise<void> {
  const repeats = Number(opts.repeats ?? 2);
  const dir = opts.cases ?? join(BENCH, "cases", "replay");
  const all = loadJson<ReplayCase>(dir);
  const cases = all.filter((c) => (opts.examples || !c.example) && (!opts.tag || c.tags?.includes(opts.tag)));
  const models = pickModels(loadModels());
  log(`${cases.length} case(s) × ${models.length} model(s) × ${repeats}, plus the rules-only row${all.length - cases.length ? ` (${all.length - cases.length} skipped: examples or other tags)` : ""}.`);
  if (!cases.length) return log("Nothing to run. Add replay cases, or pass --examples.");
  log(`Models: ${models.map((m) => m.name).join(", ")}`);
  if (opts.dry) return;
  const contenders = await ready(models);
  const judges: { name: string; judge: (i: JudgeInput) => Promise<Call<AiChoice>> }[] = [
    { name: NO_AI, judge: silent },
    ...contenders.map((k) => ({ name: k.entry.name, judge: (i: JudgeInput) => k.judge(i) })),
  ];
  const path = opts.out ?? join(BENCH, "results", `replay-${stamp()}.jsonl`);
  let done = 0;
  const tasks: (() => Promise<ReplayRecord>)[] = [];
  for (let rep = 1; rep <= repeats; rep++)
    for (const c of cases)
      for (const j of judges) {
        if (j.name === NO_AI && rep > 1) continue; // the rules alone do the same thing every time
        tasks.push(async () => {
          const t0 = performance.now();
          const res = await replay(c, j.judge);
          const r: ReplayRecord = {
            job: "replay",
            model: j.name,
            caseId: c.id,
            rep,
            at: new Date().toISOString(),
            latencyMs: Math.round(performance.now() - t0),
            ...res.usage,
            points: res.points,
            zeroAtLock: res.zeroAtLock,
            holeMinutes: res.holeMinutes,
            autoMoves: res.autoMoves,
            aiCalls: res.aiCalls,
            log: res.log,
          };
          appendRecord(path, r);
          progress(++done, tasks.length);
          return r;
        });
      }
  const records = await pool(tasks, Number(opts.concurrency ?? 4));
  if (process.stderr.isTTY) log("");
  save(path, `Replay bench, ${new Date().toLocaleString()}`, replayTable(summarizeReplay(cases, records)), REPLAY_FOOTER);
}

const SCRATCH_FOOTER = [
  "A draft of a feature that is not built: acting on news before ESPN shows a player OUT. Each case is a real game day; at each moment the model sees the designations and the news published by then, and gives its probability that the player sits.",
  "",
  `- **Played, but it would have benched him**: the model reached the bar (${WILD}, the owner's "wild confidence"; or ${CONFIDENCE_FLOOR}, today's floor for lineup moves) on a day the player played. The worst outcome.`,
  "- **Sat, and it caught it**: reached the bar before kickoff on a day he did not play.",
  "- **Caught on a guess**: reached 0.95 before any report said he was out.",
  "- **Names**: real, or hidden behind Player A / Team A / Team B, so the model cannot know how the day went. A gap between the two is memory, not judgment.",
  "- No model has tools here: one message in, one JSON answer out.",
];

async function scratch(): Promise<void> {
  const repeats = Number(opts.repeats ?? 1);
  const dir = opts.cases ?? join(BENCH, "cases", "scratch");
  const all = loadJson<ScratchCase>(dir);
  const cases = all.filter((c) => (opts.examples || !c.example) && (!opts.tag || c.tags?.includes(opts.tag)));
  const modes = opts.names === "real" ? [false] : opts.names === "hidden" ? [true] : [false, true];
  const models = pickModels(loadModels());
  const asks = cases.reduce((n, c) => n + asksFor(c).length, 0);
  log(`${cases.length} case(s), ${asks} moment(s) × ${modes.length} name mode(s) × ${models.length} model(s) × ${repeats} = ${asks * modes.length * models.length * repeats} calls${all.length - cases.length ? ` (${all.length - cases.length} skipped: examples or other tags)` : ""}.`);
  if (!cases.length) return log("Nothing to run. Add scratch cases, or pass --examples.");
  log(`Models: ${models.map((m) => m.name).join(", ")}`);
  if (opts.dry) return;
  const contenders = await ready(models);
  const path = opts.out ?? join(BENCH, "results", `scratch-${stamp()}.jsonl`);
  let done = 0;
  const tasks: (() => Promise<ScratchRecord>)[] = [];
  for (let rep = 1; rep <= repeats; rep++)
    for (const c of cases)
      for (const hidden of modes)
        for (const asked of asksFor(c))
          for (const k of contenders)
            tasks.push(async () => {
              const call = await k.ask({ system: SCRATCH_SYSTEM, user: JSON.stringify(scratchInput(c, asked, hidden)), schema: SCRATCH_SCHEMA });
              const a = parseScratch(call.answer);
              const r: ScratchRecord = {
                job: "scratch",
                model: k.entry.name,
                caseId: c.id,
                rep,
                at: new Date().toISOString(),
                latencyMs: call.latencyMs,
                ...call.usage,
                hidden,
                asked,
                ...(a ? { out: a.out, reason: a.reason } : {}),
                ...(a ? {} : { error: call.error ?? "unparseable answer" }),
              };
              appendRecord(path, r);
              progress(++done, tasks.length);
              return r;
            });
  const records = await pool(tasks, Number(opts.concurrency ?? 6));
  if (process.stderr.isTTY) log("");
  save(path, `Scratch bench, ${new Date().toLocaleString()}`, scratchReport(cases, records), SCRATCH_FOOTER);
}

const scratchReport = (cases: ScratchCase[], records: ScratchRecord[]): string =>
  [scratchTable(summarizeScratch(cases, records)), "", "### Case by case: when each model first reached 0.95 (real names · hidden)", "", scratchCaseTable(cases, records)].join("\n");

function report(): void {
  const path = positionals[1];
  if (!path) throw new Error("Which results file? node bench/run.ts report bench/results/judge-....jsonl");
  const records: RunRecord[] = readRecords(path);
  if (records[0]?.job === "scratch") {
    const cases = loadJson<ScratchCase>(opts.cases ?? join(BENCH, "cases", "scratch"));
    save(path, "Scratch bench (re-scored)", scratchReport(cases, records as ScratchRecord[]), SCRATCH_FOOTER);
  } else if (records[0]?.job === "replay") {
    const cases = loadJson<ReplayCase>(opts.cases ?? join(BENCH, "cases", "replay"));
    save(path, "Replay bench (re-scored)", replayTable(summarizeReplay(cases, records as ReplayRecord[])), REPLAY_FOOTER);
  } else if (records[0]?.job === "advice") {
    const cases = loadJson<AdviceCase>(opts.cases ?? join(BENCH, "cases", "advice"));
    save(path, "Advice bench (re-scored)", adviceTable(summarizeAdvice(new Map(cases.map((c) => [c.id, c.input])), records as AdviceRecord[])), [...ADVICE_FOOTER, "", adviceDetails(cases, records as AdviceRecord[])]);
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

const HELP = `node bench/run.ts <judge|advice|replay|scratch|report|models> [options]   (details in bench/README.md)`;

try {
  if (opts.help || !command) console.log(HELP);
  else if (command === "judge") await judge();
  else if (command === "advice") await advice();
  else if (command === "replay") await replayCmd();
  else if (command === "scratch") await scratch();
  else if (command === "report") report();
  else if (command === "models") await models();
  else throw new Error(`Unknown command "${command}". ${HELP}`);
} catch (e) {
  log((e as Error).message);
  process.exit(1);
}
