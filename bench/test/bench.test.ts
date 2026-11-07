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
import type { AiChoice, JudgeInput } from "@rosterbots/core";
import { adviceDetails } from "../lib/detail.ts";
import { BENCH, loadJson } from "../lib/files.ts";
import { adviceRequest, judgeRequest } from "../lib/prompts.ts";
import { contender, preflight } from "../lib/providers.ts";
import { replay } from "../lib/replay.ts";
import { asksFor, parseScratch, scratchInput, SCRATCH_SCHEMA, SCRATCH_SYSTEM } from "../lib/scratch.ts";
import { checkAdvice, scoreJudge, summarizeJudge, summarizeScratch, ungraded } from "../lib/score.ts";
import type { AdviceCase, Call, JudgeCase, JudgeRecord, ModelEntry, ReplayCase, ScratchCase, ScratchRecord } from "../lib/types.ts";
import { parseCsv } from "../review.ts";
import { shadowJudge, type ShadowRecord } from "../shadow.ts";

const judgeCases = loadJson<JudgeCase>(join(BENCH, "cases", "judge"));
const caseOf = (id: string): JudgeCase => judgeCases.find((c) => c.id === id)!;
const outStarter = caseOf("example-01-out-starter");
const benchFine = caseOf("example-02-bench-is-fine");
const trap = caseOf("example-03-scratch-trap");
const advice = loadJson<AdviceCase>(join(BENCH, "cases", "advice")).find((c) => c.id === "example-01-midweek")!;

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
    { kind: "fit", title: "ok", body: "Add Example Free TE, drop Example Bench WR.", sources: ["ESPN"], action: { add: "f2", drop: "r10" } },
    { kind: "fit", title: "ghost", body: "b", sources: [], action: { add: "f99" } },
    { kind: "fit", title: "waiver", body: "Add Example Waiver WR, drop Example Bench RB.", sources: [], action: { add: "f3", drop: "r11" } },
    { kind: "fit", title: "starter", body: "Add Example Backup to Hurt RB, drop Example RB Two.", sources: [], action: { add: "f1", drop: "r3" } },
    { kind: "injury", title: "hurt", body: "b", sources: ["ESPN"] },
    { kind: "fit", title: "not droppable", body: "Add Example Free Defense, drop Example Defense.", sources: [], action: { add: "f4", drop: "r8" } },
    // Kimi's mix-up: the words drop one player, the id drops another.
    { kind: "fit", title: "mix-up", body: "Add Example Free TE, drop Example Bench RB.", sources: ["ESPN"], action: { add: "f2", drop: "r10" } },
  ]);
  assert.deepEqual(items[0]!.flags, []);
  assert.deepEqual(items[6]!.flags, ["integrity"], "production's integrity check, the same code");
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
  const gone = contender(orEntry, { OPENROUTER_API_KEY: "k" }, new Map(), fakeFetch(() => json({ error: { code: 402, message: "Insufficient credits" } }, 402)).f);
  assert.equal((await gone.judge(outStarter.input)).error, "http 402 (Insufficient credits)", "OpenRouter's reason is kept");
});

const busy = (provider: string) =>
  new Response(JSON.stringify({ error: { code: 429, message: "Rate limit exceeded", metadata: { provider_name: provider } } }), {
    status: 429,
    headers: { "content-type": "application/json", "retry-after": "0" },
  });

test("OpenRouter: a 429 is busy, not broke: retried, and named with the provider if it never clears", async () => {
  let n = 0;
  const once = fakeFetch(() => (n++ === 0 ? busy("xAI") : json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ playerId: "fa1", confidence: 0.9, reason: "Starts." }) } }] })));
  const k = contender(orEntry, { OPENROUTER_API_KEY: "k" }, new Map(), once.f);
  assert.equal((await k.judge(outStarter.input)).answer?.playerId, "fa1");
  assert.equal(once.calls.length, 2);
  const always = fakeFetch(() => busy("xAI"));
  const stuck = contender(orEntry, { OPENROUTER_API_KEY: "k" }, new Map(), always.f);
  assert.equal((await stuck.judge(outStarter.input)).error, "http 429 (xAI: Rate limit exceeded)");
  assert.equal(always.calls.length, 4, "the first try and three more");
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

