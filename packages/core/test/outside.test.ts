// The No-Cray Rules (docs/AI-NATIVE.md), one test per rule, plus how room is made. Every
// option AI Native could ever act on comes out of outsideCandidates, so each rule is a test
// here, with no network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SETTINGS, NO_CRAY, noCray, outsideCandidates } from "../src/index.ts";
import type { FreeAgent, NoCrayContext, Player, Roster, RosterEntry, Settings, Slot } from "../src/index.ts";

const NOW = new Date("2026-10-04T16:45:00Z"); // T-15 before the 1 PM ET games
const KICKOFF = "2026-10-04T17:00:00Z";
const LATE = "2026-10-04T20:25:00Z";

const RB_ELIG: Slot[] = ["RB", "RB/WR", "FLEX", "BENCH", "IR"];
const WR_ELIG: Slot[] = ["WR", "RB/WR", "WR/TE", "FLEX", "BENCH", "IR"];
const QB_ELIG: Slot[] = ["QB", "BENCH", "IR"];

function player(id: string, position: string, over: Partial<Player> = {}): Player {
  const eligibleSlots = position === "QB" ? QB_ELIG : position === "WR" ? WR_ELIG : RB_ELIG;
  return {
    id, name: id, position, proTeam: "DAL", status: "active", eligibleSlots, projection: 10, seasonProjection: 100, percentRostered: 50,
    game: { kickoff: LATE }, locked: false, ...over,
  };
}
const at = (slot: Slot, p: Player): RosterEntry => ({ slot, player: p });

/** Achane OUT at RB with nobody on the bench who can play it; the bench is full unless told otherwise. */
function roster(over: Partial<Roster> = {}, bench: RosterEntry[] = []): Roster {
  return {
    teamId: "2", teamName: "Trust The Process", period: 5,
    starterSlots: ["QB", "RB", "RB", "WR", "WR", "FLEX"],
    benchSlots: bench.length || 3, irSlots: 1,
    entries: [
      at("QB", player("hurts", "QB", { projection: 21, seasonProjection: 300, percentRostered: 99 })),
      at("RB", player("achane", "RB", { status: "out", projection: 0, game: { kickoff: KICKOFF } })),
      at("RB", player("bijan", "RB", { projection: 17, seasonProjection: 250, percentRostered: 99 })),
      at("WR", player("jj", "WR", { projection: 16, seasonProjection: 240, percentRostered: 99 })),
      at("WR", player("arsb", "WR", { projection: 15, seasonProjection: 230, percentRostered: 99 })),
      at("FLEX", player("walker", "RB", { projection: 12, seasonProjection: 180, percentRostered: 95 })),
      ...(bench.length
        ? bench
        : [
            at("BENCH", player("wr1", "WR", { projection: 7, seasonProjection: 90, percentRostered: 40 })),
            at("BENCH", player("wr2", "WR", { projection: 6, seasonProjection: 60, percentRostered: 30 })),
            at("BENCH", player("wr3", "WR", { projection: 5, seasonProjection: 40, percentRostered: 20 })),
          ]),
    ],
    ...over,
  };
}

const fa = (id: string, over: Partial<Player> = {}, onWaivers = false): FreeAgent => ({
  player: player(id, "RB", { projection: 12, seasonProjection: 80, percentRostered: 30, game: { kickoff: KICKOFF }, ...over }),
  onWaivers,
});

const S = (over: Partial<Settings> = {}): Settings => ({ ...DEFAULT_SETTINGS, authority: "ai_rescue", accountClaimed: true, droppable: ["wr1", "wr2", "wr3"], ...over });
const history = (over: Partial<NoCrayContext["history"]> = {}): NoCrayContext["history"] => ({ addsThisWeek: 0, addedAt: new Map(), dropped: new Set(), ...over });

function ctx(r: Roster, over: Partial<NoCrayContext> = {}): NoCrayContext {
  const occupant = r.entries.find((e) => e.player.id === "achane")?.player;
  return { roster: r, settings: S(), now: NOW, history: history(), slot: "RB", baseline: 0, purpose: "hole", ...(occupant ? { occupant } : {}), ...over };
}

