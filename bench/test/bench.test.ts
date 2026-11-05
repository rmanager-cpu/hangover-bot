// The bench, offline: fake fetches stand in for OpenRouter and Anthropic. Nothing here
// reaches the network or costs anything.
//   node --test bench/test/*.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CHOICE_SCHEMA, REPORT_TOOL } from "@rosterbots/ai";
import type { AiChoice } from "@rosterbots/core";
import { BENCH, loadJson } from "../lib/files.ts";
import { adviceRequest, judgeRequest } from "../lib/prompts.ts";
import { contender, preflight } from "../lib/providers.ts";
import { checkAdvice, scoreJudge, summarizeJudge, ungraded } from "../lib/score.ts";
import type { AdviceCase, JudgeCase, JudgeRecord, ModelEntry } from "../lib/types.ts";
import { parseCsv } from "../review.ts";
import { shadowJudge, type ShadowRecord } from "../shadow.ts";

const judgeCases = loadJson<JudgeCase>(join(BENCH, "cases", "judge"));
const caseOf = (id: string): JudgeCase => judgeCases.find((c) => c.id === id)!;
const outStarter = caseOf("example-01-out-starter");
const benchFine = caseOf("example-02-bench-is-fine");
const trap = caseOf("example-03-scratch-trap");
const advice = loadJson<AdviceCase>(join(BENCH, "cases", "advice"))[0]!;

const rec = (pick: string | null | undefined, confidence = 0.9, extra: Partial<JudgeRecord> = {}): JudgeRecord => ({
  job: "judge",
  model: "m",
  caseId: "c",
  rep: 1,
  at: "2026-11-08T17:45:00.000Z",
  latencyMs: 1000,
  ...(pick !== undefined ? { pick, confidence } : {}),
  ...extra,
});

// ---------------------------------------------------------------- prompts

test("every model is sent production's own request: its system prompt, the input as is, its schema", async () => {
  const req = await judgeRequest(outStarter.input);
  assert.match(req.system, /RosterBots' judge/);
  assert.equal(req.user, JSON.stringify(outStarter.input));
  assert.deepEqual(req.schema, JSON.parse(JSON.stringify(CHOICE_SCHEMA)));
});

test("the advisor's request carries production's report tool and search limit", async () => {
  const req = await adviceRequest(advice.input);
  assert.match(req.system, /Roster Advice/);
  assert.equal(req.user, JSON.stringify(advice.input));
  assert.deepEqual(req.report?.input_schema, JSON.parse(JSON.stringify(REPORT_TOOL.input_schema)));
  assert.equal(req.maxSearches, 6);
});

// ---------------------------------------------------------------- Judge scoring

test("the free agent who started and scored is right; keeping the weak bench fill is not", () => {
  assert.equal(scoreJudge(outStarter, rec("fa1")).correct, true);
  const keep = scoreJudge(outStarter, rec(null));
  assert.equal(keep.correct, false);
  assert.equal(keep.points, 5.4);
  assert.equal(keep.lost, 14.2 - 5.4);
});

test("a confident pick of a player who sat is an automatic dud; an unsure one is a dud but not automatic", () => {
  const sure = scoreJudge(outStarter, rec("fa2", 0.9));
  assert.deepEqual([sure.dud, sure.auto, sure.correct], [true, true, false]);
  const unsure = scoreJudge(outStarter, rec("fa2", 0.5));
  assert.deepEqual([unsure.dud, unsure.auto], [true, false]);
});

test("keeping a bench fill as good as the free agent is right", () => {
  assert.equal(scoreJudge(benchFine, rec(null)).correct, true);
  assert.equal(scoreJudge(benchFine, rec("fa3")).correct, false);
});

test("an off-list name or no answer leaves the bench fill, as production does", () => {
  const off = scoreJudge(outStarter, rec("nobody"));
  assert.deepEqual([off.kind, off.points, off.dud], ["off-list", 5.4, false]);
  const none = scoreJudge(outStarter, rec(undefined));
  assert.deepEqual([none.kind, none.points], ["no-answer", 5.4]);
});

test("with no bench fill, not answering leaves the slot empty", () => {
  const s = scoreJudge(trap, rec(null));
  assert.deepEqual([s.empty, s.points, s.correct], [true, 0, false]);
  assert.equal(scoreJudge(trap, rec("fa5")).correct, true);
  assert.equal(scoreJudge(trap, rec("fa4")).dud, true);
});

test("a case with no outcome is not scored", () => {
  assert.equal(ungraded(caseOf("example-04-not-graded-yet")), "no outcome yet");
  assert.equal(ungraded(outStarter), undefined);
  const partial: JudgeCase = { ...outStarter, outcome: { fa1: 3 } };
  assert.match(ungraded(partial)!, /no outcome for/);
});

test("the summary counts consistency, confidence when wrong, and cost per right call", () => {
  const records: JudgeRecord[] = [
    { ...rec("fa1", 0.9), caseId: outStarter.id, costUsd: 0.01 },
    { ...rec("fa1", 0.9), caseId: outStarter.id, rep: 2, costUsd: 0.01 },
    { ...rec("fa3", 0.6), caseId: benchFine.id, costUsd: 0.01 },
    { ...rec(null, 0.9), caseId: benchFine.id, rep: 2, costUsd: 0.01 },
  ];
  const [s] = summarizeJudge([outStarter, benchFine], records);
  assert.equal(s!.accuracy, 0.75);
  assert.equal(s!.consistency, 0.5);
  assert.equal(s!.confWrong, 0.6);
  assert.ok(Math.abs(s!.costPerCorrect! - 0.04 / 3) < 1e-12);
});

// ---------------------------------------------------------------- Advice checks

test("advice checks: unknown ids, waiver adds, dropping a playing starter or a 65% player, missing sources", () => {
  const items = checkAdvice(advice.input, [
    { kind: "fit", title: "ok", body: "b", sources: ["ESPN"], action: { add: "f2", drop: "r10" } },
    { kind: "fit", title: "ghost", body: "b", sources: [], action: { add: "f99" } },
    { kind: "fit", title: "waiver", body: "b", sources: [], action: { add: "f3", drop: "r11" } },
    { kind: "fit", title: "starter", body: "b", sources: [], action: { add: "f1", drop: "r3" } },
    { kind: "injury", title: "hurt", body: "b", sources: ["ESPN"] },
    { kind: "fit", title: "not droppable", body: "b", sources: [], action: { add: "f4", drop: "r8" } },
  ]);
  assert.deepEqual(items[0]!.flags, []);
  assert.deepEqual(items[1]!.flags, ["unknown-id"]);
  assert.deepEqual(items[2]!.flags, ["waiver-add"]);
  assert.deepEqual(items[3]!.flags, ["drops-playing-starter", "drops-popular"]);
  assert.deepEqual(items[4]!.flags, ["unsourced"]);
  assert.equal(items[5]!.needsWaiver, true);
});

// ---------------------------------------------------------------- Providers

function fakeFetch(answer: (url: string, body: Record<string, unknown>) => Response) {
  const calls: { url: string; body: Record<string, unknown>; headers: Headers }[] = [];
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    calls.push({ url: String(input), body, headers: new Headers(init?.headers as Record<string, string>) });
    return answer(String(input), body);
  }) as typeof fetch;
  return { f, calls };
}
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json" } });