test("every-tool advice on OpenRouter: server tools offered, the report left to the model, Grok told to search X, the trace read back", async () => {
  const items = [{ kind: "fit", title: "Add a back", body: "He starts.", sources: ["https://espn.com/a"], add: "f2", drop: "r10", dropOutForSeason: false, expiresAt: null }];
  const { f, calls } = fakeFetch(() =>
    json({
      provider: "xAI",
      choices: [{
        finish_reason: "tool_calls",
        message: {
          content: null,
          reasoning: null,
          reasoning_details: [{ type: "reasoning.encrypted", data: "x" }, { type: "reasoning.summary", summary: "Checked X for the beat reporters." }],
          annotations: [
            { type: "url_citation", url_citation: { url: "https://x.com/beat/status/1", title: "Beat writer", content: "He is out." } },
            { type: "url_citation", url_citation: { url: "https://x.com/beat/status/1", title: "dup" } },
          ],
          tool_calls: [{ function: { name: "report_advice", arguments: JSON.stringify({ items }) } }],
        },
      }],
      usage: { cost: 0.03, server_tool_use_details: { web_search_requests: 2, tool_calls_requested: 4, tool_calls_executed: 4 } },
    }),
  );
  const grok: ModelEntry = { name: "grok", via: "openrouter", model: "x-ai/grok-4.7", reasoning: "low" };
  const call = await contender(grok, { OPENROUTER_API_KEY: "k" }, new Map(), f).advise(advice.input, { web: false, tools: "all" });
  const body = calls[0]!.body;
  assert.equal(body.tool_choice, "auto", "forcing the report would skip the tools");
  const tools = body.tools as { type: string; parameters?: { x_search?: unknown } }[];
  assert.deepEqual(tools.map((t) => t.type), ["openrouter:web_search", "openrouter:web_fetch", "openrouter:datetime", "function"]);
  assert.deepEqual(tools[0]!.parameters?.x_search, {}, "X search on for xAI");
  assert.match((body.messages as { content: string }[])[0]!.content, /search X/);
  assert.equal(call.answer?.length, 1);
  assert.deepEqual(call.usage, { costUsd: 0.03, webSearches: 2 });
  assert.equal(call.trace?.provider, "xAI");
  assert.equal(call.trace?.reasoning, "Checked X for the beat reporters.");
  assert.equal(call.trace?.reasoningHidden, true);
  assert.deepEqual(call.trace?.toolCounts, { web_search: 2, "other server tools (fetch, date, X)": 2 });
  assert.deepEqual(call.trace?.citations, [{ url: "https://x.com/beat/status/1", title: "Beat writer", snippet: "He is out." }]);

  const deepseek: ModelEntry = { name: "ds", via: "openrouter", model: "deepseek/deepseek-v4.1-flash" };
  const other = fakeFetch(() => json({ choices: [{ message: { content: "I think you should add someone." } }] }));
  const noReport = await contender(deepseek, { OPENROUTER_API_KEY: "k" }, new Map(), other.f).advise(advice.input, { web: false, tools: "all" });
  assert.equal((other.calls[0]!.body.tools as { parameters?: { x_search?: unknown } }[])[0]!.parameters?.x_search, undefined, "no X search off xAI");
  assert.doesNotMatch((other.calls[0]!.body.messages as { content: string }[])[0]!.content, /search X/);
  assert.equal(other.calls.length, 2, "a second, forced call to report");
  assert.deepEqual(other.calls[1]!.body.tool_choice, { type: "function", function: { name: "report_advice" } });
  assert.equal(other.calls[1]!.body.tools && (other.calls[1]!.body.tools as unknown[]).length, 1, "no web tools the second time");
  assert.match(String((other.calls[1]!.body.messages as { content: string }[])[2]!.content), /I think you should add someone/);
  assert.equal(noReport.error, "no report after reformatting (no report)");
  assert.equal(noReport.trace?.text, "I think you should add someone.", "what it wrote instead is kept");
  assert.equal(noReport.trace?.reformatted, true);
});

