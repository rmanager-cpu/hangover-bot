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

test("with neither an order nor projections, a hole is still filled: the fewest changes, then bench order (owner, Oct 4)", () => {
  const r = roster([
    at("WR", wr("out", { status: "out" })), at("WR", wr("b")), at("FLEX", wr("c")),
    at("BENCH", wr("x", { projection: undefined })), at("BENCH", wr("y", { projection: undefined })),
  ]);
  const [f] = rules(r);
  assert.equal(f?.resolution.type === "deterministic" && f.resolution.candidate.player.id, "x");
  assert.match(f?.resolution.type === "deterministic" ? f.resolution.why : "", /fewest changes/);
  assert.equal(plan(f!, as("bench_protection"), NOW).do, "execute");
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
  assert.equal(f?.resolution.type === "none" && f.resolution.why, "nobody on the bench who can fill this slot is projected to play before it locks");
  // Nor as an option when the pick is a judgment call.
  const doubted = { status: "questionable" as const, projection: undefined };
  const r2 = roster([
    at("WR", wr("out", { status: "out" })), at("WR", wr("b")), at("FLEX", wr("c")),
    at("BENCH", wr("x", doubted)), at("BENCH", wr("y", doubted)), at("BENCH", wr("zero", { projection: 0 })),
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
  // Questionable with no projection: options only, so the list can be seen.
  const doubted = { status: "questionable" as const, projection: undefined };
  const r = shiftRoster([at("BENCH", wr("t", doubted)), at("BENCH", wr("u", doubted))]);
  const [f] = rules(r);
  assert.equal(f?.resolution.type, "judgment");
  const cands = f?.resolution.type === "judgment" ? f.resolution.candidates : [];
  assert.deepEqual(cands.map((c) => [c.player.id, c.via, c.moves.length]), [["t", undefined, 2], ["u", undefined, 2]]);
});

test("a locked, started, out, bye, unreadable or unscheduled starter never shifts", () => {
  for (const flex of [
    wr("c", { locked: true }),
    wr("c", { game: { kickoff: THURSDAY } }),
    wr("c", { status: "out" }),
    wr("c", { game: null }),
    wr("c", { status: "unknown" }),
    wr("c", { game: undefined }),
  ]) {
    // An out, bye or unreadable FLEX starter is a problem of his own, so find jj's finding.
    const f = rules(shiftRoster([at("BENCH", rb("d", { projection: 12 })), at("BENCH", wr("t", { projection: 8 }))], flex)).find((x) => x.starter?.id === "jj");
    const c = f?.resolution.type === "deterministic" ? f.resolution.candidate : undefined;
    assert.equal(c?.player.id, "t", `flex ${JSON.stringify({ locked: flex.locked, status: flex.status, game: flex.game })}`);
    assert.equal(c?.via, undefined);
  }
});

test("of two routes of the same length, the one whose shifted starter kicks off later wins: a longer window", () => {
  const r = roster(
    [
      at("WR", wr("jj", { status: "out", game: { kickoff: LATE } })),
      at("WR", wr("b")),
      at("FLEX", wr("c1", { game: { kickoff: EARLY } })),
      at("FLEX", wr("c2", { game: { kickoff: LATE } })),
      at("BENCH", rb("d", { projection: 12, game: { kickoff: LATE } })),
    ],
    ["WR", "WR", "FLEX", "FLEX"],
  );
  const [f] = rules(r);
  const c = f?.resolution.type === "deterministic" ? f.resolution.candidate : undefined;
  assert.deepEqual(c?.via?.map((p) => p.id), ["c2"]);
  assert.equal(f?.deadline, new Date(LATE).toISOString());
});

test("a questionable starter ESPN still projects is playing, so he can slide; his own doubt is then judged at his new slot (Oct 4)", () => {
  // The owner's lineup at 4 AM Oct 4: Jefferson OUT at WR, McConkey questionable at FLEX.
  const r = shiftRoster([at("BENCH", rb("dob", { projection: 10.1, game: { kickoff: LATE } })), at("BENCH", wr("btj", { projection: 8.2 }))], wr("mcc", { status: "questionable", projection: 11.8, game: { kickoff: LATE } }));
  const found = rules(r);
  const hole = found.find((f) => f.kind === "starter_out");
  const c = hole?.resolution.type === "deterministic" ? hole.resolution.candidate : undefined;
  assert.equal(c?.player.id, "dob");
  assert.deepEqual(c?.via?.map((p) => p.id), ["mcc"]);
  assert.deepEqual(c?.moves, [
    { playerId: "jj", from: "WR", to: "BENCH" },
    { playerId: "mcc", from: "FLEX", to: "WR" },
    { playerId: "dob", from: "BENCH", to: "FLEX" },
  ]);
  const doubt = found.find((f) => f.kind === "starter_questionable");
  assert.equal(doubt?.slot, "WR", "judged where he lands");
  const opts = doubt?.resolution.type === "judgment" ? doubt.resolution.candidates : [];
  assert.deepEqual(opts.map((o) => [o.player.id, o.moves]), [["btj", [{ playerId: "mcc", from: "WR", to: "BENCH" }, { playerId: "btj", from: "BENCH", to: "WR" }]]]);
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

test("a starter projected below zero is playing, not a hole: only exactly zero is", () => {
  const r = roster([at("WR", wr("neg", { projection: -1.5 })), at("WR", wr("b")), at("FLEX", wr("c")), at("BENCH", wr("d"))]);
  assert.deepEqual(rules(r), []);
});

test("a questionable starter is asked about before his last bench option locks, not after", () => {
  const r = roster([at("WR", wr("q", { status: "questionable", game: { kickoff: LATE } })), at("WR", wr("b")), at("FLEX", wr("c")), at("BENCH", wr("t", { game: { kickoff: EARLY } }))]);
  const [f] = rules(r);
  assert.equal(f?.deadline, new Date(EARLY).toISOString(), "the option kicks off first");
  const step = plan(f!, S(), NOW);
  assert.equal(step.do, "wait");
  assert.equal(step.do === "wait" && step.until, "2026-10-04T15:20:00.000Z", "100 minutes before the option locks, not before q's own game");
});

test("a lineup with no hole is never reshuffled, however much better the bench looks", () => {
  const r = roster([at("WR", wr("a", { projection: 3 })), at("WR", wr("b", { projection: 4 })), at("FLEX", wr("c", { projection: 2 })), at("BENCH", wr("d", { projection: 30 }))]);
  assert.deepEqual(rules(r), []);
});

test("a questionable bench player ESPN still projects fills a hole on his own (owner, Oct 4); with no projection he is only an option", () => {
  const r = roster([at("WR", wr("out", { status: "out" })), at("WR", wr("b")), at("FLEX", wr("c")), at("BENCH", wr("q", { status: "questionable" }))]);
  const [f] = rules(r);
  assert.equal(f?.resolution.type === "deterministic" && f.resolution.candidate.player.id, "q");
  assert.equal(plan(f!, as("bench_protection"), NOW).do, "execute");
  const unprojected = roster([at("WR", wr("out", { status: "out" })), at("WR", wr("b")), at("FLEX", wr("c")), at("BENCH", wr("q", { status: "questionable", projection: undefined }))]);
  assert.equal(rules(unprojected)[0]?.resolution.type, "judgment");
});

test("a doubtful bench player ESPN still projects fills a hole as the last resort, and is never offered for a soft problem", () => {
  const hole = roster([at("WR", wr("out", { status: "out" })), at("WR", wr("b")), at("FLEX", wr("c")), at("BENCH", wr("dd", { status: "doubtful", projection: 6 }))]);
  const [f] = rules(hole);
  assert.equal(f?.resolution.type === "deterministic" && f.resolution.candidate.player.id, "dd");
  // Behind a questionable one, however their projections compare.
  const both = roster([
    at("WR", wr("out", { status: "out" })), at("WR", wr("b")), at("FLEX", wr("c")),
    at("BENCH", wr("dd", { status: "doubtful", projection: 16 })), at("BENCH", wr("q", { status: "questionable", projection: 4 })),
  ]);
  const [g] = rules(both);
  assert.equal(g?.resolution.type === "deterministic" && g.resolution.candidate.player.id, "q");
  // A doubtful starter's own replacement is never another doubtful player.
  const soft = roster([at("WR", wr("a", { status: "doubtful" })), at("WR", wr("b")), at("FLEX", wr("c")), at("BENCH", wr("dd", { status: "doubtful", projection: 6 }))]);
  assert.equal(rules(soft)[0]?.resolution.type, "none");
});

test("a doubtful starter ESPN still projects slides along to make room: he stays in the lineup", () => {
  const [f] = rules(shiftRoster([at("BENCH", rb("d", { projection: 12, game: { kickoff: LATE } }))], wr("c", { status: "doubtful", projection: 6, game: { kickoff: LATE } })))
    .filter((x) => x.starter?.id === "jj");
  assert.deepEqual(f?.resolution.type === "deterministic" ? f.resolution.candidate.moves : [], [
    { playerId: "jj", from: "WR", to: "BENCH" },
    { playerId: "c", from: "FLEX", to: "WR" },
    { playerId: "d", from: "BENCH", to: "FLEX" },
  ]);
});

test("two holes and one player who could fill either: the assignment that fills both wins over kickoff order", () => {
  // jj (WR, 20:05) sorts first and would take d (RB) through c's shift, leaving the RB hole
  // with nobody. t can still fill WR, so t goes to WR and d to RB.
  const r = roster(
    [
      at("WR", wr("jj", { status: "out", game: { kickoff: "2026-10-04T20:05:00Z" } })), at("WR", wr("b")), at("FLEX", wr("c", { game: { kickoff: LATE } })),
      at("RB", rb("k", { status: "out", game: { kickoff: LATE } })),
      at("BENCH", rb("d", { projection: 12, game: { kickoff: LATE } })), at("BENCH", wr("t", { projection: 8 })),
    ],
    ["WR", "WR", "FLEX", "RB"],
  );
  const found = rules(r);
  const pick = (id: string) => {
    const f = found.find((x) => x.starter?.id === id);
    return f?.resolution.type === "deterministic" ? f.resolution.candidate.player.id : f?.resolution.type;
  };
  assert.equal(pick("jj"), "t");
  assert.equal(pick("k"), "d");
  assert.deepEqual(found.map((f) => f.starter?.id), ["jj", "k"], "findings still come soonest kickoff first");
});

test("a hole the user declined keeps its fix but does not claim the player, so another hole may have him", () => {
  const r = roster([
    at("WR", wr("o1", { status: "out", game: { kickoff: EARLY } })), at("WR", wr("o2", { status: "out", game: { kickoff: LATE } })),
    at("FLEX", wr("c")), at("BENCH", wr("only")),
  ]);
  const plain = rules(r);
  assert.deepEqual(plain.map((f) => f.resolution.type), ["deterministic", "none"]);
  const declined = evaluate(r, NOW, S(), new Set([plain[0]!.key]));
  assert.deepEqual(declined.map((f) => f.resolution.type === "deterministic" && f.resolution.candidate.player.id), ["only", "only"]);
});

test("a starter whose game has started is left alone even before ESPN flags him locked", () => {
  const r = roster([at("WR", wr("gone", { status: "out", game: { kickoff: "2026-10-04T14:00:00Z" } })), at("WR", wr("b")), at("FLEX", wr("c")), at("BENCH", wr("d"))]);
  assert.deepEqual(rules(r), []);
});

test("a hole whose own kickoff ESPN did not send has a fix but no deadline, so nothing is automatic or promised", () => {
  const r = roster([at("WR", wr("jj", { status: "out", game: undefined })), at("WR", wr("b")), at("FLEX", wr("c")), at("BENCH", wr("d", { game: { kickoff: LATE } }))]);
  const [f] = rules(r);
  assert.equal(f?.resolution.type, "deterministic");
  assert.equal(f?.deadline, undefined);
});

test("a hole keeps its key whatever ESPN calls it next, so a Decline holds when DTD and zero becomes OUT", () => {
  const zero = roster([at("WR", wr("jj", { status: "questionable", projection: 0 })), at("WR", wr("b")), at("FLEX", wr("c")), at("BENCH", wr("d"))]);
  const out = roster([at("WR", wr("jj", { status: "out", projection: 0 })), at("WR", wr("b")), at("FLEX", wr("c")), at("BENCH", wr("d"))]);
  const [a] = rules(zero);
  const [b] = rules(out);
  assert.deepEqual([a?.kind, b?.kind], ["starter_zero", "starter_out"]);
  assert.equal(a?.key, "5:hole:jj");
  assert.equal(b?.key, a?.key);
});

test("a hole nobody on the bench could ever play says so; one whose options are all out or played says that", () => {
  const nobody = roster([at("WR", wr("out", { status: "out" })), at("WR", wr("b")), at("FLEX", wr("c")), at("BENCH", wr("qb", { position: "QB", eligibleSlots: ["QB", "BENCH"] }))]);
  assert.equal(rules(nobody)[0]?.resolution.type === "none" && rules(nobody)[0]?.resolution.why, "nobody on the bench can fill this slot");
  const played = roster([at("WR", wr("out", { status: "out" })), at("WR", wr("b")), at("FLEX", wr("c")), at("BENCH", wr("thu", { game: { kickoff: THURSDAY } }))]);
  const [f] = rules(played);
  assert.equal(f?.resolution.type === "none" && f.resolution.why, "nobody on the bench who can fill this slot is projected to play before it locks");
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

test("in the window, a starter who might play is the user's call at every level, AI Native included (owner, Oct 25: it never overrules a choice)", () => {
  const near = new Date(Date.parse(LATE) - 60 * 60_000);
  const f = rules(qRoster(LATE))[0]!;
  assert.equal(plan(f, as("ai_rescue"), near).do, "ask_user");
  assert.equal(plan(f, as("bench_protection"), near).do, "ask_user");
  assert.equal(plan(f, as("ask_me"), near).do, "ask_user");
  assert.equal(plan(f, as("alerts"), near).do, "notify");
});

// A hole whose bench options all have something to doubt and no projection: a judgment call.
const doubtedRoster = (kickoff: string) =>
  roster([
    at("WR", wr("out", { status: "out", game: { kickoff } })), at("WR", wr("b")), at("FLEX", wr("c")),
    at("BENCH", wr("d", { status: "questionable", projection: undefined })), at("BENCH", wr("e", { status: "questionable", projection: undefined })),
  ]);

test("a hole that is a judgment call goes to the AI at AI Native only; below it, the user decides", () => {
  const near = new Date(Date.parse(EARLY) - 30 * 60_000);
  const f = rules(doubtedRoster(EARLY))[0]!;
  assert.equal(f.resolution.type, "judgment");
  assert.equal(plan(f, as("ai_rescue"), near).do, "consult_ai");
  assert.equal(plan(f, as("bench_protection"), near).do, "ask_user");
});

test("the AI may only pick from the candidates it was given", () => {
  const near = new Date(Date.parse(EARLY) - 30 * 60_000);
  const s = as("ai_rescue");
  const step = plan(evaluate(doubtedRoster(EARLY), near, s)[0]!, s, near) as Extract<Step, { do: "consult_ai" }>;
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
