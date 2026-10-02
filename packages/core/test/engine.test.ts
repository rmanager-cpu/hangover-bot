// Every rule that decides what happens to a user's team, checked without a network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluate, plan, afterAi, applied, DEFAULT_SETTINGS } from "../src/index.ts";
import type { Player, Roster, RosterEntry, Settings, Slot, Step } from "../src/index.ts";

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
const S = (over: Partial<Settings> = {}): Settings => ({ ...DEFAULT_SETTINGS, ...over });

test("a healthy lineup produces nothing", () => {
  const r = roster([at("WR", wr("a")), at("WR", wr("b")), at("FLEX", wr("c")), at("BENCH", wr("d"))]);
  assert.deepEqual(evaluate(r, NOW, S()), []);
});

test("an OUT starter with one healthy bench option is obvious", () => {
  const r = roster([at("WR", wr("jj", { status: "out" })), at("WR", wr("b")), at("FLEX", wr("c")), at("BENCH", wr("d"))]);
  const [f] = evaluate(r, NOW, S());
  assert.equal(f?.kind, "starter_out");
  assert.equal(f?.resolution.type, "obvious");
  if (f?.resolution.type !== "obvious") return;
  assert.deepEqual(f.resolution.candidate.moves, [
    { playerId: "jj", from: "WR", to: "BENCH" },
    { playerId: "d", from: "BENCH", to: "WR" },
  ]);
  assert.equal(f.deadline, new Date(EARLY).toISOString());
});

test("a bye week starter is replaced by the clear best projection", () => {
  const r = roster([
    at("WR", wr("bye", { game: null })), at("WR", wr("b")), at("FLEX", wr("c")),
    at("BENCH", wr("hi", { projection: 14 })), at("BENCH", wr("lo", { projection: 6 })),
  ]);
  const [f] = evaluate(r, NOW, S());
  assert.equal(f?.kind, "starter_on_bye");
  assert.equal(f?.resolution.type === "obvious" && f.resolution.candidate.player.id, "hi");
});

test("two close options is a judgment call, not a guess", () => {
  const r = roster([
    at("WR", wr("out", { status: "out" })), at("WR", wr("b")), at("FLEX", wr("c")),
    at("BENCH", wr("x", { projection: 9 })), at("BENCH", wr("y", { projection: 8 })),
  ]);
  const [f] = evaluate(r, NOW, S());
  assert.equal(f?.resolution.type, "judgment");
});

test("a questionable bench player is never the obvious fix", () => {
  const r = roster([at("WR", wr("out", { status: "out" })), at("WR", wr("b")), at("FLEX", wr("c")), at("BENCH", wr("q", { status: "questionable" }))]);
  assert.equal(evaluate(r, NOW, S())[0]?.resolution.type, "judgment");
});

test("bench players who are out, on bye, locked, already played, or ineligible are not candidates", () => {
  const r = roster([
    at("WR", wr("out", { status: "out" })), at("WR", wr("b")), at("FLEX", wr("c")),
    at("BENCH", wr("o", { status: "out" })),
    at("BENCH", wr("bye", { game: null })),
    at("BENCH", wr("lk", { locked: true })),
    at("BENCH", wr("thu", { game: { kickoff: THURSDAY } })),
    at("BENCH", wr("qb", { position: "QB", eligibleSlots: ["QB", "BENCH"] })),
  ]);
  const [f] = evaluate(r, NOW, S());
  assert.equal(f?.resolution.type, "none");
});

test("a locked starter is left alone, whatever his status", () => {
  const r = roster([at("WR", wr("played", { status: "out", locked: true })), at("WR", wr("b")), at("FLEX", wr("c")), at("BENCH", wr("d"))]);
  assert.deepEqual(evaluate(r, NOW, S()), []);
});

test("one bench player is never promised to two problems", () => {
  const r = roster([
    at("WR", wr("o1", { status: "out", game: { kickoff: EARLY } })),
    at("WR", wr("o2", { status: "out", game: { kickoff: LATE } })),
    at("FLEX", wr("c")), at("BENCH", wr("only")),
  ]);
  const fs = evaluate(r, NOW, S());
  assert.equal(fs.length, 2);
  assert.equal(fs[0]?.starter?.id, "o1", "earliest kickoff claims first");
  assert.equal(fs[0]?.resolution.type, "obvious");
  assert.equal(fs[1]?.resolution.type, "none");
});