const orEntry: ModelEntry = { name: "x", via: "openrouter", model: "x-ai/grok-4.7", reasoning: "low" };

test("OpenRouter: the captured prompt, a strict schema, and the answer parsed by production's parser", async () => {
  const { f, calls } = fakeFetch(() =>
    json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ playerId: "fa1", confidence: 0.82, reason: "Starts." }) } }], usage: { prompt_tokens: 900, completion_tokens: 60, cost: 0.0021 } }),
  );
  const k = contender(orEntry, { OPENROUTER_API_KEY: "or-test" }, new Map(), f);
  const call = await k.judge(outStarter.input);
  assert.deepEqual(call.answer, { playerId: "fa1", confidence: 0.82, reason: "Starts." });
  assert.deepEqual(call.usage, { inputTokens: 900, outputTokens: 60, costUsd: 0.0021 });
  const c = calls[0]!;
  assert.equal(c.url, "https://openrouter.ai/api/v1/chat/completions");
  assert.equal(c.headers.get("authorization"), "Bearer or-test");
  assert.equal(c.body.model, "x-ai/grok-4.7");
  const messages = c.body.messages as { role: string; content: string }[];
  assert.match(messages[0]!.content, /RosterBots' judge/);
  assert.equal(messages[1]!.content, JSON.stringify(outStarter.input));
  assert.deepEqual((c.body.response_format as { json_schema: { strict: boolean } }).json_schema.strict, true);
  assert.deepEqual(c.body.reasoning, { effort: "low" });
});

test("OpenRouter: a refusal to answer in the schema, or an HTTP error, is no answer with a name", async () => {
  const bad = contender(orEntry, { OPENROUTER_API_KEY: "k" }, new Map(), fakeFetch(() => json({ choices: [{ message: { content: "sorry" } }] })).f);
  assert.deepEqual([(await bad.judge(outStarter.input)).answer, (await bad.judge(outStarter.input)).error], [undefined, "unparseable answer"]);
  const limited = contender(orEntry, { OPENROUTER_API_KEY: "k" }, new Map(), fakeFetch(() => json({}, 429)).f);
  assert.equal((await limited.judge(outStarter.input)).error, "http 429");
});

test("OpenRouter advice: the report tool is forced and its arguments parsed by production's parser", async () => {
  const items = [{ kind: "construction", title: "No backup TE", body: "Add one.", sources: ["ESPN"], add: "f2", drop: "r10", dropOutForSeason: false, expiresAt: null }];
  const { f, calls } = fakeFetch(() => json({ choices: [{ message: { tool_calls: [{ function: { name: "report_advice", arguments: JSON.stringify({ items }) } }] } }], usage: { cost: 0.01 } }));
  const call = await contender(orEntry, { OPENROUTER_API_KEY: "k" }, new Map(), f).advise(advice.input, { web: true });
  assert.equal(call.answer?.length, 1);
  assert.deepEqual(call.answer?.[0]?.action, { add: "f2", drop: "r10" });
  assert.deepEqual(calls[0]!.body.tool_choice, { type: "function", function: { name: "report_advice" } });
  assert.deepEqual(calls[0]!.body.plugins, [{ id: "web", max_results: 6 }]);
});

