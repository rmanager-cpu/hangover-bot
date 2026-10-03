// The check cadence, the "What we read from ESPN" summary, and how times and names read.
import { test } from "node:test";
import assert from "node:assert/strict";
import { clock, nextCheckAt, shortName, summarizeRead } from "../src/index.ts";
import { ACHANE, DELL, HURTS, KICKOFF, MIN, SHAHEED, T, VIKINGS, WALKER, WRIGHT, entry, team } from "./fakes.ts";
import type { Roster } from "@rosterbots/core";

// ---- cadence

const at = (ms: number) => new Date(ms);
const gap = (r: Roster | null, now: number) => (nextCheckAt(r, at(now)).getTime() - now) / MIN;

test("no roster: hourly", () => {
  assert.equal(gap(null, T), 60);
});

test("a kickoff within 10 minutes: every minute, edge included, so T-4 gets a look", () => {
  assert.equal(gap(team(), T - 10 * MIN), 1);
  assert.equal(gap(team(), T - 4 * MIN), 1);
  assert.equal(gap(team(), T), 1, "a kickoff right now still counts");
});

test("a kickoff within 100 minutes: every 2 minutes, edge included", () => {
  assert.equal(gap(team(), T - 10 * MIN - 1), 2);
  assert.equal(gap(team(), T - 99 * MIN), 2);
  assert.equal(gap(team(), T - 100 * MIN), 2);
});

test("a kickoff within 12 hours: every 15 minutes, edge included", () => {
  assert.equal(gap(team(), T - 101 * MIN), 15);
  assert.equal(gap(team(), T - 12 * 60 * MIN), 15);
});

test("nothing within 12 hours: hourly", () => {
  assert.equal(gap(team(), T - 12 * 60 * MIN - 1), 60);
  assert.equal(gap(team(), Date.parse("2026-09-29T15:00:00Z")), 60, "a Tuesday");
});

test("a game already under way does not count; the next one does", () => {
  // At 1:30 the 1:00 games are under way and the 4:25 ones (Jefferson, Walker, the D/ST) are under three hours out.
  assert.equal(gap(team(), T + 30 * MIN), 15);
  assert.equal(gap(team(), Date.parse("2026-10-04T19:00:00Z")), 2, "4:25 is 85 minutes out at 3:00");
  assert.equal(gap(team(), Date.parse("2026-10-04T21:00:00Z")), 60, "all of this team's games have started");
});

test("byes and unknown schedules have no kickoff to count", () => {
  const r = team();
  for (const e of r.entries) e.player.game = e.player.id === ACHANE ? null : undefined;
  assert.equal(gap(r, T - 30 * MIN), 60);
});

// ---- what we read

const SAT = new Date("2026-10-03T18:00:00.000Z");

test("the summary lists starters in the league's slot order, then the bench, then IR", () => {
  const r = team();
  r.entries.reverse(); // ESPN's order is not the screen's
  const s = summarizeRead(r, SAT);
  assert.deepEqual(s.players.map((p) => p.slot), ["QB", "RB", "RB", "WR", "WR", "FLEX", "DST", "BENCH", "BENCH", "IR"]);
  assert.equal(s.teamName, "Trust The Process");
  assert.equal(s.period, 5);
  assert.equal(s.readAt, "2026-10-03T18:00:00.000Z");
  assert.deepEqual(s.warnings, []);
});

test("each player carries what the screen shows", () => {
  const r = team();
  entry(r, WRIGHT).player.locked = true;
  entry(r, SHAHEED).player.game = null;
  delete entry(r, HURTS).player.projection;
  const s = summarizeRead(r, SAT);
  const by = (id: string) => s.players.find((p) => p.id === id)!;
  assert.deepEqual(by(ACHANE), {
    id: ACHANE, name: "De'Von Achane", position: "RB", proTeam: "MIA", slot: "RB", status: "active",
    kickoff: KICKOFF, bye: false, locked: false, projection: 15,
  });
  assert.equal(by(WRIGHT).locked, true);
  assert.deepEqual([by(SHAHEED).bye, by(SHAHEED).kickoff], [true, null]);
  assert.equal(by(HURTS).projection, null);
  assert.equal(by(DELL).status, "ir");
  assert.equal(by(VIKINGS).position, "D/ST");
});

test("warnings say what is wrong with the read in plain words", () => {
  const r = team();
  r.entries = r.entries.filter((e) => e.player.id !== WALKER); // an empty FLEX
  entry(r, ACHANE).player.status = "unknown";
  entry(r, SHAHEED).player.game = undefined;
  assert.deepEqual(summarizeRead(r, SAT).warnings, [
    "Nobody is starting at FLEX.",
    "No kickoff time came through for Rashid Shaheed.",
    "ESPN sent an injury status I don't recognize for Achane, so I won't move him.",
  ]);
});

test("a read that would stop automation says so first", () => {
  const r = team();
  r.entries.push({ slot: "BENCH", player: { ...entry(r, WRIGHT).player } });
  assert.equal(summarizeRead(r, SAT).warnings[0], "Something in this read looks off, so I won't make automatic moves until a read looks right.");
});

test("no schedule and no projections at all are each one warning", () => {
  const r = team();
  for (const e of r.entries) {
    e.player.game = undefined;
    delete e.player.projection;
  }
  assert.deepEqual(summarizeRead(r, SAT).warnings, [
    "ESPN's schedule didn't come through, so I can't see kickoff times and won't move anyone on my own.",
    "ESPN sent no projections, so I can only pick a replacement from your replacement order, or when just one player fits.",
  ]);
});

// ---- words

test("times are US Eastern, with the day when it is not today", () => {
  const sunday = new Date("2026-10-04T13:00:00Z");
  assert.equal(clock("2026-10-04T18:14:00Z", sunday), "2:14 PM ET");
  assert.equal(clock(KICKOFF, sunday), "1:00 PM ET");
  assert.equal(clock(KICKOFF, new Date("2026-10-02T16:00:00Z")), "Sunday 1:00 PM ET");
  assert.equal(clock("2026-10-05T00:20:00Z", sunday), "8:20 PM ET", "Sunday night is still Sunday in the East");
  assert.equal(clock("2026-10-04T04:30:00Z", sunday), "12:30 AM ET");
  assert.equal(clock("2026-11-08T18:00:00Z", new Date("2026-11-08T12:00:00Z")), "1:00 PM ET", "after the clocks change");
});

test("short names are what a person would say", () => {
  assert.equal(shortName("De'Von Achane"), "Achane");
  assert.equal(shortName("Kenneth Walker III"), "Walker");
  assert.equal(shortName("Marvin Harrison Jr."), "Harrison");
  assert.equal(shortName("Amon-Ra St. Brown"), "St. Brown");
  assert.equal(shortName("Vikings D/ST"), "Vikings D/ST");
  assert.equal(shortName("Cher"), "Cher");
});
