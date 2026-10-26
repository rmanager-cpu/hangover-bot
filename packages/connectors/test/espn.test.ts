// The ESPN connector against hand-built fixtures (see fixtures/README.md) and a
// fake fetch. Nothing here reaches ESPN.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { AuthError, espnConnector, freeAgentFilter, statusOf, toAddDrop, toFreeAgents, toLeagues, toRoster, toTransaction } from "../src/index.ts";

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8"));
const league = fixture("league");
const schedule = fixture("schedule");
const SWID = "{MEGA-CAST-SWID}";

test("the member's team is found by membership, and a co-manager counts", () => {
  const r = toRoster(league, schedule, SWID);
  assert.equal(r.teamId, "2");
  assert.equal(r.teamName, "Trust The Process");
  assert.equal(r.period, 5);
});

test("starting slots are expanded from the league's slot counts; bench, IR and unknown ids are not starters", () => {
  const r = toRoster(league, schedule, SWID);
  assert.deepEqual([...r.starterSlots].sort(), ["DST", "FLEX", "K", "QB", "RB", "RB", "TE", "WR", "WR"]);
});

test("players are normalized: status, projection, slots, schedule, lock", () => {
  const r = toRoster(league, schedule, SWID);
  const by = (name: string) => r.entries.find((e) => e.player.name === name)!;
  const jj = by("Justin Jefferson");
  assert.equal(jj.slot, "WR");
  assert.equal(jj.player.status, "out");
  assert.equal(jj.player.projection, 17.2, "the projection, not the actual");
  assert.equal(jj.player.position, "WR");
  assert.equal(jj.player.proTeam, "MIN");
  assert.deepEqual(jj.player.eligibleSlots, ["RB/WR", "WR", "WR/TE", "FLEX", "SUPERFLEX", "BENCH", "IR"]);
  assert.deepEqual(jj.player.game, { kickoff: "2026-10-04T17:00:00.000Z", opponent: "DET" });

  const ladd = by("Ladd McConkey");
  assert.equal(ladd.slot, "BENCH");
  assert.equal(ladd.player.game, null, "LAC on bye in week 5");
});

test("a defense keeps its negative id", () => {
  const dst = toRoster(league, schedule, SWID).entries.find((e) => e.slot === "DST")!;
  assert.equal(dst.player.id, "-16016");
  assert.equal(dst.player.locked, true);
});

test("a slot we do not model (IDP) is left out entirely, so it is never touched", () => {
  assert.equal(toRoster(league, schedule, SWID).entries.some((e) => e.player.name === "Some Linebacker"), false);
});

test("an ESPN status we have never seen is unknown, never active", () => {
  const m = toRoster(league, schedule, SWID).entries.find((e) => e.player.name === "Mystery Status")!;
  assert.equal(m.player.status, "unknown");
  assert.equal(statusOf(undefined, true), "unknown");
  assert.equal(statusOf(undefined, false), "active");
  assert.equal(statusOf("INJURY_RESERVE", true), "ir");
  assert.equal(statusOf("DAY_TO_DAY", true), "questionable", "ESPN's DTD is a doubt, never active and never unknown");
});

test("without a schedule, kickoff is unknown rather than a bye", () => {
  const r = toRoster(league, undefined, SWID);
  assert.equal(r.entries.find((e) => e.player.name === "Ladd McConkey")!.player.game, undefined);
});

test("a starter ESPN sent without player data is unknown, never on bye", () => {
  const half = structuredClone(league);
  const team = half.teams.find((t: { owners?: string[] }) => (t.owners ?? []).includes(SWID));
  const wr = team.roster.entries.find((e: { lineupSlotId: number }) => e.lineupSlotId === 4);
  const noTeam = structuredClone(wr);
  delete noTeam.playerPoolEntry.player.proTeamId;
  noTeam.playerId = 1001;
  const nothing = { playerId: 1002, lineupSlotId: wr.lineupSlotId };
  team.roster.entries.push(noTeam, nothing);
  const r = toRoster(half, schedule, SWID);
  const by = (id: string) => r.entries.find((e) => e.player.id === id)!.player;
  assert.equal(by("1001").game, undefined, "a missing pro team is an unknown schedule");
  assert.equal(by("1002").game, undefined);
  assert.equal(by("1002").status, "unknown", "no player data at all: never moved");
});

