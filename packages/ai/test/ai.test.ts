// The Anthropic adapter over a fake fetch: what it sends, what it makes of the answers, and
// that a failure is an absent answer, never a throw. Nothing here reaches Anthropic.
import { test } from "node:test";
import assert from "node:assert/strict";
import { anthropicAi, CHOICE_SCHEMA, DEFAULT_MODEL, parseAdvice, parseChoice, REPORT_TOOL } from "../src/index.ts";
import type { AdviceInput, JudgeInput } from "@rosterbots/core";

const usage = { input_tokens: 10, output_tokens: 10 };
const message = (content: unknown[], stop_reason = "end_turn") =>
  new Response(JSON.stringify({ id: "msg_1", type: "message", role: "assistant", model: DEFAULT_MODEL, content, stop_reason, stop_sequence: null, usage }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

function fakeFetch(answer: (n: number, body: Record<string, unknown>) => Response) {
  const calls: { url: string; headers: Headers; body: Record<string, unknown> }[] = [];
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    calls.push({ url: String(input), headers: new Headers(init?.headers as Record<string, string>), body });
    return answer(calls.length, body);
  }) as typeof fetch;
  return { f, calls };
}

const judgeInput: JudgeInput = {
  problem: "Achane was ruled OUT at RB",
  slot: "RB",
  now: "2026-10-04T16:45:00.000Z",
  kickoff: "2026-10-04T17:00:00.000Z",
  candidates: [{ id: "fa1", name: "Jordan Mason", position: "RB", proTeam: "MIN", status: "active", projection: 11.4, how: "free agent, open roster spot" }],
};

test("the judge asks for structured output in the configured model, with the key and nothing of the user's", async () => {
  const { f, calls } = fakeFetch(() => message([{ type: "text", text: JSON.stringify({ playerId: "fa1", confidence: 0.85, reason: "Mason starts for Minnesota." }) }]));
  const ai = anthropicAi({ apiKey: "sk-test", fetch: f });
  const choice = await ai.judge.pick(judgeInput);
  assert.deepEqual(choice, { playerId: "fa1", confidence: 0.85, reason: "Mason starts for Minnesota." });

  assert.equal(calls.length, 1);
  const c = calls[0]!;
  assert.equal(c.url, "https://api.anthropic.com/v1/messages");
  // The SDK sends the key as a bearer token in this version; either header is the same key.
  assert.match(c.headers.get("authorization") ?? c.headers.get("x-api-key") ?? "", /sk-test/);
  assert.equal(c.body.model, DEFAULT_MODEL);
  assert.deepEqual(c.body.output_config, { effort: "low", format: { type: "json_schema", schema: CHOICE_SCHEMA } });
  assert.deepEqual(c.body.thinking, { type: "adaptive" });
  assert.equal(c.body.max_tokens, 2500);
  assert.equal(JSON.stringify(c.body).includes("espn_s2"), false);
  assert.deepEqual(c.body.messages, [{ role: "user", content: JSON.stringify(judgeInput) }]);
});

test("a refusal, a cut-off answer, bad JSON, or an API error is no answer at all", async () => {
  const cases: ((n: number) => Response)[] = [
    () => message([{ type: "text", text: "{}" }], "refusal"),
    () => message([{ type: "text", text: '{"playerId":' }], "max_tokens"),
    () => message([{ type: "text", text: "not json" }]),
    () => new Response(JSON.stringify({ type: "error", error: { type: "overloaded_error", message: "busy" } }), { status: 529, headers: { "content-type": "application/json" } }),
  ];
  for (const answer of cases) {
    const errors: string[] = [];
    const ai = anthropicAi({ apiKey: "sk-test", fetch: fakeFetch(answer).f, onError: (w) => errors.push(w) });
    assert.equal(await ai.judge.pick(judgeInput), undefined);
  }
});

test("parseChoice clamps confidence and keeps null for leave-it-alone", () => {
  assert.deepEqual(parseChoice('{"playerId":null,"confidence":4,"reason":"keep"}'), { playerId: null, confidence: 1, reason: "keep" });
  assert.equal(parseChoice('{"playerId":5,"confidence":0.5}'), undefined);
  assert.equal(parseChoice('{"confidence":"high"}'), undefined);
});

const adviceInput: AdviceInput = {
  teamName: "Trust The Process",
  week: 5,
  now: "2026-10-06T14:00:00.000Z",
  starterSlots: ["QB", "RB", "RB", "WR", "WR", "FLEX", "DST"],
  roster: [{ id: "a", name: "De'Von Achane", position: "RB", proTeam: "MIA", slot: "RB", status: "questionable", projection: 15 }],
  freeAgents: [{ id: "fa1", name: "Jordan Mason", position: "RB", proTeam: "MIN", status: "active", projection: 11.4, onWaivers: false }],
  droppable: ["wr3"],
};

