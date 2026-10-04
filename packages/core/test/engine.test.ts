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

test("a bench player projected for zero points is never a candidate, even alone (owner, Oct 3)", () => {
  const r = roster([at("WR", wr("out", { status: "out" })), at("WR", wr("b")), at("FLEX", wr("c")), at("BENCH", wr("zero", { projection: 0 }))]);
  const [f] = rules(r);
  assert.equal(f?.resolution.type, "none");
  // Nor as an option when the pick is a judgment call.
  const r2 = roster([
    at("WR", wr("out", { status: "out" })), at("WR", wr("b")), at("FLEX", wr("c")),
    at("BENCH", wr("x", { projection: undefined })), at("BENCH", wr("y", { projection: undefined })), at("BENCH", wr("zero", { projection: 0 })),
  ]);
  const [g] = rules(r2);
  assert.equal(g?.resolution.type, "judgment");
  assert.deepEqual(g?.resolution.type === "judgment" ? g.resolution.candidates.map((c) => c.player.id).sort() : [], ["x", "y"]);
});

test("a missing projection is not zero: alone and healthy, he is still the fix", () => {
  const r = roster([at("WR", wr("out", { status: "out" })), at("WR", wr("b")), at("FLEX", wr("c")), at("BENCH", wr("np", { projection: undefined }))]);
  const [f] = rules(r);
  assert.equal(f?.resolution.type === "deterministic" && f.resolution.candidate.player.id, "np");
});

// ---- the shift move (owner, Oct 3): a starter moves into the broken slot, the bench fills his

const RB_ELIG: Slot[] = ["RB", "RB/WR", "FLEX", "BENCH", "IR"];
const rb = (id: string, over: Partial<Player> = {}): Player => wr(id, { position: "RB", eligibleSlots: RB_ELIG, ...over });
const shiftRoster = (bench: RosterEntry[], flex: Player = wr("c")) =>
  roster([at("WR", wr("jj", { status: "out", game: { kickoff: LATE } })), at("WR", wr("b")), at("FLEX", flex), ...bench]);

test("an OUT starter can be fixed by shifting a starter into his slot and filling the gap from the bench, when that brings in the better player", () => {
  const [f] = rules(shiftRoster([at("BENCH", rb("d", { projection: 12, game: { kickoff: LATE } })), at("BENCH", wr("t", { projection: 8 }))]));
  assert.equal(f?.resolution.type, "deterministic");
  const c = f?.resolution.type === "deterministic" ? f.resolution.candidate : undefined;
  assert.equal(c?.player.id, "d");
  assert.deepEqual(c?.via?.map((p) => p.id), ["c"]);
  assert.deepEqual(c?.moves, [
    { playerId: "jj", from: "WR", to: "BENCH" },
    { playerId: "c", from: "FLEX", to: "WR" },
    { playerId: "d", from: "BENCH", to: "FLEX" },
  ]);
  assert.equal(f?.deadline, new Date(EARLY).toISOString(), "the shifted starter kicks off first, so the move is due before his game");
});

test("the straight bench option wins when it brings in the better player, and takes two moves", () => {
  const [f] = rules(shiftRoster([at("BENCH", rb("d", { projection: 12 })), at("BENCH", wr("t", { projection: 15 }))]));
  const c = f?.resolution.type === "deterministic" ? f.resolution.candidate : undefined;
  assert.equal(c?.player.id, "t");
  assert.equal(c?.via, undefined);
  assert.equal(c?.moves.length, 2);
});

test("the same bench player is offered once, by the shorter route", () => {
  const r = shiftRoster([at("BENCH", wr("t", { projection: undefined })), at("BENCH", wr("u", { projection: undefined }))]);
  const [f] = rules(r);
  assert.equal(f?.resolution.type, "judgment");
  const cands = f?.resolution.type === "judgment" ? f.resolution.candidates : [];
  assert.deepEqual(cands.map((c) => [c.player.id, c.via, c.moves.length]), [["t", undefined, 2], ["u", undefined, 2]]);
});

test("a locked, started, out, bye or unreadable starter never shifts", () => {
  for (const flex of [wr("c", { locked: true }), wr("c", { game: { kickoff: THURSDAY } }), wr("c", { status: "out" }), wr("c", { game: null }), wr("c", { status: "unknown" })]) {
    // An out, bye or unreadable FLEX starter is a problem of his own, so find jj's finding.
    const f = rules(shiftRoster([at("BENCH", rb("d", { projection: 12 })), at("BENCH", wr("t", { projection: 8 }))], flex)).find((x) => x.starter?.id === "jj");
    const c = f?.resolution.type === "deterministic" ? f.resolution.candidate : undefined;
    assert.equal(c?.player.id, "t", `flex ${JSON.stringify({ locked: flex.locked, status: flex.status, game: flex.game })}`);
    assert.equal(c?.via, undefined);
  }
});