test("Anthropic direct: production's adapter, metered, priced from OpenRouter's listing", async () => {
  const { f, calls } = fakeFetch(() =>
    json({
      id: "msg_1",
      type: "message",
      role: "assistant",
      model: "claude-sonnet-5-5",
      content: [{ type: "text", text: JSON.stringify({ playerId: "fa1", confidence: 0.9, reason: "Starts." }) }],
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 1000, output_tokens: 100 },
    }),
  );
  const entry: ModelEntry = { name: "prod", via: "anthropic", model: "claude-sonnet-5-5", priceFrom: "anthropic/claude-sonnet-5.5" };
  const prices = new Map([["anthropic/claude-sonnet-5.5", { prompt: 0.000002, completion: 0.00001 }]]);
  const call = await contender(entry, { ANTHROPIC_API_KEY: "sk-test" }, prices, f).judge(outStarter.input);
  assert.equal(call.answer?.playerId, "fa1");
  assert.equal(call.usage.inputTokens, 1000);
  assert.ok(Math.abs(call.usage.costUsd! - (1000 * 0.000002 + 100 * 0.00001)) < 1e-12);
  assert.match(calls[0]!.headers.get("authorization") ?? calls[0]!.headers.get("x-api-key") ?? "", /sk-test/);
  assert.equal(calls[0]!.body.model, "claude-sonnet-5-5");
});

test("preflight stops on a missing key or an id OpenRouter doesn't have, and suggests that author's newest", async () => {
  const catalog = { data: [
    { id: "x-ai/grok-4.7", created: 3, pricing: { prompt: "0.000002", completion: "0.000006" } },
    { id: "x-ai/grok-4.6", created: 2, pricing: { prompt: "0.000002", completion: "0.000006" } },
  ] };
  const { f } = fakeFetch(() => json(catalog));
  const typo: ModelEntry = { name: "grok", via: "openrouter", model: "x-ai/grok-9" };
  const r = await preflight([typo], {}, f);
  assert.equal(r.problems.length, 2);
  assert.match(r.problems[0]!, /OPENROUTER_API_KEY/);
  assert.match(r.problems[1]!, /x-ai\/grok-4\.7, x-ai\/grok-4\.6/);
  const ok = await preflight([orEntry], { OPENROUTER_API_KEY: "k" }, f);
  assert.deepEqual(ok.problems, []);
});

// ---------------------------------------------------------------- Shadow mode

test("shadow mode answers with the primary at once and logs every model's answer after", async () => {
  const quick = { name: "prod", judge: { pick: async (): Promise<AiChoice> => ({ playerId: "fa1", confidence: 0.9, reason: "a" }) } };
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const slow = { name: "slow", judge: { pick: async (): Promise<AiChoice> => (await gate, { playerId: null, confidence: 0.4, reason: "b" }) } };
  const logged: ShadowRecord[] = [];
  let pending: Promise<unknown> | undefined;
  const j = shadowJudge(quick, [slow], (r) => void logged.push(r), (p) => (pending = p));
  const answer = await j.pick(outStarter.input);
  assert.equal(answer?.playerId, "fa1");
  assert.equal(logged.length, 0, "the slow shadow has not answered, and nothing waited for it");
  release();
  await pending;
  assert.deepEqual(logged[0]!.answers.map((a) => [a.model, a.primary, a.pick]), [["prod", true, "fa1"], ["slow", false, null]]);
});

// ---------------------------------------------------------------- Review sheet

test("the review sheet's CSV survives quotes, commas and line breaks", () => {
  const rows = parseCsv('a,b,c\n"x, y","say ""hi""","two\nlines"\r\n1,,3\n');
  assert.deepEqual(rows, [["a", "b", "c"], ["x, y", 'say "hi"', "two\nlines"], ["1", "", "3"]]);
});

// ---------------------------------------------------------------- The command line, end to end

test("run.ts judge on the examples with offline mocks writes results and a report", () => {
  const dir = mkdtempSync(join(tmpdir(), "bench-"));
  try {
    const out = join(dir, "judge.jsonl");
    const table = execFileSync(process.execPath, [join(BENCH, "run.ts"), "judge", "--examples", "--models", "mock-best,mock-keep,mock-offlist,mock-silent", "--repeats", "2", "--out", out], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    const lines = readFileSync(out, "utf8").trim().split("\n");
    assert.equal(lines.length, 3 * 4 * 2, "three graded examples, four mocks, two repeats; the ungraded one skipped");
    assert.match(table, /\| mock-best \| 33% \|/, "right on the out starter; fooled by the marginal upgrade and the questionable scratch");
    assert.match(readFileSync(out.replace(/\.jsonl$/, ".md"), "utf8"), /Auto dud/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

