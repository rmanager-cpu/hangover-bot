// The injury bench, offline: made-up cases, fake fetches for ESPN and OpenRouter.
//   node --test bench/test/*.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import { contender } from "../lib/providers.ts";
import { calibrationTable, espnBackWeek, parseSeason, SEASON_SCHEMA, SEASON_SYSTEM, seasonCaseProblems, seasonCaseTable, seasonInput, seasonTable, summarizeSeason } from "../lib/season.ts";
import type { ModelEntry, SeasonCase, SeasonRecord } from "../lib/types.ts";

const done: SeasonCase = {
  id: "2023-sam-example-achilles",
  group: "A",
  season: 2023,
  player: { name: "Sam Example", position: "QB", team: "NYJ", espnId: "1" },
  injury: "Achilles, Week 1 (Sep 11, 2023)",
  asks: [{ at: "2023-09-12T14:00:00.000Z", week: 2 }, { at: "2023-10-03T14:00:00.000Z", week: 5 }],
  news: [
    { at: "2023-09-12T02:00:00.000Z", source: "Robert Saleh, press conference", words: "Sam Example and the Jets fear a torn Achilles.", url: "https://example.com/1" },
    { at: "2023-09-12T16:00:00.000Z", source: "team (Jets release)", words: "Example will have surgery; out for the season.", url: "https://example.com/2" },
  ],
  lastWeek: 17,
  backWeek: null,
  outcomeSource: "https://www.espn.com/nfl/player/gamelog/_/id/1/type/nfl/year/2023",
  aliases: { Jets: "Team A", "Robert Saleh": "the head coach", Saleh: "the head coach" },
};
const back: SeasonCase = { ...done, id: "2024-pat-sample-fibula", group: "B", season: 2024, player: { name: "Pat Sample", position: "RB", team: "KC", espnId: "2" }, injury: "broken fibula, Week 2", asks: [{ at: "2024-09-17T14:00:00.000Z", week: 3 }], news: [{ at: "2024-09-16T17:00:00.000Z", source: "Adam Schefter, ESPN", words: "Sample is expected to miss six to eight weeks.", url: "https://example.com/3" }], backWeek: 12, aliases: {} };

test("what the model sees: news only up to the ask; hidden names take the player, the team, coaches and dates", () => {
  const real = seasonInput(done, done.asks[0]!, false);
  assert.equal(real.player, "Sam Example");
  assert.equal(real.season, 2023);
  assert.deepEqual(real.news.map((n) => n.source), ["Robert Saleh, press conference"], "the 16:00 release came after the 14:00 ask");
  assert.equal(real.fantasyWeeksLeft, 16);
  const later = seasonInput(done, done.asks[1]!, true);
  assert.equal(later.player, "Player A");
  assert.equal(later.season, undefined, "no year with names hidden");
  assert.equal(later.now, "the Tuesday before week 5");
  assert.equal(later.injury, "Achilles, Week 1 ((date))");
  assert.equal(later.news[0]!.text, "Player A and the Team A fear a torn Achilles.");
  assert.equal(later.news[0]!.source, "the head coach, press conference");
  assert.equal(later.news[0]!.at, "22 days before now", "21.5 days rounds up");
  assert.equal(later.news[1]!.at, "21 days before now");
  assert.equal(seasonInput(done, done.asks[0]!, true).news[0]!.at, "12 hours before now");
});

test("an answer is parsed and clamped; anything else is not an answer", () => {
  assert.deepEqual(parseSeason({ over: 1.2, backWeek: null, reason: "Surgery." }), { over: 1, backWeek: null, reason: "Surgery." });
  assert.deepEqual(parseSeason({ over: 0.3, backWeek: 11.6, reason: "" }), { over: 0.3, backWeek: 12, reason: "" });
  assert.equal(parseSeason({ over: "high" }), undefined);
  assert.equal(parseSeason(null), undefined);
});

test("a case must pass its own checks: group and return week agree, nothing from after the last ask", () => {
  assert.deepEqual(seasonCaseProblems(done), []);
  assert.deepEqual(seasonCaseProblems(back), []);
  assert.match(seasonCaseProblems({ ...back, backWeek: null }).join(), /group B but backWeek null/);
  assert.match(seasonCaseProblems({ ...back, backWeek: 18 }).join(), /after week 17/);
  assert.match(seasonCaseProblems({ ...back, backWeek: 3, asks: [{ at: back.asks[0]!.at, week: 4 }] }).join(), /after he was back/);
  assert.match(seasonCaseProblems({ ...done, news: [...done.news, { at: "2023-12-01T00:00:00.000Z", source: "later", words: "x", url: "u" }] }).join(), /news after the last ask/);
});

const rec = (model: string, c: SeasonCase, over: number, hidden = false, asked = c.asks[0]!.at, backWeek: number | null = null): SeasonRecord => ({ job: "season", model, caseId: c.id, rep: 1, at: "t", latencyMs: 10, costUsd: 0.01, hidden, asked, over, backWeek });