const ids = (cs: { player: Player }[]) => cs.map((c) => c.player.id);

// ---- making room, in the owner's order

test("an open roster spot needs nothing: the free agent is added to the bench and swapped in", () => {
  const r = roster({ benchSlots: 4 });
  const out = outsideCandidates([fa("fa1")], ctx(r));
  assert.deepEqual(ids(out.moves), ["fa1"]);
  const c = out.moves[0]!;
  assert.deepEqual(c.add, { to: "BENCH", room: { how: "open" } });
  assert.deepEqual(c.moves, [
    { playerId: "achane", from: "RB", to: "BENCH" },
    { playerId: "fa1", from: "BENCH", to: "RB" },
  ]);
});

test("with no open spot, an open IR slot comes before any drop, and the OUT starter himself goes to IR", () => {
  const out = outsideCandidates([fa("fa1")], ctx(roster()));
  const c = out.moves[0]!;
  assert.equal(c.add?.room.how, "ir");
  assert.equal(c.add?.room.how === "ir" && c.add.room.player.id, "achane");
  // Achane leaving RB for IR vacates the slot and the bench is full, so the add lands straight in RB.
  assert.equal(c.add?.to, "RB");
  assert.deepEqual(c.moves, []);
});

test("an IR slot already used, or a starter who does not qualify for IR, means a drop: the lowest rest-of-season value among the droppable", () => {
  const r = roster({ irSlots: 0 });
  const out = outsideCandidates([fa("fa1")], ctx(r));
  const c = out.moves[0]!;
  assert.deepEqual(c.add?.room.how === "drop" ? [c.add.room.player.id, c.add.room.from] : [], ["wr3", "BENCH"]);
  assert.equal(c.add?.to, "BENCH", "the drop frees a bench spot for the add");
  assert.deepEqual(c.moves, [
    { playerId: "achane", from: "RB", to: "BENCH" },
    { playerId: "fa1", from: "BENCH", to: "RB" },
  ]);
});

test("without the league's slot counts, no roster spot and no IR slot is ever taken to be open", () => {
  const r = roster({ irSlots: undefined, benchSlots: undefined });
  const c = outsideCandidates([fa("fa1")], ctx(r)).moves[0]!;
  assert.equal(c.add?.room.how, "drop");
});

// ---- the rules

test("rule 2: only players switched to Droppable are dropped on their own; anyone else is a question for the user", () => {
  const r = roster({ irSlots: 0 });
  const out = outsideCandidates([fa("fa1")], ctx(r, { settings: S({ droppable: [] }) }));
  assert.deepEqual(out.moves, []);
  assert.equal(out.asks.length, 1);
  assert.equal(out.asks[0]!.candidate.add?.room.how === "drop" && out.asks[0]!.candidate.add.room.player.id, "wr3");
  assert.match(out.asks[0]!.why, /wr3 is not marked Droppable/);
});

test("rule 3: a starter who is playing this week is never dropped, droppable or not", () => {
  const r = roster({ irSlots: 0 });
  const out = outsideCandidates([fa("fa1")], ctx(r, { settings: S({ droppable: ["walker", "jj"] }) }));
  assert.deepEqual(out.moves, []);
  assert.deepEqual(out.asks.map((a) => a.candidate.add?.room.how === "drop" && a.candidate.add.room.player.id), ["wr3"], "the question falls to a bench player instead");
});

test("rule 3 yields to a season over: a starter ESPN still projects may be the drop when the provider, or for advice the AI's report, says his season is done", () => {
  const r = roster({ irSlots: 0 });
  const jj = r.entries.find((e) => e.player.id === "jj")!.player;
  const tx = { add: fa("fa1").player, room: { how: "drop" as const, player: { ...jj, outForSeason: true }, from: "WR" as const } };
  assert.equal(noCray(tx, ctx(r, { purpose: "advice", slot: "BENCH", occupant: undefined, settings: S({ droppable: ["jj"] }) })).ok, true);
  assert.equal(noCray({ ...tx, room: { ...tx.room, player: jj } }, ctx(r, { purpose: "advice", slot: "BENCH", occupant: undefined })).ok, false, "without that word, rule 3 stands");
});