test("credentials that manage no team are refused", () => {
  assert.throws(() => toRoster(league, schedule, "{STRANGER}"), /no team/);
});

test("the lineup write is ESPN's ROSTER transaction with ESPN's slot ids", () => {
  const body = toTransaction(
    [{ playerId: "4262921", from: "WR", to: "BENCH" }, { playerId: "-16016", from: "BENCH", to: "DST" }],
    "2", SWID, 5,
  );
  assert.deepEqual(body, {
    isLeagueManager: false, teamId: 2, type: "ROSTER", memberId: SWID, scoringPeriodId: 5, executionType: "EXECUTE",
    items: [
      { playerId: 4262921, type: "LINEUP", fromLineupSlotId: 4, toLineupSlotId: 20 },
      { playerId: -16016, type: "LINEUP", fromLineupSlotId: 20, toLineupSlotId: 16 },
    ],
  });
});

test("the league's own bench and IR sizes come from its slot counts, and are unknown when it sends none", () => {
  const r = toRoster(league, schedule, SWID);
  assert.deepEqual([r.benchSlots, r.irSlots], [7, 1]);
  const bare = structuredClone(league);
  delete bare.settings.rosterSettings.lineupSlotCounts["20"];
  delete bare.settings.rosterSettings.lineupSlotCounts["21"];
  const b = toRoster(bare, schedule, SWID);
  assert.deepEqual([b.benchSlots, b.irSlots], [undefined, undefined]);
});

test("a rostered player's rest-of-season projection, percent rostered and bye week are read when ESPN sends them", () => {
  const rich = structuredClone(league);
  const team = rich.teams.find((t: { owners?: string[] }) => (t.owners ?? []).includes(SWID));
  const jj = team.roster.entries.find((e: { playerId: number }) => e.playerId === 4262921).playerPoolEntry.player;
  jj.ownership = { percentOwned: 99.7 };
  jj.stats.push({ statSourceId: 1, scoringPeriodId: 0, statSplitTypeId: 0, appliedTotal: 240.5 });
  const p = toRoster(rich, schedule, SWID).entries.find((e) => e.player.id === "4262921")!.player;
  assert.deepEqual([p.seasonProjection, p.percentRostered, p.byeWeek], [240.5, 99.7, 9]);
  const plain = toRoster(league, schedule, SWID).entries.find((e) => e.player.id === "4262921")!.player;
  assert.deepEqual([plain.seasonProjection, plain.percentRostered], [undefined, undefined], "absent, never guessed");
});

test("the player pool yields free agents, marks waivers, and leaves out anyone on a team", () => {
  const fas = toFreeAgents(fixture("free-agents"), schedule, 5);
  assert.deepEqual(fas.map((f) => [f.player.id, f.onWaivers]), [["4000001", false], ["4000002", true], ["4000003", false]]);
  const mason = fas[0]!.player;
  assert.equal(mason.name, "Jordan Mason");
  assert.equal(mason.position, "RB");
  assert.equal(mason.proTeam, "MIN");
  assert.deepEqual([mason.projection, mason.seasonProjection, mason.percentRostered, mason.byeWeek], [11.4, 95.2, 42.3, 9]);
  assert.deepEqual(mason.game, { kickoff: "2026-10-04T17:00:00.000Z", opponent: "DET" });
  assert.equal(mason.locked, false);
  assert.equal(fas[2]!.player.game, null, "LAC is on bye in week 5");
  assert.equal(fas[2]!.player.status, "questionable");
});

