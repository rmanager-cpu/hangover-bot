// The shared research bench, offline: fake fetches stand in for ESPN, OpenRouter and Anthropic.
//   node --test bench/test/*.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import type { AdviceInput } from "@rosterbots/core";
import { contender } from "../lib/providers.ts";
import { BRIEF_TOOL, buildResearchCase, checkBrief, parseBrief, RESEARCH_SYSTEM, researchDetails, researchTable, researchUser, summarizeResearch, teamsIn, usableBrief } from "../lib/research.ts";
import type { Brief, Fact, ModelEntry, ResearchCase, ResearchRecord } from "../lib/types.ts";

function fakeFetch(answer: (url: string, body: Record<string, unknown>, headers: Headers) => Response) {
  const calls: { url: string; body: Record<string, unknown>; headers: Headers }[] = [];
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    const headers = new Headers(init?.headers as Record<string, string>);
    calls.push({ url: String(input), body, headers });
    return answer(String(input), body, headers);
  }) as typeof fetch;
  return { f, calls };
}
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json" } });

/** A finished Anthropic message as the stream the SDK reads: each block started, filled and stopped. */
type Block = { type: string; [k: string]: unknown };
function sse(msg: { content: Block[]; usage: Record<string, unknown>; stop_reason: string; [k: string]: unknown }): Response {
  const events: unknown[] = [{ type: "message_start", message: { ...msg, content: [], stop_reason: null, usage: { ...msg.usage, output_tokens: 0 } } }];
  msg.content.forEach((b, index) => {
    const start =
      b.type === "text" ? { ...b, text: "" } : b.type === "thinking" ? { ...b, thinking: "", signature: "" } : b.type === "tool_use" || b.type === "server_tool_use" ? { ...b, input: {} } : b;
    events.push({ type: "content_block_start", index, content_block: start });
    if (b.type === "text") events.push({ type: "content_block_delta", index, delta: { type: "text_delta", text: b.text } });
    if (b.type === "thinking") events.push({ type: "content_block_delta", index, delta: { type: "thinking_delta", thinking: b.thinking } }, { type: "content_block_delta", index, delta: { type: "signature_delta", signature: b.signature } });
    if (b.type === "tool_use" || b.type === "server_tool_use") events.push({ type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: JSON.stringify(b.input) } });
    events.push({ type: "content_block_stop", index });
  });
  events.push({ type: "message_delta", delta: { stop_reason: msg.stop_reason, stop_sequence: null }, usage: msg.usage }, { type: "message_stop" });
  const text = events.map((e) => `event: ${(e as { type: string }).type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
  return new Response(text, { status: 200, headers: { "content-type": "text/event-stream" } });
}

const c: ResearchCase = {
  id: "w10",
  season: 2026,
  week: 10,
  question: "Tell me what I need to know about week 10, please?",
  builtAt: "2026-11-10T10:00:00.000Z",
  targets: [
    { id: "1", name: "Tyreek Hill", position: "WR", proTeam: "MIA", status: "active", byeWeek: 12, on: "free agent" },
    { id: "2", name: "Justice Hill", position: "RB", proTeam: "BAL", status: "out", byeWeek: 13, on: "free agent" },
    { id: "3", name: "Chris Rodriguez Jr.", position: "RB", proTeam: "WSH", status: "questionable", byeWeek: 10, on: "roster" },
    { id: "-16026", name: "Seahawks D/ST", position: "DST", proTeam: "SEA", status: "active", byeWeek: 10, on: "both" },
    { id: "5", name: "Lamar Jackson", position: "QB", proTeam: "BAL", status: "ir", byeWeek: 13, on: "roster" },
  ],
};
const fact = (over: Partial<Fact>): Fact => ({ playerId: null, player: "x", team: "", kind: "injury", tier: "reported", sourceKind: "beat_reporter", claim: "x", sources: ["https://a.com/1"], ...over });

test("the brief's form: what's well formed is kept, the rest counted and left out", () => {
  const b = parseBrief({
    summary: ["Byes: Commanders, Seahawks.", " ", 7],
    facts: [
      { playerId: "2", player: "Justice Hill", team: "BAL", kind: "injury", tier: "reported", sourceKind: "beat_reporter", claim: "Justice Hill is week to week.", sources: ["https://a.com/1"], asOf: null },
      { playerId: null, player: "Commanders", team: "WSH", kind: "bye", tier: "confirmed", sourceKind: "team", claim: "On bye.", sources: [], asOf: "2026-04-01" },
      { player: "No kind", tier: "reported", claim: "x" },
      { playerId: "1", player: "Tyreek Hill", kind: "role", tier: "rumor", claim: "x" },
    ],
  });
  assert.ok(b);
  assert.deepEqual(b.summary, ["Byes: Commanders, Seahawks."]);
  assert.equal(b.facts.length, 2);
  assert.equal(b.malformed, 2, "no kind, and a tier that isn't one of the three");
  assert.equal(b.facts[1]!.asOf, "2026-04-01");
  assert.equal(parseBrief({ items: [] }), undefined, "not a brief at all");
  assert.equal(parseBrief("text"), undefined);
});

test("teams are found by nickname or by abbreviation in capitals, other sites' abbreviations included", () => {
  assert.deepEqual([...teamsIn("Byes: the Seahawks and WAS, plus no game for JAC")].sort(), ["JAX", "SEA", "WSH"]);
  assert.deepEqual([...teamsIn("no bye for anyone in the east")], []);
  assert.deepEqual([...teamsIn("Week 10 byes: Chicago, Denver, Philadelphia and Tampa Bay.")].sort(), ["CHI", "DEN", "PHI", "TB"], "by city: GPT-6.1 Terra, Nov 8");
  assert.deepEqual([...teamsIn("New York and Los Angeles each have two teams")], []);
});

test("a bye fact's teams are its title's when it names one, and a player's name is never a city (GPT-6.1 Sol, Nov 8)", () => {
  const withRaider: ResearchCase = {
    ...c,
    targets: [
      ...c.targets,
      { id: "9", name: "Mike Washington Jr.", position: "RB", proTeam: "LV", status: "active", byeWeek: 8, on: "free agent" },
      { id: "10", name: "Malik Nabers", position: "WR", proTeam: "NYG", status: "active", byeWeek: 14, on: "roster" },
    ],
  };
  const sol = fact({ kind: "bye", tier: "confirmed", sourceKind: "team", player: "Seattle Seahawks", team: "SEA", claim: "Seattle has no Week 10 game; it last plays the Giants on Nov. 8 before the bye.", sources: ["https://www.seahawks.com/x"] });
  const r = checkBrief(withRaider, { summary: ["Week 10 byes: Washington stays busy; Mike Washington runs for the Raiders."], facts: [sol], malformed: 0 });
  assert.deepEqual(r.wrongByes, [], "the Giants were the last opponent, not a bye team");
  assert.deepEqual(r.facts[0]!.flags, []);
  assert.equal(r.byesNamed, 2, "Seattle from the fact; Washington (bye 10 in this case) from the summary, Mike Washington taken out first");
});

test("every fact is checked: ids we sent, words that name him, confirmed backed by its pages, a source, byes against ESPN", () => {
  const b: Brief = {
    summary: ["No games for the Commanders and Seahawks this week (byes)."],
    malformed: 0,
    facts: [
      fact({ playerId: "2", player: "Justice Hill", claim: "Out with a hamstring." }),
      fact({ playerId: "1", player: "Justice Hill", claim: "Hill is out.", tier: "confirmed", sourceKind: "national_insider" }),
      fact({ playerId: "99", player: "Nobody", claim: "x" }),
      fact({ playerId: "3", player: "Chris Rodriguez", claim: "Limited Wednesday.", sources: [] }),
      fact({ playerId: null, player: "Byes", team: "", kind: "bye", claim: "Seahawks, Ravens on bye.", sources: [] }),
      fact({ playerId: "-16026", player: "Seahawks D/ST", team: "SEA", kind: "bye", claim: "The Seahawks D/ST is on bye: stream.", sources: [] }),
      fact({ playerId: "5", player: "Lamar Jackson", claim: "Lamar Jackson stays on IR.", tier: "confirmed", sourceKind: "team", sources: ["https://esportport.com/week-10"] }),
      fact({ playerId: "5", player: "Lamar Jackson", claim: "Lamar Jackson stays on IR.", tier: "confirmed", sourceKind: "team", sources: ["https://www.baltimoreravens.com/news/injury-report"] }),
      fact({ playerId: "5", player: "Lamar Jackson", claim: "Lamar Jackson stays on IR.", tier: "confirmed", sourceKind: "outlet", sources: ["https://www.espn.com/nfl/injuries"] }),
      fact({ playerId: "5", player: "Lamar Jackson", claim: "Lamar Jackson stays on IR.", tier: "confirmed", sourceKind: "fantasy_site", sources: ["https://www.fantasypros.com/a", "https://www.rotowire.com/b"] }),
      fact({ playerId: "5", player: "Lamar Jackson", claim: "Lamar Jackson stays on IR.", tier: "confirmed", sourceKind: "fantasy_site", sources: ["https://www.fantasypros.com/a", "https://fantasypros.com/c"] }),
    ],
  };
  const r = checkBrief(c, b);
  const flags = r.facts.map((x) => x.flags);
  assert.deepEqual(flags[0], [], "Justice Hill's id, his name");
  assert.deepEqual(flags[1], ["words_not_id", "confirmed_one_source"], "Tyreek Hill's id with Justice Hill's name, and confirmed on one site (a.com)");
  assert.deepEqual(flags[2], ["unknown_id"]);
  assert.deepEqual(flags[3], ["unsourced"], "a Jr. may be left off, but a fact needs a page");
  assert.deepEqual(flags[4], ["wrong_bye"], "the Ravens' bye is week 13");
  assert.deepEqual(flags[5], [], "a bye needs no page");
  assert.deepEqual(flags[6], ["confirmed_one_source"], "the label says team, the one page is an aggregator's (DeepSeek, Nov 7)");
  assert.deepEqual(flags[7], [], "the team's own site");
  assert.deepEqual(flags[8], [], "ESPN confirms a fact (owner, Nov 8), whatever the model calls its source");
  assert.deepEqual(flags[9], [], "the same fact on two fantasy sites");
  assert.deepEqual(flags[10], ["confirmed_one_source"], "two pages on one fantasy site are still one site");
  const ahead = checkBrief(c, { summary: [], malformed: 0, facts: [fact({ kind: "bye", player: "Week 12 byes", team: "MIA/BAL", claim: "Week 12: the Dolphins (Tyreek Hill) and Ravens are off.", sources: [] })] });
  assert.deepEqual([ahead.facts[0]!.flags, ahead.wrongByes, ahead.byesNamed], [["wrong_bye"], ["BAL"], 0], "next week's byes are judged against next week: Miami's is 12, Baltimore's 13");
  const kc = { ...c, targets: [...c.targets, { id: "9", name: "KC Concepcion", position: "WR", proTeam: "CLE", status: "active" as const, byeWeek: 11, on: "free agent" as const }, { id: "10", name: "Travis Kelce", position: "TE", proTeam: "KC", status: "active" as const, byeWeek: 6, on: "roster" as const }] };
  assert.deepEqual(checkBrief(kc, { summary: [], malformed: 0, facts: [fact({ kind: "bye", player: "Byes", claim: "Seahawks off: no KC Concepcion worries.", sources: [] })] }).wrongByes, [], "a player's name is not a team");
  assert.deepEqual(r.wrongByes, ["BAL"]);
  assert.deepEqual([r.byeTeams, r.byesNamed], [2, 2], "the summary's line names the Commanders");
  assert.deepEqual([r.injured, r.injuredCovered], [3, 3], "Justice Hill, Rodriguez and Lamar covered");
  assert.deepEqual(r.tiers, { confirmed: 6, reported: 5, speculation: 0 });
});

test("the report: a row per model, failures named, every fact with its flags", () => {
  const brief: Brief = { summary: ["Lamar is still out."], malformed: 1, facts: [fact({ playerId: "1", player: "Justice Hill", claim: "Hill is out.", tier: "confirmed", sourceKind: "national_insider" })] };
  const records: ResearchRecord[] = [
    { job: "research", model: "a", caseId: "w10", rep: 1, at: "t", latencyMs: 120_000, costUsd: 0.5, webSearches: 12, brief, trace: { tools: [], toolCounts: { web_search: 12 } } },
    { job: "research", model: "b", caseId: "w10", rep: 1, at: "t", latencyMs: 900_000, error: "timeout" },
  ];
  const rows = summarizeResearch([c], records);
  assert.equal(rows[0]!.flags.words_not_id, 1);
  assert.equal(rows[0]!.injured, "0 of 3");
  assert.deepEqual(rows[1]!.errors, { timeout: 1 });
  const table = researchTable(rows);
  assert.match(table, /\| a \| 1\/1 \| 120 s \| \$0\.50 \| 12 \|/);
  assert.match(table, /timeout ×1/);
  const details = researchDetails([c], records);
  assert.match(details, /Tyreek Hill|Justice Hill/);
  assert.match(details, /words name someone else; "confirmed" on one site/);
  assert.match(details, /1 malformed, left out/);
  assert.match(details, /No brief\./);
});

test("the case: everyone on both teams' lists once, on a roster, a free agent or both, statuses read fresh from ESPN without a cookie", async () => {
  const p = (id: string, name: string, over = {}) => ({ id, name, position: "RB", proTeam: "BAL", status: "active" as const, byeWeek: 13, ...over });
  const a: AdviceInput = { teamName: "A", week: 9, now: "t", starterSlots: [], droppable: [], roster: [p("5", "Lamar Jackson", { slot: "IR" })], freeAgents: [p("2", "Justice Hill"), p("-16026", "Seahawks D/ST")] };
  const b: AdviceInput = { teamName: "B", week: 9, now: "t", starterSlots: [], droppable: [], roster: [p("-16026", "Seahawks D/ST")], freeAgents: [p("2", "Justice Hill")] };
  const { f, calls } = fakeFetch(() =>
    json({
      players: [
        { id: 2, player: { id: 2, injuryStatus: "OUT", ownership: { percentOwned: 7.4 }, stats: [{ seasonId: 2025, scoringPeriodId: 10, statSourceId: 1, statSplitTypeId: 1, appliedTotal: 9 }, { seasonId: 2026, scoringPeriodId: 10, statSourceId: 1, statSplitTypeId: 1, appliedTotal: 0 }] } },
        { id: -16026, player: { id: -16026, injuryStatus: "ACTIVE", ownership: { percentOwned: 97.3 }, stats: [{ seasonId: 2026, scoringPeriodId: 10, statSourceId: 1, statSplitTypeId: 1, appliedTotal: 7.5 }] } },
      ],
    }),
  );
  const built = await buildResearchCase([a, b], 2026, 10, "Tell me what I need to know about week 10, please?", f, new Date("2026-11-10T10:00:00Z"));
  assert.deepEqual(built.targets.map((t) => [t.id, t.on, t.status, t.percentRostered, t.projection]), [
    ["5", "roster", "active", undefined, undefined],
    ["2", "free agent", "out", 7.4, 0],
    ["-16026", "both", "active", 97.3, 7.5],
  ]);
  assert.equal(built.id, "2026-w10-2026-11-10");
  assert.match(built.note ?? "", /2 of 3 refreshed/);
  const filter = JSON.parse(calls[0]!.headers.get("x-fantasy-filter")!) as { players: { filterIds: { value: number[] } } };
  assert.deepEqual(filter.players.filterIds.value, [5, 2, -16026], "a D/ST's negative id is real");
  assert.equal(calls[0]!.headers.get("cookie"), null);
  assert.match(calls[0]!.url, /leaguedefaults\/3\?view=kona_player_info&scoringPeriodId=10$/);
});

test("every model is told the question, the evidence labels and the stakes", () => {
  const sys = RESEARCH_SYSTEM(10);
  assert.match(sys, /confirmed: a fact from the team or the league/);
  assert.match(sys, /national news organization \(ESPN/);
  assert.match(sys, /the same fact on two or more fantasy sites/);
  assert.match(sys, /One analyst's take is never enough to act on/);
  assert.match(sys, /out for the season when the team says so or it is confirmed as above/);
  assert.match(sys, /a wrong fact is wrong in every league/);
  const user = JSON.parse(researchUser(c, "2026-11-10T10:05:00.000Z")) as { question: string; players: { id: string; espnStatus: string; on: string }[] };
  assert.equal(user.question, "Tell me what I need to know about week 10, please?");
  assert.deepEqual(user.players.map((p) => [p.id, p.espnStatus, p.on])[3], ["-16026", "active", "both"]);
});

const ask = { system: RESEARCH_SYSTEM(10), user: researchUser(c, "now"), report: BRIEF_TOOL, accept: (x: unknown) => parseBrief(x) !== undefined };
const good = { summary: ["Lamar is out."], facts: [{ playerId: "5", player: "Lamar Jackson", team: "BAL", kind: "injury", tier: "confirmed", sourceKind: "team", claim: "Lamar Jackson stays on IR.", sources: ["https://baltimoreravens.com/1"], asOf: null }] };

test("research on OpenRouter: every server tool, medium effort, Grok told to search X; a report in the wrong form is put into the brief's, both calls paid", async () => {
  let n = 0;
  const { f, calls } = fakeFetch(() =>
    n++ === 0
      ? json({ choices: [{ finish_reason: "tool_calls", message: { content: "Here is my brief.", tool_calls: [{ function: { name: "report_brief", arguments: JSON.stringify({ notes: "Lamar out" }) } }] } }], usage: { cost: 0.4, server_tool_use_details: { web_search_requests: 9 } } })
      : json({ choices: [{ message: { tool_calls: [{ function: { name: "report_brief", arguments: JSON.stringify(good) } }] } }], usage: { cost: 0.05 } }),
  );
  const grok: ModelEntry = { name: "grok", via: "openrouter", model: "x-ai/grok-4.7", reasoning: "low" };
  const call = await contender(grok, { OPENROUTER_API_KEY: "k" }, new Map(), f).research(ask);
  const first = calls[0]!.body;
  assert.deepEqual(first.reasoning, { effort: "medium" }, "the research runs at medium for everyone");
  assert.equal(first.tool_choice, "auto");
  const tools = first.tools as { type: string; parameters?: { x_search?: unknown } }[];
  assert.ok(tools.some((t) => t.type === "openrouter:web_search" && t.parameters?.x_search));
  assert.match(String((first.messages as { content: string }[])[0]!.content), /search X.*Still finish by calling report_brief exactly once/s);
  const second = calls[1]!.body;
  assert.deepEqual(second.tool_choice, { type: "function", function: { name: "report_brief" } });
  assert.equal(second.max_tokens, 24000);
  assert.match(JSON.stringify(second.messages), /Keep the same facts, labels and summary/);
  assert.deepEqual(call.answer, good);
  assert.equal(call.trace?.reformatted, true);
  assert.ok(Math.abs((call.usage.costUsd ?? 0) - 0.45) < 1e-9);
  assert.equal(call.usage.webSearches, 9);
});

test("research with Claude: every tool, the thinking shown, paused turns continued until the brief", async () => {
  let n = 0;
  const { f, calls } = fakeFetch(() => {
    n++;
    const base = { id: `msg_${n}`, type: "message", role: "assistant", model: "claude-opus-5-5", stop_sequence: null };
    if (n === 1)
      return sse({
        ...base,
        stop_reason: "pause_turn",
        content: [
          { type: "thinking", thinking: "Ravens injury report first.", signature: "s" },
          { type: "server_tool_use", id: "srv_1", name: "web_search", input: { query: "Ravens injury report week 10" } },
          { type: "web_search_tool_result", tool_use_id: "srv_1", content: [{ type: "web_search_result", url: "https://baltimoreravens.com/1", title: "Injury report" }] },
        ],
        usage: { input_tokens: 1000, output_tokens: 100, server_tool_use: { web_search_requests: 1 } },
      });
    return sse({ ...base, stop_reason: "tool_use", content: [{ type: "tool_use", id: "t1", name: "report_brief", input: good }], usage: { input_tokens: 3000, output_tokens: 900 } });
  });
  const opus: ModelEntry = { name: "opus", via: "anthropic", model: "claude-opus-5-5" };
  const call = await contender(opus, { ANTHROPIC_API_KEY: "k" }, new Map([["x", { prompt: 1e-6, completion: 1e-6 }]]), f).research(ask);
  assert.equal(calls.length, 2, "the paused turn was continued");
  const body = calls[0]!.body as { tools: { name: string; strict?: boolean }[]; max_tokens: number; system: string; stream?: boolean };
  assert.equal(body.stream, true, "each round streams: a five-minute wait for headers dropped Opus's first run");
  assert.deepEqual(body.tools.map((t) => t.name), ["web_search", "web_fetch", "report_brief"]);
  assert.equal(body.tools[2]?.strict, true, "the report's form is enforced");
  assert.equal(body.max_tokens, 64000);
  assert.match(body.system, /Still finish by calling report_brief exactly once/);
  assert.deepEqual(call.answer, good);
  assert.equal(call.usage.inputTokens, 4000, "usage read from each stream's final message");
  assert.equal(call.usage.outputTokens, 1000);
  assert.equal(call.usage.webSearches, 1);
  assert.equal(call.trace?.tools[0]?.query, "Ravens injury report week 10");
  assert.match(call.trace?.reasoning ?? "", /Ravens injury report first/);
});

test("Claude's report in the wrong shape is sent back once with what's wrong, and kept as sent if it fails again (Sonnet, Nov 8)", async () => {
  const asText = { summary: ["Lamar is on IR."], facts: JSON.stringify(good.facts) };
  let n = 0;
  const { f, calls } = fakeFetch(() => {
    n++;
    const base = { id: `msg_${n}`, type: "message", role: "assistant", model: "claude-sonnet-5-5", stop_sequence: null, usage: { input_tokens: 10, output_tokens: 10 } };
    return sse({ ...base, stop_reason: "tool_use", content: [{ type: "tool_use", id: `t${n}`, name: "report_brief", input: n === 1 ? asText : good }] });
  });
  const sonnet: ModelEntry = { name: "sonnet", via: "anthropic", model: "claude-sonnet-5-5" };
  const call = await contender(sonnet, { ANTHROPIC_API_KEY: "k" }, new Map(), f).research({ ...ask, accept: usableBrief });
  assert.equal(calls.length, 2);
  const back = (calls[1]!.body as { messages: { role: string; content: unknown }[] }).messages.at(-1)!;
  assert.equal(back.role, "user");
  assert.match(JSON.stringify(back.content), /"is_error":true/);
  assert.match(JSON.stringify(back.content), /facts came as text, not a list/);
  assert.deepEqual(call.answer, good);
  assert.equal(call.error, undefined);

  n = 0;
  const twice = fakeFetch(() => {
    n++;
    return sse({ id: `m${n}`, type: "message", role: "assistant", model: "claude-sonnet-5-5", stop_sequence: null, stop_reason: "tool_use", usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: "tool_use", id: `t${n}`, name: "report_brief", input: asText }] });
  });
  const again = await contender(sonnet, { ANTHROPIC_API_KEY: "k" }, new Map(), twice.f).research({ ...ask, accept: usableBrief });
  assert.equal(twice.calls.length, 2, "sent back once, not again");
  assert.equal(again.error, "report is not a brief");
  assert.deepEqual(again.answer, asText, "kept as sent, so what went wrong can be read");
});

test("an Anthropic connection error is named by its class and the network's code, never its message (Opus's bare \"Error\", Nov 8)", async () => {
  const opus: ModelEntry = { name: "opus", via: "anthropic", model: "claude-opus-5-5" };
  const failing = (cause: Error) =>
    fakeFetch(() => {
      throw Object.assign(new TypeError("fetch failed"), { cause });
    }).f;
  const timedOut = await contender(opus, { ANTHROPIC_API_KEY: "k" }, new Map(), failing(Object.assign(new Error("Headers Timeout Error"), { code: "UND_ERR_HEADERS_TIMEOUT" }))).research(ask);
  assert.equal(timedOut.error, "APIConnectionTimeoutError");
  const dropped = await contender(opus, { ANTHROPIC_API_KEY: "k" }, new Map(), failing(Object.assign(new Error("other side closed"), { code: "UND_ERR_SOCKET" }))).research(ask);
  assert.equal(dropped.error, "APIConnectionError (UND_ERR_SOCKET)");
});

test("a provider that refuses a forced tool choice gets the second call with auto (Meta's Muse, Nov 8)", async () => {
  const wrongFields = { summary: ["Byes: CHI, DEN, PHI, TB."], facts: [{ player_id: "5", evidence: "reported", text: "IR." }] };
  let n = 0;
  const { f, calls } = fakeFetch(() => {
    n++;
    if (n === 1) return json({ choices: [{ message: { tool_calls: [{ function: { name: "report_brief", arguments: JSON.stringify(wrongFields) } }] } }], usage: { cost: 0.5 } });
    if (n === 2) return json({ error: { message: "Provider returned error", code: 400, metadata: { provider_name: "Meta" } } }, 400);
    return json({ choices: [{ message: { tool_calls: [{ function: { name: "report_brief", arguments: JSON.stringify(good) } }] } }], usage: { cost: 0.1 } });
  });
  const muse: ModelEntry = { name: "muse", via: "openrouter", model: "meta/muse-wonder", reasoning: "low" };
  const call = await contender(muse, { OPENROUTER_API_KEY: "k" }, new Map(), f).research({ ...ask, accept: usableBrief });
  assert.equal(calls.length, 3);
  assert.deepEqual((calls[1]!.body as { tool_choice: unknown }).tool_choice, { type: "function", function: { name: "report_brief" } });
  assert.equal((calls[2]!.body as { tool_choice: unknown }).tool_choice, "auto");
  assert.deepEqual(call.answer, good);
  assert.equal(call.error, undefined);
});

test("a summary with every fact in other fields is not a brief to keep: it goes to the second call (the Nov 7 rehearsal)", async () => {
  const wrongFields = { summary: ["Byes: CHI, DEN, PHI, TB."], facts: [{ player_id: "5", name: "Lamar Jackson", evidence: "reported", text: "IR." }] };
  assert.equal(usableBrief(wrongFields), false);
  assert.equal(usableBrief(good), true);
  assert.equal(usableBrief({ summary: ["Byes: CHI, DEN, PHI, TB.", "Lamar is on IR."], facts: [] }), false, "a summary with no facts: GLM's second rehearsal");
  assert.equal(parseBrief({ summary: [], facts: [{ ...good.facts[0], tier: "Reported", kind: "Injury", sourceKind: "beat reporter" }] })?.facts[0]?.sourceKind, "beat_reporter", "labels in other cases still count");
  let n = 0;
  const { f, calls } = fakeFetch(() =>
    n++ === 0
      ? json({ choices: [{ message: { tool_calls: [{ function: { name: "report_brief", arguments: JSON.stringify(wrongFields) } }] } }], usage: { cost: 0.1 } })
      : json({ choices: [{ message: { content: "Sorry." } }] }),
  );
  const glm: ModelEntry = { name: "glm", via: "openrouter", model: "z-ai/glm-5.3", reasoning: "low" };
  const call = await contender(glm, { OPENROUTER_API_KEY: "k" }, new Map(), f).research({ ...ask, accept: usableBrief });
  assert.equal(calls.length, 2, "the second call was made");
  assert.match(JSON.stringify(calls[1]!.body.messages), /player_id/, "with the first report as its draft");
  assert.deepEqual(call.answer, wrongFields, "when the second call fails too, the first report's summary stands");
  assert.match(call.error ?? "", /no report after reformatting/);
});

test("the mocks answer the research too: one with a player nobody sent", async () => {
  const off = await contender({ name: "m", via: "mock", model: "off-list" }, {}, new Map()).research(ask);
  const b = parseBrief(off.answer)!;
  assert.deepEqual(checkBrief(c, b).flags.unknown_id, 2);
  const silent = await contender({ name: "s", via: "mock", model: "silent" }, {}, new Map()).research(ask);
  assert.equal(silent.error, "mock silence");
});
