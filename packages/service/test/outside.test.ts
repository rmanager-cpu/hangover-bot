// AI Native's T-15 step against the fakes (docs/AI-NATIVE.md): a hole the bench cannot
// fill is filled from free agency under the No-Cray Rules, with the AI choosing among the
// options the code built; everything that must stop it; the fill upgrade; the all-clear.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { FreeAgent, Player, Slot } from "@rosterbots/core";
import { decideAction } from "../src/index.ts";
import { ACHANE, KICKOFF, MIN, SHAHEED, T, WRIGHT, achaneOut, entry, setup, team, FakeAi } from "./fakes.ts";

const RB: Slot[] = ["RB", "RB/WR", "FLEX", "BENCH", "IR"];
export const MASON = "4000001";

const mason = (over: Partial<Player> = {}): FreeAgent => ({
  player: {
    id: MASON, name: "Jordan Mason", position: "RB", proTeam: "MIN", status: "active", eligibleSlots: RB,
    projection: 12, seasonProjection: 80, percentRostered: 30, game: { kickoff: KICKOFF, opponent: "DET" }, locked: false, ...over,
  },
  onWaivers: false,
});

/**
 * Achane OUT at RB, Wright (the only bench RB) OUT too, and Shaheed on bye, so nobody on the
 * bench can fill it, not even by sliding Walker over. Shaheed is the droppable one (a bye
 * never stops a drop by itself). The bench is full, IR is used.
 */
function unfillable() {
  const r = achaneOut();
  entry(r, WRIGHT).player.status = "out";
  entry(r, WRIGHT).player.projection = 0;
  entry(r, SHAHEED).player.game = null;
  entry(r, SHAHEED).player.projection = 0;
  entry(r, SHAHEED).player.percentRostered = 20;
  entry(r, SHAHEED).player.seasonProjection = 50;
  r.benchSlots = 2;
  r.irSlots = 1;
  return r;
}

const ACHANE_KEY = `5:hole:${ACHANE}`;
const native = (over: Parameters<typeof setup>[0] = {}) =>
  setup({ roster: unfillable(), at: T - 15 * MIN, authority: "ai_rescue", ai: true, freeAgents: [mason()], conn: { droppable: [SHAHEED] }, ...over });

test("at T-15 a hole the bench cannot fill is filled from free agency: the AI picks from the code's options, the add and the moves are verified and receipted", async () => {
  const s = native();
  const sum = await s.run();
  assert.deepEqual({ executed: sum.executed, proposed: sum.proposed, notified: sum.notified }, { executed: 1, proposed: 0, notified: 1 });

  // The AI saw one option, built by the code: the free agent, with the room the rules made.
  const ai = s.ai as FakeAi;
  assert.equal(ai.picks.length, 1);
  assert.equal(ai.picks[0]!.problem, "Achane was ruled OUT at RB");
  assert.deepEqual(ai.picks[0]!.candidates.map((c) => [c.id, c.how]), [[MASON, "free agent, dropping Rashid Shaheed"]]);
  assert.deepEqual(s.espn.freeAgentReads, [{ period: 5, slots: ["RB"] }, { period: 5, slots: ["RB"] }], "read once to build the options, once more before the write");

  assert.deepEqual(s.espn.addDrops, [{ tx: { add: { playerId: MASON, toSlot: "BENCH" }, drop: { playerId: SHAHEED, fromSlot: "BENCH" } }, period: 5 }]);
  assert.deepEqual(s.espn.writes, [{ moves: [{ playerId: ACHANE, from: "RB", to: "BENCH" }, { playerId: MASON, from: "BENCH", to: "RB" }], period: 5 }]);
  assert.equal(entry(s.espn.roster, MASON).slot, "RB");
  assert.equal(s.espn.roster.entries.some((e) => e.player.id === SHAHEED), false);

  const row = s.store.actions.find((a) => a.kind === "execute")!;
  assert.equal(row.status, "done");
  assert.equal(row.findingKey, ACHANE_KEY);
  assert.equal(row.summary, "Add Jordan Mason (dropping Rashid Shaheed) and start him at RB instead of De'Von Achane");
  assert.deepEqual(row.transaction, { add: { playerId: MASON, name: "Jordan Mason", position: "RB", to: "BENCH" }, room: { how: "drop", playerId: SHAHEED, name: "Rashid Shaheed", from: "BENCH" } });

  assert.deepEqual(s.store.activity.map((x) => x.type), ["ACTION_REQUIRED", "ACTION_COMPLETED"], "the bench had nobody, said once; then the receipt");
  const receipt = s.store.activity[1]!;
  assert.equal(receipt.title, "Jordan Mason is in at RB");
  assert.equal(receipt.body, "Achane was ruled OUT. Added Jordan Mason, dropping Rashid Shaheed. Moved Jordan Mason from bench to RB. Achane is on your bench. Done at 12:45 PM ET.");
  assert.equal(s.store.checks.at(-1)!.patch.nextCheckAt, new Date(T - 14 * MIN).toISOString(), "AI Native checks every minute from T-16");
});