test("the add/drop is ESPN's FREEAGENT transaction, with the drop only when there is one", () => {
  const both = toAddDrop({ add: { playerId: "4000001", toSlot: "BENCH" }, drop: { playerId: "4610523", fromSlot: "BENCH" } }, "2", SWID, 5);
  assert.deepEqual(both, {
    isLeagueManager: false, teamId: 2, type: "FREEAGENT", memberId: SWID, scoringPeriodId: 5, executionType: "EXECUTE",
    items: [
      { playerId: 4000001, type: "ADD", toTeamId: 2, toLineupSlotId: 20 },
      { playerId: 4610523, type: "DROP", fromTeamId: 2, fromLineupSlotId: 20 },
    ],
  });
  const addOnly = toAddDrop({ add: { playerId: "4000001", toSlot: "RB" } }, "2", SWID, 5);
  assert.deepEqual(addOnly.items, [{ playerId: 4000001, type: "ADD", toTeamId: 2, toLineupSlotId: 2 }]);
});

test("the free-agent filter asks for free agents and waivers who can play the slots, most rostered first", () => {
  const f = freeAgentFilter(2026, 5, ["RB", "FLEX"], 40);
  assert.deepEqual(f.players.filterStatus, { value: ["FREEAGENT", "WAIVERS"] });
  assert.deepEqual(f.players.filterSlotIds, { value: [2, 23] });
  assert.equal(f.players.limit, 40);
  assert.deepEqual(f.players.filterRanksForScoringPeriodIds, { value: [5] });
  assert.equal("filterSlotIds" in freeAgentFilter(2026, 5, undefined, 40).players, false);
});

test("the fan profile yields this season's football leagues only", () => {
  assert.deepEqual(toLeagues(fixture("fan"), 2026), [
    { leagueId: "36784699", leagueName: "Live free or die hard RR4L", season: 2026, teamId: "2", teamName: "Trust The Process" },
  ]);
});

// ---- the connector itself, over a fake fetch

function fakeFetch(routes: (url: string, init?: RequestInit) => Response) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    return routes(url, init);
  }) as typeof fetch;
  return { f, calls };
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const creds = { swid: SWID, espnS2: "s2-secret" };

test("getRoster sends the member's cookies and reads league plus schedule", async () => {
  const { f, calls } = fakeFetch((url) => (url.includes("proTeamSchedules") ? json(schedule) : json(league)));
  const c = espnConnector({ season: 2026, credentials: creds, fetch: f });
  const r = await c.getRoster("36784699");
  assert.equal(r.teamId, "2");
  assert.equal(calls.length, 2);
  for (const call of calls) assert.equal((call.init?.headers as Record<string, string>).cookie, `SWID=${SWID}; espn_s2=s2-secret`);
});

test("the schedule is read once per connector, however many reads follow", async () => {
  const { f, calls } = fakeFetch((url) => (url.includes("proTeamSchedules") ? json(schedule) : url.includes("kona_player_info") ? json(fixture("free-agents")) : json(league)));
  const c = espnConnector({ season: 2026, credentials: creds, fetch: f });
  await c.getRoster("36784699");
  await c.getFreeAgents("36784699", 5);
  await c.getRoster("36784699");
  assert.equal(calls.filter((x) => x.url.includes("proTeamSchedules")).length, 1);
});

test("a failed schedule degrades to unknown kickoffs; a failed roster does not degrade", async () => {
  const c = espnConnector({ season: 2026, credentials: creds, fetch: fakeFetch((url) => (url.includes("proTeamSchedules") ? json({}, 500) : json(league))).f });
  assert.equal((await c.getRoster("1")).entries[0]?.player.game, undefined);
  const bad = espnConnector({ season: 2026, credentials: creds, fetch: fakeFetch(() => json({}, 500)).f });
  await assert.rejects(bad.getRoster("1"), /roster/);
});

