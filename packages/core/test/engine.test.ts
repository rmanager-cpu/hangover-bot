// Every rule that decides what happens to a user's team, checked without a network.
// Rows from the handoff's V1 test matrix (section 27) are named as such.
import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluate, plan, afterAi, applied, effectiveAuthority, DEFAULT_SETTINGS } from "../src/index.ts";
import type { Authority, Player, Roster, RosterEntry, Settings, Slot, Step } from "../src/index.ts";

const NOW = new Date("2026-10-04T15:00:00Z"); // Sunday morning
const EARLY = "2026-10-04T17:00:00Z"; // 1 PM ET
const LATE = "2026-10-04T20:25:00Z"; // 4:25 PM ET
const THURSDAY = "2026-10-02T00:15:00Z"; // already played

const WR_ELIG: Slot[] = ["WR", "RB/WR", "WR/TE", "FLEX", "BENCH", "IR"];

function wr(id: string, over: Partial<Player> = {}): Player {
  return {
    id, name: id, position: "WR", proTeam: "MIN", status: "active",
    eligibleSlots: WR_ELIG, projection: 10, game: { kickoff: EARLY }, locked: false, ...over,
  };
}
const at = (slot: Slot, player: Player): RosterEntry => ({ slot, player });
function roster(entries: RosterEntry[], starterSlots: Slot[] = ["WR", "WR", "FLEX"]): Roster {
  return { teamId: "2", teamName: "Trust The Process", period: 5, starterSlots, entries };
}
const S = (over: Partial<Settings> = {}): Settings => ({ ...DEFAULT_SETTINGS, accountClaimed: true, ...over });
const as = (authority: Authority, over: Partial<Settings> = {}) => S({ authority, ...over });
const rules = (r: Roster, s = S()) => evaluate(r, NOW, s);

const outRoster = roster([at("WR", wr("jj", { status: "out" })), at("WR", wr("b")), at("FLEX", wr("c")), at("BENCH", wr("d"))]);

test("a healthy lineup produces nothing", () => {
  const r = roster([at("WR", wr("a")), at("WR", wr("b")), at("FLEX", wr("c")), at("BENCH", wr("d"))]);
  assert.deepEqual(rules(r), []);
});

test("matrix: obvious bench rescue is deterministic, a legal swap, no AI", () => {
  const [f] = rules(outRoster);
  assert.equal(f?.kind, "starter_out");
  assert.equal(f?.resolution.type, "deterministic");
  if (f?.resolution.type !== "deterministic") return;
  assert.deepEqual(f.resolution.candidate.moves, [
    { playerId: "jj", from: "WR", to: "BENCH" },
    { playerId: "d", from: "BENCH", to: "WR" },
  ]);
  assert.equal(f.deadline, new Date(EARLY).toISOString());
  assert.equal(plan(f, as("bench_protection"), NOW).do, "execute");
  assert.equal(plan(f, as("ai_rescue"), NOW).do, "execute", "AI Rescue does not spend AI on a solved problem");
});

const three = roster([
  at("WR", wr("out", { status: "out" })), at("WR", wr("b")), at("FLEX", wr("c")),
  at("BENCH", wr("x", { projection: 14 })), at("BENCH", wr("y", { projection: 12 })), at("BENCH", wr("z", { projection: 9 })),
]);

test("matrix: multiple replacements respect the user's explicit order, no AI", () => {
  const [f] = rules(three, S({ replacementOrder: ["z", "x"] }));
  assert.equal(f?.resolution.type === "deterministic" && f.resolution.candidate.player.id, "z");
});

test("without an order, the highest projection wins, however close", () => {
  const [f] = rules(three);
  assert.equal(f?.resolution.type === "deterministic" && f.resolution.candidate.player.id, "x");
});

test("with neither an order nor projections, it is a judgment call, not a guess", () => {
  const r = roster([
    at("WR", wr("out", { status: "out" })), at("WR", wr("b")), at("FLEX", wr("c")),
    at("BENCH", wr("x", { projection: undefined })), at("BENCH", wr("y", { projection: undefined })),
  ]);
  assert.equal(rules(r)[0]?.resolution.type, "judgment");
});

test("a bye week starter is replaced", () => {
  const r = roster([at("WR", wr("bye", { game: null })), at("WR", wr("b")), at("FLEX", wr("c")), at("BENCH", wr("d"))]);
  assert.equal(rules(r)[0]?.kind, "starter_on_bye");
  assert.equal(rules(r)[0]?.resolution.type, "deterministic");
});

test("a healthy bench player ranks ahead of a questionable one with a bigger projection", () => {
  const r = roster([
    at("WR", wr("out", { status: "out" })), at("WR", wr("b")), at("FLEX", wr("c")),
    at("BENCH", wr("q", { status: "questionable", projection: 20 })), at("BENCH", wr("h", { projection: 5 })),
  ]);
  const [f] = rules(r);
  assert.equal(f?.resolution.type === "deterministic" && f.resolution.candidate.player.id, "h");
});

test("a questionable bench player alone is never the automatic fix", () => {
  const r = roster([at("WR", wr("out", { status: "out" })), at("WR", wr("b")), at("FLEX", wr("c")), at("BENCH", wr("q", { status: "questionable" }))]);
  assert.equal(rules(r)[0]?.resolution.type, "judgment");
});

test("matrix: player locks. Out, bye, locked, already-played and ineligible bench players are never candidates", () => {
  const r = roster([
    at("WR", wr("out", { status: "out" })), at("WR", wr("b")), at("FLEX", wr("c")),
    at("BENCH", wr("o", { status: "out" })),
    at("BENCH", wr("bye", { game: null })),
    at("BENCH", wr("lk", { locked: true })),
    at("BENCH", wr("thu", { game: { kickoff: THURSDAY } })),
    at("BENCH", wr("qb", { position: "QB", eligibleSlots: ["QB", "BENCH"] })),
  ]);
  assert.equal(rules(r)[0]?.resolution.type, "none");
});