test("the advisor offers web search and the report tool, continues a paused turn, and takes the report", async () => {
  const items = [
    { kind: "rb_backup", title: "Mason is worth a look", body: "Achane is questionable; Mason is free.", sources: ["https://example.com/news"], add: "fa1", drop: "wr3", dropOutForSeason: false, expiresAt: "2026-10-11T17:00:00Z" },
    { kind: "bye", title: "Three starters on bye in week 9", body: "Plan ahead.", sources: ["ESPN"], add: null, drop: null, dropOutForSeason: false, expiresAt: null },
    { kind: "injury", title: "Achane tore his ACL", body: "Season over; ESPN still says questionable.", sources: ["https://example.com/acl"], add: "fa1", drop: "a", dropOutForSeason: true, expiresAt: null },
  ];
  const { f, calls } = fakeFetch((n) =>
    n === 1
      ? message([{ type: "server_tool_use", id: "srvtoolu_1", name: "web_search", input: { query: "Achane injury" } }], "pause_turn")
      : message([{ type: "tool_use", id: "toolu_1", name: "report_advice", input: { items } }], "tool_use"),
  );
  const ai = anthropicAi({ apiKey: "sk-test", fetch: f, maxSearches: 3 });
  const advice = await ai.advisor.advise(adviceInput);
  assert.deepEqual(advice, [
    { kind: "rb_backup", title: "Mason is worth a look", body: "Achane is questionable; Mason is free.", sources: ["https://example.com/news"], action: { add: "fa1", drop: "wr3" }, expiresAt: "2026-10-11T17:00:00.000Z" },
    { kind: "bye", title: "Three starters on bye in week 9", body: "Plan ahead.", sources: ["ESPN"] },
    { kind: "injury", title: "Achane tore his ACL", body: "Season over; ESPN still says questionable.", sources: ["https://example.com/acl"], action: { add: "fa1", drop: "a", outForSeason: true } },
  ]);

  assert.equal(calls.length, 2);
  const tools = calls[0]!.body.tools as { type?: string; name: string; max_uses?: number; strict?: boolean }[];
  assert.deepEqual(tools.map((t) => t.name), ["web_search", "report_advice"]);
  assert.equal(tools[0]!.type, "web_search_20260209");
  assert.equal(tools[0]!.max_uses, 3);
  assert.equal(tools[1]!.strict, true);
  assert.deepEqual(calls[0]!.body.thinking, { type: "adaptive" });
  // The second call carries the first answer back, so the search continues where it paused.
  const second = calls[1]!.body.messages as { role: string }[];
  assert.deepEqual(second.map((m) => m.role), ["user", "assistant"]);
});

test("an answer without the report, or an error, is no advice", async () => {
  const text = anthropicAi({ apiKey: "sk-test", fetch: fakeFetch(() => message([{ type: "text", text: "Nothing to report." }])).f });
  assert.deepEqual(await text.advisor.advise(adviceInput), []);
  const down = anthropicAi({ apiKey: "sk-test", fetch: fakeFetch(() => new Response("gateway", { status: 502 })).f });
  assert.deepEqual(await down.advisor.advise(adviceInput), []);
});

test("parseAdvice keeps only well-formed items, at most five, and never an unknown kind", () => {
  const many = Array.from({ length: 7 }, (_, i) => ({ kind: "fit", title: `t${i}`, body: "b", sources: [], add: null, drop: null, dropOutForSeason: false, expiresAt: null }));
  assert.equal(parseAdvice({ items: many }).length, 5);
  assert.deepEqual(parseAdvice({ items: [{ kind: "trade", title: "x", body: "y", sources: [], add: null, drop: null, dropOutForSeason: false, expiresAt: null }] }), []);
  assert.deepEqual(parseAdvice({ items: [{ kind: "injury", title: "", body: "y", sources: [], add: null, drop: null, dropOutForSeason: false, expiresAt: null }] }), []);
  // The season-over word only ever travels with a drop.
  assert.equal(parseAdvice({ items: [{ kind: "fit", title: "x", body: "y", sources: [], add: "fa1", drop: null, dropOutForSeason: true, expiresAt: null }] })[0]?.action?.outForSeason, undefined);
  assert.deepEqual(parseAdvice("nope"), []);
  assert.equal(REPORT_TOOL.input_schema.type, "object");
});