test("every-tool advice on OpenRouter: a report in the wrong fields is put into production's form, same advice, both calls paid", async () => {
  let n = 0;
  const good = [{ kind: "fit", title: "Add Dobbins", body: "Coleman's backup.", sources: ["https://a.com/1"], add: "f2", drop: "r10", dropOutForSeason: false, expiresAt: null }];
  const { f, calls } = fakeFetch(() =>
    n++ === 0
      ? json({ choices: [{ message: { tool_calls: [{ function: { name: "report_advice", arguments: JSON.stringify({ items: [{ kind: "fit", detail: "Add Dobbins.", add: "f2" }] }) } }], annotations: [{ type: "url_citation", url_citation: { url: "https://a.com/1" } }] } }], usage: { cost: 0.05, server_tool_use_details: { web_search_requests: 3, tool_calls_executed: 3 } } })
      : json({ choices: [{ message: { tool_calls: [{ function: { name: "report_advice", arguments: JSON.stringify({ items: good }) } }] } }], usage: { cost: 0.01 } }),
  );
  const call = await contender({ name: "gpt", via: "openrouter", model: "openai/gpt-6.1-terra" }, { OPENROUTER_API_KEY: "k" }, new Map(), f).advise(advice.input, { web: false, tools: "all" });
  assert.equal(calls.length, 2);
  const told = String((calls[1]!.body.messages as { content: string }[])[2]!.content);
  assert.match(told, /wrong fields: \{"items":\[\{"kind":"fit","detail":"Add Dobbins\."/);
  assert.match(told, /Pages I read: https:\/\/a\.com\/1/);
  assert.equal(call.answer?.[0]?.title, "Add Dobbins");
  assert.ok(Math.abs(call.usage.costUsd! - 0.06) < 1e-12, "both calls' cost");
  assert.equal(call.usage.webSearches, 3);
  assert.equal(call.trace?.reformatted, true);
});

test("every-tool advice with Claude: search and fetch itemized, thinking shown, a paused turn continued, searches priced", async () => {
  let n = 0;
  const { f, calls } = fakeFetch(() => {
    n++;
    const base = { id: `msg_${n}`, type: "message", role: "assistant", model: "claude-opus-5-5", stop_sequence: null };
    if (n === 1)
      return json({
        ...base,
        stop_reason: "pause_turn",
        content: [
          { type: "thinking", thinking: "Coleman's backup first.", signature: "s" },
          { type: "server_tool_use", id: "srv_1", name: "web_search", input: { query: "Broncos RB depth chart" } },
          { type: "web_search_tool_result", tool_use_id: "srv_1", content: [{ type: "web_search_result", url: "https://a.com/1", title: "Depth chart" }] },
          { type: "server_tool_use", id: "srv_2", name: "web_fetch", input: { url: "https://a.com/1" } },
          { type: "web_fetch_tool_result", tool_use_id: "srv_2", content: { type: "web_fetch_result", url: "https://a.com/1", content: { type: "document", title: "Depth chart" } } },
        ],
        usage: { input_tokens: 1000, output_tokens: 100, server_tool_use: { web_search_requests: 1, web_fetch_requests: 1 } },
      });
    return json({
      ...base,
      stop_reason: "tool_use",
      content: [{ type: "tool_use", id: "toolu_1", name: "report_advice", input: { items: [{ kind: "fit", title: "Add Dobbins", body: "Coleman's backup.", sources: ["https://a.com/1"], add: "f2", drop: null, dropOutForSeason: false, expiresAt: null }] } }],
      usage: { input_tokens: 2000, output_tokens: 200 },
    });
  });
  const entry: ModelEntry = { name: "opus", via: "anthropic", model: "claude-opus-5-5", priceFrom: "anthropic/claude-opus-5.5" };
  const prices = new Map([["anthropic/claude-opus-5.5", { prompt: 0.000004, completion: 0.00002 }]]);
  const call = await contender(entry, { ANTHROPIC_API_KEY: "sk-test" }, prices, f).advise(advice.input, { web: false, tools: "all" });
  assert.equal(calls.length, 2, "the paused turn is continued");
  const tools = calls[0]!.body.tools as { type?: string; name: string; max_uses?: number }[];
  assert.deepEqual(tools.map((t) => t.name), ["web_search", "web_fetch", "report_advice"]);
  assert.equal(tools[0]!.max_uses, undefined, "no search cap");
  assert.deepEqual(calls[0]!.body.thinking, { type: "adaptive", display: "summarized" });
  assert.equal(call.answer?.[0]?.title, "Add Dobbins");
  assert.equal(call.trace?.reasoning, "Coleman's backup first.");
  assert.deepEqual(call.trace?.tools, [
    { tool: "web_search", query: "Broncos RB depth chart", results: [{ url: "https://a.com/1", title: "Depth chart" }] },
    { tool: "web_fetch", url: "https://a.com/1", results: [{ url: "https://a.com/1", title: "Depth chart" }] },
  ]);
  assert.deepEqual([call.usage.webSearches, call.usage.webFetches], [1, 1]);
  assert.ok(Math.abs(call.usage.costUsd! - (3000 * 0.000004 + 300 * 0.00002 + 0.01)) < 1e-12, "tokens plus $0.01 a search");
});

test("the run-by-run report: names for ids, tools, what they found, reasoning, failures, the answer", () => {
  const fa = advice.input.freeAgents[0]!;
  const md = adviceDetails([advice], [
    {
      job: "advice", model: "opus", caseId: advice.id, rep: 1, at: "", latencyMs: 120_000, costUsd: 0.4, webSearches: 1, tools: "all",
      items: [{ kind: "fit", title: "Add him", body: "Because.", sources: ["https://a.com/1"], action: { add: fa.id } }],
      trace: { tools: [{ tool: "web_search", query: "q", results: [{ url: "https://a.com/1", title: "T" }] }], reasoning: "Thought it through." },
    },
    { job: "advice", model: "kimi", caseId: advice.id, rep: 1, at: "", latencyMs: 5000, tools: "all", error: "no report", trace: { tools: [], text: "Prose instead." } },
  ]);
  assert.match(md, /120 s · \$0\.400 · 1 searches/);
  assert.doesNotMatch(md, /100 s/, "speed is reported, not judged");
  assert.match(md, /web_search "q" → 1 results: a\.com/);
  assert.match(md, new RegExp(`Add \\*\\*${fa.name}\\*\\*`));
  assert.match(md, /> Thought it through\./);
  assert.match(md, /\*\*Failure:\*\* no report/);
  assert.match(md, /> Prose instead\./);
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

// ---------------------------------------------------------------- Replay

test("replay: a wrong pick the next check catches is fixed when there is room; not when the first add used it, or ESPN is too late for T-3", async () => {
  const cases = loadJson<ReplayCase>(join(BENCH, "cases", "replay"));
  const of = (id: string) => cases.find((c) => c.id.startsWith(id))!;
  const greedy = contender({ name: "g", via: "mock", model: "best-projection" }, {}, new Map());
  const pts = async (id: string) => (await replay(of(id), (i) => greedy.judge(i))).points;
  // It adds the questionable back at T-15 every time; what happens next is the engine's.
  assert.equal(await pts("example-01"), 10.5, "caught at T-10, the backup added with the open IR slot");
  assert.equal(await pts("example-02"), 0, "caught, but the only Droppable player went for the first add");
  assert.equal(await pts("example-03"), 0, "ESPN shows him OUT at T-2: past T-3, nothing is automatic");
  assert.equal(await pts("example-04"), 10.5, "OUT before T-15: the engine never offers him");
  const fixed = await replay(of("example-01"), (i) => greedy.judge(i));
  assert.equal(fixed.autoMoves, 2);
  assert.deepEqual(fixed.aiCalls.map((c) => c.offered.length), [2, 1], "asked again at T-10 with only the backup left");
});

test("replay: an answer costs its time on the clock, and one that lands after T-3 is no move", async () => {
  const c = loadJson<ReplayCase>(join(BENCH, "cases", "replay")).find((x) => x.id.startsWith("example-04"))!;
  const answer = (ms: number) => async (i: JudgeInput): Promise<Call<AiChoice>> => ({ answer: { playerId: i.candidates[0]!.id, confidence: 0.9, reason: "" }, latencyMs: ms, usage: {} });
  const quick = await replay(c, answer(4_000));
  assert.equal(quick.points, 10.5);
  assert.equal(quick.holeMinutes, 5, "a hole from the first check at T-20 until the T-15 add");
  const slow = await replay(c, answer(13 * 60_000));
  assert.equal(slow.points, 0, "asked at T-15, answered at T-2: too close to kickoff for an automatic move");
  const silent = await replay(c, async () => ({ answer: undefined, latencyMs: 0, usage: {} }));
  assert.deepEqual([silent.points, silent.autoMoves], [0, 0], "the rules alone only suggest, and nobody is awake to tap");
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


// ---------------------------------------------------------------- Scratch: will he play?

const scratchCases = loadJson<ScratchCase>(join(BENCH, "cases", "scratch"));
const warmups = scratchCases.find((c) => c.id === "example-01-warmups-scratch")!;
const tested = scratchCases.find((c) => c.id === "example-02-tested-and-played")!;

test("scratch: asked at T-100 and a minute after each dated item; only news published by then is shown", () => {
  assert.deepEqual(asksFor(warmups), ["2025-12-14T16:20:00.000Z", "2025-12-14T16:31:00.000Z", "2025-12-14T17:55:00.000Z"]);
  const before = scratchInput(warmups, "2025-12-14T16:20:00.000Z", false);
  assert.equal(before.inactiveList, "not posted yet");
  assert.equal(before.minutesToKickoff, 100);
  assert.deepEqual(before.news.map((n) => n.source), ["team injury report"]);
  const after = scratchInput(warmups, "2025-12-14T17:55:00.000Z", false);
  assert.equal(after.inactiveList, "active");
  assert.equal(after.news.length, 2);
});

test("scratch: hidden names replace the player (full, first, last), both teams and the case's aliases, whole words only", () => {
  const c: ScratchCase = { ...warmups, news: [{ at: "2025-12-14T17:54:00Z", source: "EXA PR", words: "Sam Example's foot: Example is out, the Examplers say; EXAMPLE and EXB are unchanged." }] };
  const h = scratchInput(c, "2025-12-14T17:55:00.000Z", true);
  assert.deepEqual([h.player, h.team, h.opponent], ["Player A", "Team A", "Team B"]);
  assert.equal(h.news[0]!.text, "Player A's foot: Player A is out, the Team A say; EXAMPLE and Team B are unchanged.");
  assert.equal(h.news[0]!.source, "Team A PR");
});

test("scratch: a mock that believes 'ruled out' catches the warmups scratch at T-5 and never benches the player who played", async () => {
  const run = async (name: string, model: string): Promise<ScratchRecord[]> => {
    const k = contender({ name, via: "mock", model }, {}, new Map());
    const out: ScratchRecord[] = [];
    for (const c of [warmups, tested])
      for (const asked of asksFor(c)) {
        const call = await k.ask({ system: SCRATCH_SYSTEM, user: JSON.stringify(scratchInput(c, asked, false)), schema: SCRATCH_SCHEMA });
        const a = parseScratch(call.answer)!;
        out.push({ job: "scratch", model: name, caseId: c.id, rep: 1, at: "", latencyMs: 1, costUsd: 0, hidden: false, asked, out: a.out, reason: a.reason });
      }
    return out;
  };
  const [kw] = summarizeScratch([warmups, tested], await run("mock-keyword", "keyword"));
  assert.deepEqual({ benched: kw!.benchedWild, caught: kw!.caughtWild, guessed: kw!.guessedWild, early: kw!.earlyMinutes }, { benched: 0, caught: 1, guessed: 0, early: 5 });
  const [never] = summarizeScratch([warmups, tested], await run("mock-never", "never"));
  assert.deepEqual({ benched: never!.benchedFloor, caught: never!.caughtFloor }, { benched: 0, caught: 0 });
  assert.equal(parseScratch({ out: 1.7, reason: "x" })!.out, 1, "clamped");
  assert.equal(parseScratch({ out: "high" }), undefined);
});