test("rule 4: a player who will be back is never dropped; one out for the season goes first, whatever his value", () => {
  const bench = [
    at("BENCH", player("q", "WR", { status: "questionable", seasonProjection: 10 })),
    at("BENCH", player("ir", "WR", { status: "ir", seasonProjection: 20, eligibleSlots: WR_ELIG.filter((s) => s !== "IR") })),
    at("BENCH", player("gone", "WR", { status: "ir", outForSeason: true, seasonProjection: 150, percentRostered: 80, eligibleSlots: WR_ELIG.filter((s) => s !== "IR") })),
  ];
  const r = roster({ irSlots: 0 }, bench);
  const out = outsideCandidates([fa("fa1")], ctx(r, { settings: S({ droppable: ["q", "ir", "gone"] }) }));
  assert.equal(out.moves[0]?.add?.room.how === "drop" && out.moves[0].add.room.player.id, "gone");
  // Without him, nobody can go: the questionable and the IR player will be back.
  const back = roster({ irSlots: 0 }, bench.slice(0, 2));
  const none = outsideCandidates([fa("fa1")], ctx(back, { settings: S({ droppable: ["q", "ir"] }) }));
  assert.deepEqual([none.moves, none.asks], [[], []]);
  assert.match(none.rejected[0]!.why, /will be back/);
});

test("rule 5: nobody rostered in more than 65% of ESPN leagues is dropped, unless out for the season; an unknown percent is a question", () => {
  assert.equal(NO_CRAY.rosteredLine, 65);
  const popular = roster({ irSlots: 0 }, [at("BENCH", player("pop", "WR", { seasonProjection: 10, percentRostered: 70 }))]);
  const out = outsideCandidates([fa("fa1")], ctx(popular, { settings: S({ droppable: ["pop"] }) }));
  assert.deepEqual([out.moves, out.asks], [[], []]);
  assert.match(out.rejected[0]!.why, /rostered in 70% of ESPN leagues/);

  const unknown = roster({ irSlots: 0 }, [at("BENCH", player("mystery", "WR", { seasonProjection: 10, percentRostered: undefined }))]);
  const asked = outsideCandidates([fa("fa1")], ctx(unknown, { settings: S({ droppable: ["mystery"] }) }));
  assert.deepEqual(asked.moves, []);
  assert.match(asked.asks[0]!.why, /did not say how many leagues roster mystery/);

  const over = roster({ irSlots: 0 }, [at("BENCH", player("done", "WR", { status: "ir", outForSeason: true, seasonProjection: 200, percentRostered: 90 }))]);
  assert.equal(outsideCandidates([fa("fa1")], ctx(over, { settings: S({ droppable: ["done"] }) })).moves.length, 1);
});

test("rule 6: drops are judged on the rest of the season: a bye never makes a player droppable by itself", () => {
  const bench = [
    at("BENCH", player("bye", "WR", { game: null, projection: 0, seasonProjection: 120 })),
    at("BENCH", player("cheap", "WR", { seasonProjection: 50 })),
  ];
  const r = roster({ irSlots: 0 }, bench);
  const c = outsideCandidates([fa("fa1", { seasonProjection: 60 })], ctx(r, { settings: S({ droppable: ["bye", "cheap"] }) })).moves[0]!;
  assert.equal(c.add?.room.how === "drop" && c.add.room.player.id, "cheap");

  const unknown = roster({ irSlots: 0 }, [at("BENCH", player("nodata", "WR", { seasonProjection: undefined }))]);
  const asked = outsideCandidates([fa("fa1")], ctx(unknown, { settings: S({ droppable: ["nodata"] }) }));
  assert.deepEqual(asked.moves, []);
  assert.match(asked.asks[0]!.why, /no rest-of-season projection for nodata/);
});