test("before T-15 nothing goes outside the roster, and the next check is a minute away from T-16", async () => {
  const s = native({ at: T - 20 * MIN });
  await s.run();
  assert.equal(s.espn.freeAgentReads.length, 0);
  assert.equal(s.espn.addDrops.length, 0);
  assert.equal(s.store.checks.at(-1)!.patch.nextCheckAt, new Date(T - 18 * MIN).toISOString());
  s.clock.set(T - 16 * MIN);
  await s.run();
  assert.equal(s.store.checks.at(-1)!.patch.nextCheckAt, new Date(T - 15 * MIN).toISOString());
});

test("rule 2: with nobody marked Droppable the add is a question, and the user's tap makes it", async () => {
  const s = native({ conn: { droppable: [] } });
  const sum = await s.run();
  assert.deepEqual([sum.executed, sum.proposed], [0, 1]);
  assert.equal(s.espn.addDrops.length, 0);
  const p = s.store.actions.find((a) => a.kind === "propose")!;
  assert.equal(p.status, "pending");
  assert.equal(p.transaction?.room.how, "drop");
  const ask = s.store.activity.find((x) => x.type === "ACTION_RECOMMENDED")!;
  assert.equal(ask.title, "Achane was ruled OUT");
  assert.equal(ask.body, "Add Jordan Mason (dropping Rashid Shaheed) and start him at RB instead of De'Von Achane? Tap to approve. Rashid Shaheed is not marked Droppable, so this one is your call.");

  // Asked twice is not asked again.
  s.clock.advance(1);
  await s.run();
  assert.equal(s.store.actions.filter((a) => a.kind === "propose").length, 1);

  const r = await decideAction(s.deps, "user-1", p.id, "approve");
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(s.espn.addDrops.length, 1);
  assert.equal(entry(s.espn.roster, MASON).slot, "RB");
  assert.match(r.ok ? r.message : "", /^Achane was ruled OUT\. Added Jordan Mason, dropping Rashid Shaheed\. Moved Jordan Mason from bench to RB\./);
  assert.equal(s.store.actions.find((a) => a.id === p.id)!.status, "done");
});

test("an AI that does not answer is tried again next minute; from T-8 the best option is offered for a tap instead", async () => {
  const ai = new FakeAi();
  ai.choose = () => undefined;
  const s = native({ ai });
  await s.run();
  assert.deepEqual([s.espn.addDrops.length, s.store.actions.filter((a) => a.kind === "propose").length], [0, 0]);
  for (const minutes of [14, 12, 9]) {
    s.clock.set(T - minutes * MIN);
    await s.run();
  }
  assert.equal(ai.picks.length, 4, "asked at every check");
  assert.equal(s.store.actions.filter((a) => a.kind === "propose").length, 0);
  s.clock.set(T - 8 * MIN);
  await s.run();
  const p = s.store.actions.find((a) => a.kind === "propose")!;
  assert.equal(p.status, "pending");
  assert.match(s.store.activity.at(-1)!.body, /The AI did not answer in time, so this one is your call\.$/);
});

test("an AI answer naming nobody on the list is a question for the user, never a move", async () => {
  const ai = new FakeAi();
  ai.choose = () => ({ playerId: "somebody-else", confidence: 1, reason: "trust me" });
  const s = native({ ai });
  await s.run();
  assert.equal(s.espn.addDrops.length, 0);
  assert.match(s.store.activity.at(-1)!.body, /named nobody on the list, so this one is your call\.$/);
});