test("401 or 403 is an AuthError: the user must sign in again", async () => {
  for (const status of [401, 403]) {
    const c = espnConnector({ season: 2026, credentials: creds, fetch: fakeFetch(() => json({}, status)).f });
    await assert.rejects(c.getRoster("1"), AuthError);
  }
});

test("setLineup posts to the write host and reports what ESPN said", async () => {
  const { f, calls } = fakeFetch((url, init) => (init?.method === "POST" ? json({ status: "EXECUTED", type: "ROSTER" }) : json(url.includes("proTeam") ? schedule : league)));
  const c = espnConnector({ season: 2026, credentials: creds, fetch: f });
  const res = await c.setLineup("36784699", [{ playerId: "4262921", from: "WR", to: "BENCH" }], 5);
  assert.deepEqual(res, { httpStatus: 200, detail: "EXECUTED ROSTER" });
  const post = calls.find((c) => c.init?.method === "POST")!;
  assert.equal(post.url, "https://lm-api-writes.fantasy.espn.com/apis/v3/games/ffl/seasons/2026/segments/0/leagues/36784699/transactions/");
  assert.equal(JSON.parse(String(post.init?.body)).teamId, 2);
});

test("getFreeAgents sends the filter header with the cookies, and reads the schedule for kickoffs", async () => {
  const { f, calls } = fakeFetch((url) => (url.includes("proTeamSchedules") ? json(schedule) : json(fixture("free-agents"))));
  const c = espnConnector({ season: 2026, credentials: creds, fetch: f });
  const fas = await c.getFreeAgents("36784699", 5, { slots: ["RB"], limit: 25 });
  assert.equal(fas.length, 3);
  const pool = calls.find((x) => x.url.includes("kona_player_info"))!;
  assert.equal(pool.url, "https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/2026/segments/0/leagues/36784699?view=kona_player_info&scoringPeriodId=5");
  const headers = pool.init?.headers as Record<string, string>;
  assert.equal(headers.cookie, `SWID=${SWID}; espn_s2=s2-secret`);
  assert.deepEqual(JSON.parse(headers["x-fantasy-filter"]!), freeAgentFilter(2026, 5, ["RB"], 25));
  assert.deepEqual(fas[0]!.player.game, { kickoff: "2026-10-04T17:00:00.000Z", opponent: "DET" });
});

test("addDrop posts the FREEAGENT transaction to the write host for the member's team", async () => {
  const { f, calls } = fakeFetch((url, init) => (init?.method === "POST" ? json({ status: "EXECUTED", type: "FREEAGENT" }) : json(url.includes("proTeam") ? schedule : league)));
  const c = espnConnector({ season: 2026, credentials: creds, fetch: f });
  const res = await c.addDrop("36784699", { add: { playerId: "4000001", toSlot: "BENCH" }, drop: { playerId: "4610523", fromSlot: "BENCH" } }, 5);
  assert.deepEqual(res, { httpStatus: 200, detail: "EXECUTED FREEAGENT" });
  const post = calls.find((x) => x.init?.method === "POST")!;
  assert.equal(post.url, "https://lm-api-writes.fantasy.espn.com/apis/v3/games/ffl/seasons/2026/segments/0/leagues/36784699/transactions/");
  const body = JSON.parse(String(post.init?.body));
  assert.equal(body.type, "FREEAGENT");
  assert.equal(body.teamId, 2, "the team was read first, since the connector had not seen this league");
});

test("the writes are declared, and declared unverified", () => {
  const caps = espnConnector({ season: 2026, credentials: creds }).capabilities();
  for (const cap of ["WRITE_LINEUP", "READ_FREE_AGENTS", "ADD_FREE_AGENT", "DROP_PLAYER", "MOVE_TO_IR"] as const) {
    assert.ok(caps.supported.includes(cap), cap);
    assert.ok(caps.unverified.includes(cap), cap + " unverified");
  }
});