test("an empty starting slot is found and filled", () => {
  const r = roster([at("WR", wr("a")), at("FLEX", wr("c")), at("BENCH", wr("d"))]);
  const [f] = evaluate(r, NOW, S());
  assert.equal(f?.kind, "empty_slot");
  assert.equal(f?.key, "5:empty_slot:WR#1");
  assert.equal(f?.resolution.type === "obvious" && f.resolution.candidate.moves.length, 1);
});

test("a pinned starter is never moved", () => {
  const r = roster([at("WR", wr("jj", { status: "out" })), at("WR", wr("b")), at("FLEX", wr("c")), at("BENCH", wr("d"))]);
  const [f] = evaluate(r, NOW, S({ pinned: ["jj"] }));
  assert.equal(f?.resolution.type, "none");
});

test("an unreadable status is reported, not acted on", () => {
  const r = roster([at("WR", wr("u", { status: "unknown" })), at("WR", wr("b")), at("FLEX", wr("c")), at("BENCH", wr("d"))]);
  const [f] = evaluate(r, NOW, S({ authority: "full" }));
  assert.equal(f?.resolution.type, "none");
  assert.equal(plan(f!, S({ authority: "full" }), NOW).do, "notify");
});

test("finding keys are stable across runs", () => {
  const r = roster([at("WR", wr("jj", { status: "out" })), at("WR", wr("b")), at("FLEX", wr("c")), at("BENCH", wr("d"))]);
  assert.equal(evaluate(r, NOW, S())[0]?.key, evaluate(r, new Date(NOW.getTime() + 60_000), S())[0]?.key);
});

// ---- plan: what each authority level allows

const outRoster = roster([at("WR", wr("jj", { status: "out" })), at("WR", wr("b")), at("FLEX", wr("c")), at("BENCH", wr("d"))]);

test("authority decides what an obvious fix becomes", () => {
  const f = evaluate(outRoster, NOW, S())[0]!;
  assert.equal(plan(f, S({ authority: "alert" }), NOW).do, "notify");
  assert.equal(plan(f, S({ authority: "confirm" }), NOW).do, "propose");
  assert.equal(plan(f, S({ authority: "autopilot" }), NOW).do, "execute");
  assert.equal(plan(f, S({ authority: "full" }), NOW).do, "execute");
});

const qRoster = (kickoff: string) =>
  roster([at("WR", wr("q", { status: "questionable", game: { kickoff } })), at("WR", wr("b")), at("FLEX", wr("c")), at("BENCH", wr("d"))]);

test("a questionable starter waits for the inactives window, then goes to judgment", () => {
  const far = evaluate(qRoster(LATE), NOW, S({ authority: "full" }))[0]!;
  const step = plan(far, S({ authority: "full" }), NOW);
  assert.equal(step.do, "wait");
  const near = new Date(Date.parse(LATE) - 60 * 60_000);
  const step2 = plan(far, S({ authority: "full" }), near);
  assert.equal(step2.do, "consult_ai");
  assert.equal(step2.do === "consult_ai" && step2.then, "execute_if_confident");
  assert.equal(plan(far, S({ authority: "autopilot" }), near).do === "consult_ai" && (plan(far, S({ authority: "autopilot" }), near) as Extract<Step, { do: "consult_ai" }>).then, "propose");
});

test("the AI may only pick from the candidates it was given", () => {
  const near = new Date(Date.parse(EARLY) - 30 * 60_000);
  const f = evaluate(qRoster(EARLY), near, S({ authority: "full" }))[0]!;
  const step = plan(f, S({ authority: "full" }), near);
  assert.equal(step.do, "consult_ai");
  if (step.do !== "consult_ai") return;
  const s = S({ authority: "full" });
  assert.equal(afterAi(step, { playerId: "somebody-else", confidence: 1, reason: "" }, s).do, "notify");
  assert.equal(afterAi(step, undefined, s).do, "notify");
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