test("the AI may say leave it: nothing is written, and the user hears that nobody outside fits either", async () => {
  const ai = new FakeAi();
  ai.choose = () => ({ playerId: null, confidence: 0.9, reason: "Mason is a backup this week" });
  const s = native({ ai });
  await s.run();
  assert.equal(s.espn.addDrops.length, 0);
  const note = s.store.activity.at(-1)!;
  assert.equal(note.title, "Nobody to fill RB");
  assert.equal(note.body, "No free agent fits RB either (Mason is a backup this week). Fix it in the ESPN app.");
  s.clock.advance(1);
  await s.run();
  assert.equal(s.store.activity.filter((x) => x.title === "Nobody to fill RB").length, 1, "said once");
});

test("the AI's confidence below the user's floor makes it a proposal, not a move", async () => {
  const ai = new FakeAi();
  ai.choose = (input) => ({ playerId: input.candidates[0]!.id, confidence: 0.5, reason: "maybe" });
  const s = native({ ai });
  const sum = await s.run();
  assert.deepEqual([sum.executed, sum.proposed], [0, 1]);
  assert.equal(s.store.actions.find((a) => a.kind === "propose")!.transaction?.add.playerId, MASON);
});

test("a fill RosterBots made from the bench at T-90 is replaced at T-15 by a free agent clearly better, never a starter the user chose", async () => {
  const r = achaneOut();
  entry(r, SHAHEED).player.percentRostered = 20;
  entry(r, SHAHEED).player.seasonProjection = 50;
  r.benchSlots = 2;
  r.irSlots = 1;
  const s = setup({ roster: r, at: T - 45 * MIN, authority: "ai_rescue", ai: true, freeAgents: [mason()], conn: { droppable: [SHAHEED] } });
  await s.run();
  assert.equal(entry(s.espn.roster, WRIGHT).slot, "RB", "the T-90 bench fill");
  assert.equal(s.espn.freeAgentReads.length, 0);

  s.clock.set(T - 15 * MIN);
  const sum = await s.run();
  assert.equal(sum.executed, 1);
  const ai = s.ai as FakeAi;
  assert.deepEqual(ai.picks[0]!.benchFill, { name: "Jaylen Wright", projection: 8.1 });
  assert.deepEqual(s.espn.writes.at(-1)!.moves, [{ playerId: WRIGHT, from: "RB", to: "BENCH" }, { playerId: MASON, from: "BENCH", to: "RB" }]);
  const row = s.store.actions.filter((a) => a.kind === "execute").at(-1)!;
  assert.equal(row.findingKey, ACHANE_KEY, "the same hole");
  assert.equal(row.summary, "Add Jordan Mason (dropping Rashid Shaheed) and start him at RB instead of Jaylen Wright");
  assert.equal(row.reason, "Achane was ruled OUT");
  assert.equal(entry(s.espn.roster, MASON).slot, "RB");
  assert.equal(entry(s.espn.roster, WRIGHT).slot, "BENCH");
  assert.equal(s.store.activity.at(-1)!.body, "Achane was ruled OUT. Added Jordan Mason, dropping Rashid Shaheed. Moved Jordan Mason from bench to RB. Wright is on your bench. Done at 12:45 PM ET.");
});

test("rule 7: a free agent not clearly better than the fill leaves the fill alone", async () => {
  const r = achaneOut();
  entry(r, SHAHEED).player.percentRostered = 20;
  entry(r, SHAHEED).player.seasonProjection = 50;
  r.benchSlots = 2;
  r.irSlots = 1;
  const s = setup({ roster: r, at: T - 45 * MIN, authority: "ai_rescue", ai: true, freeAgents: [mason({ projection: 9.5 })], conn: { droppable: [SHAHEED] } });
  await s.run();
  s.clock.set(T - 15 * MIN);
  await s.run();
  assert.equal(s.espn.addDrops.length, 0);
  assert.equal((s.ai as FakeAi).picks.length, 0, "no option to judge");
  assert.equal(entry(s.espn.roster, WRIGHT).slot, "RB");
});