test("rule 7: the add must be projected 2 points more than the slot gets without him, and never be worth less for the season than the player dropped", () => {
  assert.equal(NO_CRAY.upgradeMargin, 2);
  const r = roster({ irSlots: 0 });
  const slim = outsideCandidates([fa("fa1", { projection: 9 })], ctx(r, { baseline: 8 }));
  assert.deepEqual([slim.moves, slim.asks], [[], []]);
  assert.match(slim.rejected[0]!.why, /not projected 2 points more/);

  const worse = outsideCandidates([fa("fa1", { seasonProjection: 30 })], ctx(r));
  assert.match(worse.rejected[0]!.why, /worth less for the rest of the season than wr3/);

  const open = roster({ benchSlots: 4 });
  assert.equal(outsideCandidates([fa("fa1", { seasonProjection: 1 })], ctx(open)).moves.length, 1, "an open spot compares with nobody");
});

test("rule 8: never drop the only player at a position the lineup starts", () => {
  const r = roster({ irSlots: 0 }, [at("BENCH", player("qb2", "QB", { seasonProjection: 10 })), at("BENCH", player("wr9", "WR", { seasonProjection: 20 }))]);
  // The only QB is the starter; the backup QB could go. Make him the only QB by benching the starter's slot differently:
  const soleQb = roster({ irSlots: 0, starterSlots: ["QB", "RB", "RB", "WR", "WR", "FLEX"] }, [at("BENCH", player("wr9", "WR", { seasonProjection: 20 }))]);
  soleQb.entries = soleQb.entries.filter((e) => e.player.id !== "hurts").concat([at("BENCH", player("onlyqb", "QB", { seasonProjection: 5 }))]);
  const out = outsideCandidates([fa("fa1")], ctx(soleQb, { settings: S({ droppable: ["onlyqb", "wr9"] }) }));
  assert.equal(out.moves[0]?.add?.room.how === "drop" && out.moves[0].add.room.player.id, "wr9", "the only QB stays, the WR goes");
  // With two QBs, the cheaper one may go.
  const two = outsideCandidates([fa("fa1")], ctx(r, { settings: S({ droppable: ["qb2", "wr9"] }) }));
  assert.equal(two.moves[0]?.add?.room.how === "drop" && two.moves[0].add.room.player.id, "qb2");
});

test("room is made from the bench or with the hole's own starter, never by emptying another starting slot", () => {
  // Walker at FLEX is on bye (a hole of his own, cheap, droppable) and would qualify for nothing else; the bench is full of
  // WRs who are not droppable. Taking Walker would leave FLEX empty, so he is not the room.
  const r = roster({ irSlots: 0 });
  r.entries = r.entries.map((e) => (e.player.id === "walker" ? at("FLEX", player("walker", "RB", { game: null, projection: 0, seasonProjection: 5 })) : e));
  const out = outsideCandidates([fa("fa1")], ctx(r, { settings: S({ droppable: ["walker"] }) }));
  assert.deepEqual(out.moves, []);
  assert.equal(out.asks[0]?.candidate.add?.room.how === "drop" && out.asks[0].candidate.add.room.player.id, "wr3", "the question falls to the bench");
});

test("rule 9: a player on waivers is never an option", () => {
  const out = outsideCandidates([fa("fa1", {}, true)], ctx(roster({ benchSlots: 4 })));
  assert.deepEqual([out.moves, out.asks], [[], []]);
  assert.equal(out.rejected[0]?.rule, 9);
});