test("the score: a player who came back but it was sure he was done is the worst; Brier, calibration and the case table", () => {
  const records = [
    rec("careful", done, 0.9),
    rec("careful", done, 0.97, false, done.asks[1]!.at),
    rec("careful", back, 0.3, false, back.asks[0]!.at, 10),
    rec("reckless", done, 0.99),
    rec("reckless", done, 0.99, false, done.asks[1]!.at),
    rec("reckless", back, 0.96, false, back.asks[0]!.at),
  ];
  const rows = summarizeSeason([done, back], records);
  const careful = rows.find((r) => r.model === "careful")!;
  const reckless = rows.find((r) => r.model === "reckless")!;
  assert.deepEqual([careful.calledSure, careful.droppedSure, careful.droppedFloor], [1, 0, 0]);
  assert.deepEqual([reckless.calledSure, reckless.droppedSure], [1, 1]);
  assert.equal(careful.weekOff, 2, "guessed week 10, back week 12");
  assert.ok(careful.brier! < reckless.brier!);
  assert.equal(careful.costPerCase, 0.015);
  const table = seasonTable(rows);
  assert.ok(table.indexOf("| careful |") < table.indexOf("| reckless |"), "fewest wrongful drops first");
  assert.match(table, /\| careful \| real \| 0 \/ 0 of 1 \| 1 \/ 1 of 1 \| 0\.034 \| 0\.97 \/ 0\.30 \| 2 \|/);
  const cal = calibrationTable([done, back], records, false);
  assert.match(cal, /\| 0\.95 and up \| 4 \| 75% \|/);
  const cases = seasonCaseTable([done, back], records);
  assert.match(cases, /back week 12 \| 0\.30 · — \| \*\*0\.96\*\* · — \|/);
});

test("the outcome comes from ESPN's game log: the first regular-season week after the ask, playoffs left out", async () => {
  const log = {
    events: { a: { week: 1, gameDate: "2024-09-15T17:00Z" }, b: { week: 12, gameDate: "2024-11-24T18:00Z" }, c: { week: 2, gameDate: "2025-01-12T18:00Z" } },
    seasonTypes: [
      { displayName: "2024 Postseason", categories: [{ events: [{ eventId: "c" }] }] },
      { displayName: "2024 Regular Season", categories: [{ events: [{ eventId: "b" }, { eventId: "a" }] }] },
    ],
  };
  const urls: string[] = [];
  const f = (async (u: string | URL | Request) => {
    urls.push(String(u));
    return new Response(JSON.stringify(log), { status: 200 });
  }) as typeof fetch;
  assert.equal(await espnBackWeek(back, f), 12);
  assert.match(urls[0]!, /athletes\/2\/gamelog\?season=2024$/);
  const none = { ...log, seasonTypes: [{ displayName: "2024 Regular Season", categories: [{ events: [{ eventId: "a" }] }] }] };
  const g = (async () => new Response(JSON.stringify(none), { status: 200 })) as unknown as typeof fetch;
  assert.equal(await espnBackWeek(back, g), null, "nothing after the ask: not back");
  const empty = (async () => new Response(JSON.stringify({ filters: [{ name: "season" }] }), { status: 200 })) as unknown as typeof fetch;
  assert.equal(await espnBackWeek(back, empty), null, "no games all season: ESPN sends only its filters");
  const odd = (async () => new Response(JSON.stringify({}), { status: 200 })) as unknown as typeof fetch;
  assert.equal(await espnBackWeek(back, odd), undefined, "nothing recognizable: unreadable, not 'not back'");
});

test("the system prompt and schema: a probability as a confidence, the cost of each mistake", () => {
  assert.match(SEASON_SYSTEM, /0\.95 means you would expect to be wrong once in twenty/);
  assert.match(SEASON_SYSTEM, /lost to the user for the fantasy playoffs/);
  assert.deepEqual(SEASON_SCHEMA.required, ["over", "backWeek", "reason"]);
});

test("a model whose providers can't enforce a schema is asked for the JSON in words", async () => {
  const bodies: Record<string, unknown>[] = [];
  const f = (async (_u: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    bodies.push(body);
    if (body.response_format) return new Response(JSON.stringify({ error: { message: "No endpoints found that can handle the requested parameters." } }), { status: 404 });
    return new Response(JSON.stringify({ choices: [{ message: { content: '```json\n{"over":0.4,"backWeek":12,"reason":"Six to eight weeks."}\n```' } }], usage: { cost: 0.001 } }), { status: 200 });
  }) as typeof fetch;
  const glm: ModelEntry = { name: "glm", via: "openrouter", model: "z-ai/glm-5.3", reasoning: "low" };
  const call = await contender(glm, { OPENROUTER_API_KEY: "k" }, new Map(), f).ask({ system: SEASON_SYSTEM, user: JSON.stringify(seasonInput(back, back.asks[0]!, true)), schema: SEASON_SCHEMA });
  assert.equal(bodies.length, 2);
  assert.equal(bodies[1]!.response_format, undefined);
  assert.match(String((bodies[1]!.messages as { content: string }[])[0]!.content), /Reply with only a JSON object/);
  assert.deepEqual(parseSeason(call.answer), { over: 0.4, backWeek: 12, reason: "Six to eight weeks." });
});

test("the mocks answer the injury bench too", async () => {
  const keyword: ModelEntry = { name: "mock-keyword", via: "mock", model: "keyword" };
  const call = await contender(keyword, {}, new Map(), fetch).ask({ system: SEASON_SYSTEM, user: JSON.stringify(seasonInput(done, done.asks[0]!, false)), schema: SEASON_SCHEMA });
  assert.equal(parseSeason(call.answer)?.over, 0.97, "the coach's 'torn Achilles' fear is enough for the keyword mock");
});