test("an open IR slot is used before any drop: the OUT starter goes to IR, the add lands straight in his slot, and a bench landing is moved on", async () => {
  const r = unfillable();
  r.entries = r.entries.filter((e) => e.slot !== "IR"); // the IR slot is open
  entry(r, ACHANE).player.eligibleSlots = RB;
  const s = native({ roster: r });
  s.espn.addDropMode = "bench"; // ESPN puts him on the bench whatever was asked
  const sum = await s.run();
  assert.equal(sum.executed, 1);
  assert.deepEqual(s.espn.writes.map((w) => w.moves), [
    [{ playerId: ACHANE, from: "RB", to: "IR" }],
    [{ playerId: MASON, from: "BENCH", to: "RB" }],
  ]);
  assert.deepEqual(s.espn.addDrops[0]!.tx, { add: { playerId: MASON, toSlot: "RB" } });
  assert.equal(entry(s.espn.roster, ACHANE).slot, "IR");
  assert.equal(entry(s.espn.roster, MASON).slot, "RB");
  assert.equal(s.store.activity.at(-1)!.body, "Achane was ruled OUT. Added Jordan Mason, moving De'Von Achane to IR. Moved Jordan Mason from bench to RB. Done at 12:45 PM ET.");
});

test("an add ESPN does not show is a failed write: said once, with how far it got, and the week holds", async () => {
  const s = native();
  s.espn.addDropMode = "ignore";
  const sum = await s.run();
  assert.equal(sum.executed, 0);
  const row = s.store.actions.find((a) => a.kind === "execute")!;
  assert.equal(row.status, "failed");
  const fail = s.store.activity.find((x) => x.type === "ACTION_FAILED")!;
  assert.equal(fail.title, "Couldn't start Jordan Mason at RB");
  assert.match(fail.body, /I asked ESPN to add Jordan Mason \(dropping Rashid Shaheed\) and start him at RB, but it didn't go through, and I won't try it again on my own\. The add itself didn't go through\./);
  assert.equal(s.espn.writes.length, 0, "no lineup move after a failed add");

  s.espn.addDropMode = "apply";
  s.clock.advance(1);
  await s.run();
  assert.equal(s.espn.addDrops.length, 1, "not tried again on its own");
  assert.match(s.store.activity.at(-1)!.body, /An earlier change here didn't go through, so this one is yours to approve\.$/);
});

test("an add proposal is withdrawn when its hole goes away, and a tap on a stale one is refused", async () => {
  const s = native({ conn: { droppable: [] } });
  await s.run();
  const p = s.store.actions.find((a) => a.kind === "propose")!;
  // ESPN clears Achane: the hole is gone.
  entry(s.espn.roster, ACHANE).player.status = "active";
  entry(s.espn.roster, ACHANE).player.projection = 15;
  const r = await decideAction(s.deps, "user-1", p.id, "approve");
  assert.equal(!r.ok && r.error, "not_needed");
  assert.equal(s.espn.addDrops.length, 0);

  const t = native({ conn: { droppable: [] } });
  await t.run();
  entry(t.espn.roster, ACHANE).player.status = "active";
  entry(t.espn.roster, ACHANE).player.projection = 15;
  t.clock.advance(1);
  await t.run();
  assert.equal(t.store.actions.find((a) => a.kind === "propose")!.status, "superseded");
  assert.equal(t.store.activity.at(-1)!.title, "No change needed");
});

test("bench swaps off holds an add back too: a proposal, never silence", async () => {
  const s = native({ conn: { droppable: [SHAHEED], benchSwaps: false } });
  const sum = await s.run();
  assert.deepEqual([sum.executed, sum.proposed], [0, 1]);
  assert.equal(s.espn.addDrops.length, 0);
});

test("an add that landed before its lineup move failed still counts as this week's add", async () => {
  const s = native();
  s.espn.write = "ignore"; // the add goes through, the lineup move does not
  await s.run();
  const row = s.store.actions.find((a) => a.kind === "execute")!;
  assert.equal(row.status, "failed");
  assert.equal(entry(s.espn.roster, MASON).slot, "BENCH", "ESPN shows him added");
  assert.match(s.store.activity.find((x) => x.type === "ACTION_FAILED")!.body, /He was added, but the lineup move didn't go through\./);
  const hist = await (await import("../src/ops.ts")).outsideHistory(s.store, "conn-1", 5);
  assert.equal(hist.addsThisWeek, 1);
  assert.equal(hist.dropped.has(SHAHEED), true);
  assert.equal(hist.addedAt.has(MASON), true);
});

test("a league with no proven write gets the add as a proposal", async () => {
  const s = native({ conn: { droppable: [SHAHEED], writeVerifiedAt: null } });
  const sum = await s.run();
  assert.deepEqual([sum.executed, sum.proposed], [0, 1]);
  assert.match(s.store.activity.at(-1)!.body, /I haven't yet seen a change from RosterBots go through on ESPN in this league/);
});

test("rule 10: with two adds already this week, nothing more is added, and the user hears why", async () => {
  const s = native();
  for (const n of [1, 2]) {
    s.store.actions.push({
      id: `tx-${n}`, connectionId: "conn-1", userId: "user-1", findingKey: `5:hole:x${n}`, period: 5, kind: "execute", status: "done", moves: [],
      summary: "", reason: "", deadline: null, autoAt: null, signature: `tx-${n}`, createdAt: "2026-10-04T15:00:00.000Z", decidedAt: null, executedAt: "2026-10-04T15:00:00.000Z", result: null,
      transaction: { add: { playerId: `fa${n}`, name: `FA ${n}`, position: "RB", to: "BENCH" }, room: { how: "open" } },
    });
  }
  await s.run();
  assert.equal(s.espn.addDrops.length, 0);
  assert.equal(s.store.activity.at(-1)!.body, "No free agent fits RB either (2 adds already this week). Fix it in the ESPN app.");
});

test("without an AI in the deployment, AI Native fixes from the bench and never looks outside", async () => {
  const s = setup({ roster: unfillable(), at: T - 15 * MIN, authority: "ai_rescue", freeAgents: [mason()], conn: { droppable: [SHAHEED] } });
  await s.run();
  assert.deepEqual([s.espn.freeAgentReads.length, s.espn.addDrops.length], [0, 0]);
});

test("an unclaimed AI Native account gets nothing from outside the roster", async () => {
  const s = native({ claimed: false });
  await s.run();
  assert.deepEqual([s.espn.freeAgentReads.length, s.espn.addDrops.length], [0, 0]);
});

test("a free agent read ESPN refuses waits for the next minute's check", async () => {
  const s = native();
  s.espn.freeAgentRead = "error";
  const sum = await s.run();
  assert.equal(sum.outcome, "ok");
  assert.equal(s.espn.addDrops.length, 0);
  s.espn.freeAgentRead = "ok";
  s.clock.advance(1);
  assert.equal((await s.run()).executed, 1);
});

// ---- T-3: the all-clear, every level

test("three minutes before a kickoff, the user hears the lineup is set for it, once", async () => {
  const s = setup({ roster: team(), at: T - 3 * MIN, authority: "ask_me" });
  const sum = await s.run();
  assert.equal(sum.notified, 1);
  const n = s.store.activity[0]!;
  assert.deepEqual([n.type, n.title, n.body], ["ALL_CLEAR", "All clear for 1:00 PM ET", "Every starter kicking off at 1:00 PM ET is set."]);
  assert.equal(s.push.sent.length, 1);
  s.clock.advance(1);
  await s.run();
  assert.equal(s.store.activity.length, 1, "not repeated at T-2");
  // The late games get their own.
  s.clock.set(Date.parse("2026-10-04T20:22:00.000Z"));
  await s.run();
  assert.equal(s.store.activity.at(-1)!.title, "All clear for 4:25 PM ET");
});

test("the all-clear says what is still wrong, and what is waiting for a tap", async () => {
  // Alert Me: the hole is not RosterBots' to fix, so it is still wrong at T-3. (Auto Protect fixes it in that minute.)
  const s = setup({ roster: achaneOut(), at: T - 3 * MIN, authority: "ask_me" });
  await s.run();
  const n = s.store.activity.find((x) => x.type === "ALL_CLEAR")!;
  assert.equal(n.title, "Still wrong before 1:00 PM ET");
  assert.equal(n.body, "Achane was ruled OUT. Fix it in the ESPN app. One move is waiting for your answer in the app.");
});

test("nothing is said before T-3", async () => {
  const s = setup({ roster: team(), at: T - 4 * MIN });
  await s.run();
  assert.equal(s.store.activity.length, 0);
});