test("a locked starter is left alone, whatever his status", () => {
  const r = roster([at("WR", wr("played", { status: "out", locked: true })), at("WR", wr("b")), at("FLEX", wr("c")), at("BENCH", wr("d"))]);
  assert.deepEqual(rules(r), []);
});

test("one bench player is never promised to two problems", () => {
  const r = roster([
    at("WR", wr("o1", { status: "out", game: { kickoff: EARLY } })),
    at("WR", wr("o2", { status: "out", game: { kickoff: LATE } })),
    at("FLEX", wr("c")), at("BENCH", wr("only")),
  ]);
  const fs = rules(r);
  assert.equal(fs.length, 2);
  assert.equal(fs[0]?.starter?.id, "o1", "earliest kickoff claims first");
  assert.equal(fs[0]?.resolution.type, "deterministic");
  assert.equal(fs[1]?.resolution.type, "none");
});

test("an empty starting slot is found and filled", () => {
  const r = roster([at("WR", wr("a")), at("FLEX", wr("c")), at("BENCH", wr("d"))]);
  const [f] = rules(r);
  assert.equal(f?.kind, "empty_slot");
  assert.equal(f?.key, "5:empty_slot:WR#1");
  assert.equal(f?.resolution.type === "deterministic" && f.resolution.candidate.moves.length, 1);
});

test("an unreadable status is reported, not acted on", () => {
  const r = roster([at("WR", wr("u", { status: "unknown" })), at("WR", wr("b")), at("FLEX", wr("c")), at("BENCH", wr("d"))]);
  const [f] = rules(r, as("ai_rescue"));
  assert.equal(f?.resolution.type, "none");
  assert.equal(plan(f!, as("ai_rescue"), NOW).do, "notify");
});

test("matrix: duplicate feed. Finding keys are stable across runs", () => {
  assert.equal(evaluate(outRoster, NOW, S())[0]?.key, evaluate(outRoster, new Date(NOW.getTime() + 60_000), S())[0]?.key);
});

// ---- authority (handoff section 4)

test("each authority level decides what a deterministic fix becomes", () => {
  const f = rules(outRoster)[0]!;
  assert.equal(plan(f, as("alerts"), NOW).do, "notify");
  assert.equal(plan(f, as("ask_me"), NOW).do, "propose");
  assert.equal(plan(f, as("bench_protection"), NOW).do, "execute");
  assert.equal(plan(f, as("ai_rescue"), NOW).do, "execute");
});

test("bench swaps turned off means propose, even at the top level", () => {
  const f = rules(outRoster)[0]!;
  const off = { ...DEFAULT_SETTINGS.permissions, benchSwaps: false };
  assert.equal(plan(f, as("ai_rescue", { permissions: off }), NOW).do, "propose");
});

test("an anonymous user never gets an unattended write", () => {
  const f = rules(outRoster)[0]!;
  for (const a of ["bench_protection", "ai_rescue"] as const) {
    const s = S({ authority: a, accountClaimed: false });
    assert.equal(effectiveAuthority(s), "ask_me");
    assert.equal(plan(f, s, NOW).do, "propose");
  }
  assert.equal(effectiveAuthority(S({ authority: "alerts", accountClaimed: false })), "alerts");
});

const qRoster = (kickoff: string) =>
  roster([at("WR", wr("q", { status: "questionable", game: { kickoff } })), at("WR", wr("b")), at("FLEX", wr("c")), at("BENCH", wr("d"))]);

test("a questionable starter waits for the inactives window", () => {
  const f = rules(qRoster(LATE), as("ai_rescue"))[0]!;
  assert.equal(plan(f, as("ai_rescue"), NOW).do, "wait");
});

test("in the window, judgment goes to AI only at AI Rescue; below it, the user decides", () => {
  const near = new Date(Date.parse(LATE) - 60 * 60_000);
  const f = rules(qRoster(LATE))[0]!;
  assert.equal(plan(f, as("ai_rescue"), near).do, "consult_ai");
  assert.equal(plan(f, as("bench_protection"), near).do, "ask_user");
  assert.equal(plan(f, as("ask_me"), near).do, "ask_user");
  assert.equal(plan(f, as("alerts"), near).do, "notify");
});

test("the AI may only pick from the candidates it was given", () => {
  const near = new Date(Date.parse(EARLY) - 30 * 60_000);
  const s = as("ai_rescue");
  const step = plan(evaluate(qRoster(EARLY), near, s)[0]!, s, near) as Extract<Step, { do: "consult_ai" }>;
  assert.equal(step.do, "consult_ai");
  assert.equal(afterAi(step, { playerId: "somebody-else", confidence: 1, reason: "" }, s).do, "ask_user");
  assert.equal(afterAi(step, undefined, s).do, "ask_user");
  assert.equal(afterAi(step, { playerId: null, confidence: 0.9, reason: "he is playing" }, s).do, "notify");
  assert.equal(afterAi(step, { playerId: "d", confidence: 0.9, reason: "" }, s).do, "execute");
  assert.equal(afterAi(step, { playerId: "d", confidence: 0.5, reason: "" }, s).do, "propose");
});

test("a write counts only when a fresh read shows it", () => {
  const moves = [{ playerId: "jj", to: "BENCH" as Slot }, { playerId: "d", to: "WR" as Slot }];
  assert.equal(applied(moves, outRoster), false);
  const after = roster([at("BENCH", wr("jj")), at("WR", wr("b")), at("FLEX", wr("c")), at("WR", wr("d"))]);
  assert.equal(applied(moves, after), true);
});
