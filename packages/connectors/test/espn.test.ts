// The ESPN connector against hand-built fixtures (see fixtures/README.md) and a
// fake fetch. Nothing here reaches ESPN.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { AuthError, espnConnector, statusOf, toLeagues, toRoster, toTransaction } from "../src/index.ts";

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

test("the lineup write is declared, and declared unverified", () => {
  const caps = espnConnector({ season: 2026, credentials: creds }).capabilities();
  assert.ok(caps.supported.includes("WRITE_LINEUP"));
  assert.ok(caps.unverified.includes("WRITE_LINEUP"));
  assert.ok(!caps.supported.includes("ADD_FREE_AGENT"));
});