test("a starter shifts at most once per evaluation", () => {
  const r = roster([
    at("WR", wr("jj1", { status: "out" })), at("WR", wr("jj2", { status: "out" })), at("FLEX", wr("c")),
    at("BENCH", rb("d1", { projection: 12 })), at("BENCH", rb("d2", { projection: 11 })),
  ]);
  const [f1, f2] = rules(r);
  assert.equal(f1?.resolution.type === "deterministic" && f1.resolution.candidate.via?.[0]?.id, "c");
  assert.equal(f2?.resolution.type, "none", "c already moved; no bench WR is left");
});

test("a shift never brings in a zero-projection player either", () => {
  const [f] = rules(shiftRoster([at("BENCH", rb("d", { projection: 0 })), at("BENCH", wr("t", { projection: 8 }))]));
  const c = f?.resolution.type === "deterministic" ? f.resolution.candidate : undefined;
  assert.equal(c?.player.id, "t");
  assert.equal(c?.via, undefined);
});

test("a starter ESPN projects for zero is a hole whatever his status says; a projected starter never is (owner, Oct 3)", () => {
  for (const status of ["active", "questionable", "doubtful", "unknown"] as const) {
    const r = roster([at("WR", wr("z", { status, projection: 0 })), at("WR", wr("b")), at("FLEX", wr("c")), at("BENCH", wr("d"))]);
    const [f] = rules(r);
    assert.equal(f?.kind, "starter_zero", status);
    assert.equal(f?.hard, true);
    assert.equal(f?.resolution.type === "deterministic" && f.resolution.candidate.player.id, "d", status);
  }
  const fine = roster([at("WR", wr("p", { status: "questionable", projection: 0.5 })), at("WR", wr("b")), at("FLEX", wr("c")), at("BENCH", wr("d"))]);
  assert.equal(rules(fine)[0]?.kind, "starter_questionable", "a projection, however small, means he is playing: judgment, never a hole");
  const out = roster([at("WR", wr("o", { status: "out", projection: 4 })), at("WR", wr("b")), at("FLEX", wr("c")), at("BENCH", wr("d"))]);
  assert.equal(rules(out)[0]?.kind, "starter_out", "OUT stays a hole even before ESPN zeroes the projection");
});

test("a hole is filled through a chain of shifts when no shorter route exists, and nobody playing leaves the lineup", () => {
  const WRTE: Slot[] = ["WR", "WR/TE", "FLEX", "BENCH", "IR"];
  const TE: Slot[] = ["TE", "WR/TE", "FLEX", "BENCH", "IR"];
  const r = roster(
    [
      at("WR", wr("jj", { status: "out", game: { kickoff: LATE } })),
      at("WR/TE", wr("y1", { eligibleSlots: WRTE })),
      at("FLEX", wr("y2", { position: "TE", eligibleSlots: TE })),
      at("BENCH", rb("z", { projection: 12 })),
    ],
    ["WR", "WR/TE", "FLEX"],
  );
  const [f] = rules(r);
  const c = f?.resolution.type === "deterministic" ? f.resolution.candidate : undefined;
  assert.equal(c?.player.id, "z");
  assert.deepEqual(c?.via?.map((p) => p.id), ["y1", "y2"]);
  assert.deepEqual(c?.moves, [
    { playerId: "jj", from: "WR", to: "BENCH" },
    { playerId: "y1", from: "WR/TE", to: "WR" },
    { playerId: "y2", from: "FLEX", to: "WR/TE" },
    { playerId: "z", from: "BENCH", to: "FLEX" },
  ]);
  assert.deepEqual(c?.moves.filter((m) => m.to === "BENCH").map((m) => m.playerId), ["jj"], "only the hole leaves the lineup");
});

test("a lineup with no hole is never reshuffled, however much better the bench looks", () => {
  const r = roster([at("WR", wr("a", { projection: 3 })), at("WR", wr("b", { projection: 4 })), at("FLEX", wr("c", { projection: 2 })), at("BENCH", wr("d", { projection: 30 }))]);
  assert.deepEqual(rules(r), []);
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