test("rule 10: no churn: at most two adds a week, never drop a player added in the last 7 days, never re-add one RosterBots dropped", () => {
  const r = roster({ irSlots: 0 });
  const capped = outsideCandidates([fa("fa1")], ctx(r, { history: history({ addsThisWeek: 2 }) }));
  assert.equal(capped.rejected[0]?.rule, 10);

  const fresh = outsideCandidates([fa("fa1")], ctx(r, { history: history({ addedAt: new Map([["wr3", "2026-10-01T00:00:00Z"]]) }) }));
  assert.equal(fresh.moves[0]?.add?.room.how === "drop" && fresh.moves[0].add.room.player.id, "wr2", "wr3 was added three days ago, so wr2 goes instead");

  const again = outsideCandidates([fa("fa1")], ctx(r, { history: history({ dropped: new Set(["fa1"]) }) }));
  assert.equal(again.rejected[0]?.rule, 10);
});

test("a free agent who cannot start in the slot is no option: wrong slot, on bye, doubtful, projected for zero, or already kicked off", () => {
  const r = roster({ benchSlots: 4 });
  const out = outsideCandidates(
    [
      fa("wr", { eligibleSlots: WR_ELIG }),
      fa("bye", { game: null }),
      fa("d", { status: "doubtful" }),
      fa("zero", { projection: 0 }),
      fa("played", { game: { kickoff: "2026-10-04T16:00:00Z" } }),
      fa("nokick", { game: undefined }),
      fa("ok"),
    ],
    ctx(r),
  );
  assert.deepEqual(ids(out.moves), ["ok"]);
  assert.deepEqual(out.rejected.map((x) => x.player.id).sort(), ["bye", "d", "nokick", "played", "wr", "zero"]);
});

test("options are ranked by this week's projection", () => {
  const out = outsideCandidates([fa("low", { projection: 11 }), fa("high", { projection: 14 }), fa("mid", { projection: 12 })], ctx(roster({ benchSlots: 6 })));
  assert.deepEqual(ids(out.moves), ["high", "mid", "low"]);
});

test("a full bench with nowhere to put the slot's own starter is no option", () => {
  // The drop is a bench player, which frees a bench spot; an IR move of a bench player does too. But a drop of a
  // starter who is out for the season frees no bench spot, and Achane still needs one.
  const r = roster({ irSlots: 0 });
  r.entries = r.entries.map((e) => (e.player.id === "walker" ? at("FLEX", player("walker", "RB", { status: "ir", outForSeason: true, projection: 0, seasonProjection: 0 })) : e));
  const out = outsideCandidates([fa("fa1")], ctx(r, { settings: S({ droppable: ["walker"] }) }));
  assert.deepEqual([out.moves, out.asks], [[], []]);
  assert.match(out.rejected[0]!.why, /no bench spot to move achane to/);
});

test("noCray on a stored transaction: the user's tap may waive the Droppable switch, never a hard rule", () => {
  const r = roster({ irSlots: 0 });
  const wr3 = r.entries.find((e) => e.player.id === "wr3")!.player;
  const tx = { add: fa("fa1").player, room: { how: "drop" as const, player: wr3, from: "BENCH" as const } };
  const v = noCray(tx, ctx(r, { settings: S({ droppable: [] }) }));
  assert.deepEqual(v.ok ? [] : [v.rule, v.waivable], [2, true]);
  const hard = noCray({ ...tx, room: { how: "drop", player: r.entries.find((e) => e.player.id === "jj")!.player, from: "WR" } }, ctx(r));
  assert.deepEqual(hard.ok ? [] : [hard.rule, hard.waivable], [3, false]);
});

test("advice judges an add for the weeks ahead: no this-week margin, but the same drop rules", () => {
  const r = roster({ irSlots: 0 });
  const backup = fa("backup", { projection: 1, seasonProjection: 70, game: null });
  const c = ctx(r, { purpose: "advice", slot: "BENCH", baseline: 0, occupant: undefined });
  const out = outsideCandidates([backup], c);
  assert.equal(out.moves.length, 1);
  assert.equal(out.moves[0]!.add?.room.how === "drop" && out.moves[0]!.add.room.player.id, "wr3");
  assert.deepEqual(out.moves[0]!.moves, [], "advice only adds him to the bench");
  const worse = outsideCandidates([fa("backup", { seasonProjection: 10, game: null })], c);
  assert.match(worse.rejected[0]!.why, /worth less for the rest of the season/);
});
