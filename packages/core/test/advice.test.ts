// Roster Advice's checks in code (owner, Nov 7): the room on the roster, worked out before the
// AI sees it, and every move it suggests checked after, independently of the model.
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkAdviceMove, rosterRoom } from "../src/index.ts";
import type { Advice, AdviceInput, AdvicePlayer, Player, Roster, RosterEntry, Slot } from "../src/index.ts";

const RB: Slot[] = ["RB", "FLEX", "BENCH", "IR"];
const p = (id: string, over: Partial<Player> = {}): Player => ({ id, name: id, position: "RB", proTeam: "DAL", status: "active", eligibleSlots: RB, game: { kickoff: "2026-11-15T18:00:00Z" }, locked: false, ...over });
const at = (slot: Slot, player: Player): RosterEntry => ({ slot, player });

/** Two starters, a bench of `bench` spots, one IR spot. */
function roster(entries: RosterEntry[], bench: number | undefined = 2, ir: number | undefined = 1): Roster {
  return { teamId: "9", teamName: "KingSlayers", period: 9, starterSlots: ["RB", "RB"], entries, ...(bench !== undefined ? { benchSlots: bench } : {}), ...(ir !== undefined ? { irSlots: ir } : {}) };
}
const full = (extra: RosterEntry[] = []) => [at("RB", p("a")), at("RB", p("b")), at("BENCH", p("c")), at("BENCH", p("evans", { status: "out" })), ...extra];

test("the room: an OUT player beside an empty IR spot means an add needs no drop", () => {
  assert.deepEqual(rosterRoom(roster(full())), { benchSpots: 2, benchUsed: 2, irSpots: 1, irUsed: 0, openRosterSpots: 0, irEligible: ["evans"], irIneligibleInIr: [], addNeedsDrop: false });
});

test("the room: with the IR spot taken, a full roster's add needs a drop; an open bench spot needs nothing", () => {
  const taken = rosterRoom(roster(full([at("IR", p("lamar", { status: "ir" }))])));
  assert.deepEqual([taken.openRosterSpots, taken.irUsed, taken.irEligible, taken.addNeedsDrop], [0, 1, ["evans"], true]);
  const open = rosterRoom(roster([at("RB", p("a")), at("RB", p("b")), at("BENCH", p("c"))]));
  assert.deepEqual([open.openRosterSpots, open.addNeedsDrop], [1, false]);
});

test("the room: a healthy player left in IR blocks transactions; a status we couldn't read is not called either way", () => {
  const r = rosterRoom(roster([at("RB", p("a")), at("RB", p("b")), at("IR", p("healed")), at("IR", p("unread", { status: "unknown" }))], 2, 2));
  assert.deepEqual(r.irIneligibleInIr, ["healed"]);
});

test("the room: sizes ESPN didn't send stay unknown, never guessed", () => {
  const bare: Roster = { teamId: "9", teamName: "KingSlayers", period: 9, starterSlots: ["RB", "RB"], entries: full() };
  const r = rosterRoom(bare);
  assert.deepEqual([r.benchSpots, r.irSpots, r.openRosterSpots, r.addNeedsDrop], [undefined, undefined, undefined, undefined]);
  assert.deepEqual(r.irEligible, ["evans"], "who qualifies is still a fact");
});

// The KingSlayers mix-ups of Nov 7, on a small league.
const ap = (id: string, name: string, position: string, slot?: Slot): AdvicePlayer => ({ id, name, position, proTeam: "X", status: "active", ...(slot ? { slot } : {}) });
const input: AdviceInput = {
  teamName: "KingSlayers", week: 9, now: "2026-11-07T05:00:00Z", starterSlots: ["QB", "TE", "DST"], droppable: [],
  roster: [ap("4360698", "Joe Milton", "QB", "BENCH"), ap("4360635", "Chig Okonkwo", "TE", "TE"), ap("4362619", "Chris Rodriguez Jr.", "RB", "BENCH"), ap("-16018", "Saints D/ST", "DST", "DST"), ap("4362628", "Ja'Marr Chase", "WR", "FLEX")],
  freeAgents: [ap("4433970", "J.J. McCarthy", "QB"), ap("3117256", "Dalton Schultz", "TE"), ap("3116406", "Tyreek Hill", "WR"), ap("4038441", "Justice Hill", "RB"), ap("-16019", "Giants D/ST", "DST")],
};
const move = (title: string, body: string, add?: string, drop?: string): Advice => ({ kind: "fit", title, body, sources: ["ESPN"], action: { ...(add ? { add } : {}), ...(drop ? { drop } : {}) } });

test("the words must name the players the move names: Kimi's two mix-ups are thrown out", () => {
  assert.equal(checkAdviceMove(move("Upgrade QB depth", "Add J.J. McCarthy (4433970) and drop Joe Milton (4360635).", "4433970", "4360635"), input), "drop_not_named", "the id is Okonkwo's, the words say Milton");
  assert.equal(checkAdviceMove(move("Backup tight end", "Add Dalton Schultz (3116406) and drop Chris Rodriguez Jr.", "3116406", "4362619"), input), "add_not_named", "the id is Tyreek Hill's, the words say Schultz");
  assert.equal(checkAdviceMove(move("Upgrade QB depth", "Add J.J. McCarthy and drop Joe Milton.", "4433970", "4360698"), input), undefined);
});

test("a name counts in full, or by a last name nobody else listed shares; a Jr. may be left off", () => {
  assert.equal(checkAdviceMove(move("McCarthy for Milton", "He projects higher.", "4433970", "4360698"), input), undefined);
  assert.equal(checkAdviceMove(move("Grab Hill", "Hill is free.", "3116406"), input), "add_not_named", "two Hills: the last name alone won't do");
  assert.equal(checkAdviceMove(move("Grab Tyreek Hill", "For depth.", "3116406"), input), undefined);
  assert.equal(checkAdviceMove(move("Schultz in", "Drop Chris Rodriguez to make room for Dalton Schultz.", "3117256", "4362619"), input), undefined);
  assert.equal(checkAdviceMove(move("JaMarr Chase", "Never mind.", undefined, "4362628"), input), undefined, "apostrophes don't count");
  assert.equal(checkAdviceMove(move("Rodriguez can go", "Chris Rodriguez Jr.’s role is small; Tyreek Hill's isn't.", "3116406", "4362619"), input), undefined, "a possessive is still his name");
});

test("a defense is named by its team with D/ST or defense", () => {
  assert.equal(checkAdviceMove(move("Stream the Giants defense", "Swap out the Saints D/ST.", "-16019", "-16018"), input), undefined);
  assert.equal(checkAdviceMove(move("Swap in the Giants", "The Saints D/ST is weak.", "-16019", "-16018"), input), "add_not_named");
});

test("the ids must agree with the roster: a free agent to add, one of this team's to drop, never the same player", () => {
  assert.equal(checkAdviceMove(move("x", "Joe Milton", "4360698"), input), "add_on_roster");
  assert.equal(checkAdviceMove(move("x", "Nobody", "999"), input), "add_unknown");
  assert.equal(checkAdviceMove(move("x", "Tyreek Hill", undefined, "3116406"), input), "drop_not_on_roster");
  assert.equal(checkAdviceMove(move("x", "Nobody", undefined, "999"), input), "drop_unknown");
  assert.equal(checkAdviceMove({ kind: "bye", title: "Byes ahead", body: "Plan.", sources: ["ESPN"] }, input), undefined, "words only: nothing to check");
});
