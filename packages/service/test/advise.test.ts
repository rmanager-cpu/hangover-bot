// Roster Advice against the fakes (docs/AI-NATIVE.md): when it runs, what the Advisor sees,
// what becomes a one-tap item, what is thrown out, and the tap itself.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Advice, FreeAgent, Player, Slot } from "@rosterbots/core";
import { adviceDue, adviseConnection, decideAction, lastAdviceMoment } from "../src/index.ts";
import { FakeAi, JEFFERSON, SHAHEED, T, entry, setup, team } from "./fakes.ts";

const RB: Slot[] = ["RB", "RB/WR", "FLEX", "BENCH", "IR"];
const MASON = "4000001";
const fa = (id: string, name: string, over: Partial<Player> = {}, onWaivers = false): FreeAgent => ({
  player: { id, name, position: "RB", proTeam: "MIN", status: "active", eligibleSlots: RB, projection: 11, seasonProjection: 80, percentRostered: 30, game: { kickoff: "2026-10-11T17:00:00.000Z" }, locked: false, ...over },
  onWaivers,
});

// Tuesday 10:00 ET, Oct 6 2026, is 14:00 UTC.
const TUESDAY_10 = "2026-10-06T14:00:00.000Z";

const item = (over: Partial<Advice> = {}): Advice => ({ kind: "rb_backup", title: "Mason is the backup to grab", body: "Achane is hurt; Mason is free.", sources: ["https://example.com/news"], ...over });

function league(items: Advice[], at = TUESDAY_10, benchSlots = 2) {
  const r = team();
  // On Tuesday the roster shows next Sunday's games: nobody's game is under way.
  for (const e of r.entries) if (e.player.game) e.player.game = { kickoff: "2026-10-11T17:00:00.000Z" };
  entry(r, SHAHEED).player.percentRostered = 20;
  entry(r, SHAHEED).player.seasonProjection = 50;
  r.benchSlots = benchSlots;
  r.irSlots = 1;
  const ai = new FakeAi();
  ai.suggest = () => items;
  return setup({ roster: r, at, authority: "ai_rescue", ai, freeAgents: [fa(MASON, "Jordan Mason"), fa("w1", "Waiver Guy", {}, true)], conn: { droppable: [] } });
}

test("advice moments are 10 AM Eastern Tuesday to Saturday and 6 PM Saturday", () => {
  assert.equal(lastAdviceMoment(new Date("2026-10-06T14:30:00Z"))?.toISOString(), TUESDAY_10, "Tuesday 10:30 ET: the moment just passed");
  assert.equal(lastAdviceMoment(new Date("2026-10-06T13:00:00Z"))?.toISOString(), "2026-10-03T22:00:00.000Z", "Tuesday 9 AM ET: Saturday 6 PM was the last");
  assert.equal(lastAdviceMoment(new Date("2026-10-11T01:00:00Z"))?.toISOString(), "2026-10-10T22:00:00.000Z", "Saturday night: 6 PM");
  assert.equal(lastAdviceMoment(new Date("2026-10-05T12:00:00Z"))?.toISOString(), "2026-10-03T22:00:00.000Z", "Monday morning: still Saturday evening");
});

test("advice is due for an active AI Native league not advised since the last moment", () => {
  const base = { ...setup().conn, authority: "ai_rescue" as const };
  const now = new Date("2026-10-06T14:30:00Z");
  assert.equal(adviceDue({ ...base, advisedAt: null }, now), true);
  assert.equal(adviceDue({ ...base, advisedAt: "2026-10-06T14:05:00Z" }, now), false, "advised after the moment");
  assert.equal(adviceDue({ ...base, advisedAt: "2026-10-05T14:05:00Z" }, now), true, "advised before it");
  assert.equal(adviceDue({ ...base, authority: "bench_protection", advisedAt: null }, now), false);
  assert.equal(adviceDue({ ...base, status: "paused", advisedAt: null }, now), false);
});

test("the Advisor sees the roster and the free agents, never a cookie; its items become one-tap rows, and one push says so", async () => {
  const s = league([
    item({ action: { add: MASON, drop: SHAHEED }, expiresAt: "2026-10-11T17:00:00Z" }),
    item({ kind: "bye", title: "Three starters on bye in week 9", body: "Jefferson, St. Brown and the Vikings D/ST all sit in week 9.", sources: ["ESPN"] }),
  ]);
  const sum = await adviseConnection(s.deps, s.conn);
  assert.deepEqual({ outcome: sum.outcome, given: sum.given, recorded: sum.recorded }, { outcome: "ok", given: 2, recorded: 2 });

  const ai = s.ai as FakeAi;
  const input = ai.asked[0]!;
  assert.equal(input.teamName, "Trust The Process");
  assert.equal(input.week, 5);
  assert.deepEqual(input.starterSlots, ["QB", "RB", "RB", "WR", "WR", "FLEX", "DST"]);
  assert.equal(input.roster.find((p) => p.id === JEFFERSON)?.slot, "WR");
  assert.deepEqual(input.freeAgents.map((p) => [p.id, p.onWaivers]), [[MASON, false], ["w1", true]]);
  assert.equal(JSON.stringify(input).includes("espn"), false);

  const rows = s.store.actions.filter((a) => a.kind === "advise");
  assert.equal(rows.length, 2);
  const add = rows.find((a) => a.transaction)!;
  assert.equal(add.status, "pending");
  assert.equal(add.summary, "Mason is the backup to grab");
  assert.equal(add.reason, "Achane is hurt; Mason is free.");
  assert.deepEqual(add.sources, ["https://example.com/news"]);
  assert.deepEqual(add.transaction, { add: { playerId: MASON, name: "Jordan Mason", position: "RB", to: "BENCH" }, room: { how: "drop", playerId: SHAHEED, name: "Rashid Shaheed", from: "BENCH" } });
  assert.deepEqual(add.moves, [], "advice only adds him to the bench");
  assert.equal(add.deadline, "2026-10-11T17:00:00.000Z");
  const note = rows.find((a) => !a.transaction)!;
  assert.equal(note.findingKey, "5:advice:three-starters-on-bye-in-week-9");

  assert.deepEqual(s.store.activity.map((x) => [x.type, x.title]), [["ADVICE", "Roster Advice: 2 suggestions"]]);
  assert.equal(s.store.activity[0]!.body, "Mason is the backup to grab and Three starters on bye in week 9. Open Advice in the app; nothing happens without your tap.");
  assert.equal(s.push.sent.length, 1);
  assert.deepEqual(s.store.advised, [{ connectionId: "conn-1", at: TUESDAY_10 }]);

  // Not due again until the next moment, and the same items are never recorded twice.
  assert.equal((await adviseConnection(s.deps, { ...s.conn, advisedAt: TUESDAY_10 })).outcome, "skipped");
  assert.equal((await adviseConnection(s.deps, { ...s.conn, advisedAt: null })).recorded, 0);
});

test("an item whose move breaks a rule keeps its words and loses its tap; one naming a player who is not there is no advice at all", async () => {
  const s = league([
    item({ title: "Waiver guy", action: { add: "w1" } }),
    item({ title: "Drop Jefferson", action: { add: MASON, drop: JEFFERSON } }),
    item({ title: "Who?", action: { add: "nobody" } }),
    item({ title: "Mason into the open spot", action: { add: MASON } }),
  ]);
  const sum = await adviseConnection(s.deps, s.conn);
  assert.deepEqual([sum.given, sum.recorded], [4, 3]);
  const rows = s.store.actions.filter((a) => a.kind === "advise");
  assert.deepEqual(rows.map((a) => [a.summary, a.transaction ? "tap" : "heads-up"]), [
    ["Waiver guy", "heads-up"],
    ["Drop Jefferson", "heads-up"],
    ["Mason into the open spot", "tap"],
  ]);
  assert.equal(rows[2]!.transaction?.room.how, "drop", "the bench is full, so the rules picked the drop");
});

test("a season-ending injury the AI read about makes the drop a one-tap suggestion, though ESPN still shows him playing (rule 4); never a move", async () => {
  // A bench spot is open for the add; dropping a starter frees none, and Mason cannot play WR.
  const s = league([item({ kind: "injury", title: "Jefferson tore his ACL", body: "Out for the year per two reports; ESPN still lists him active.", action: { add: MASON, drop: JEFFERSON, outForSeason: true } })], TUESDAY_10, 3);
  const sum = await adviseConnection(s.deps, s.conn);
  assert.equal(sum.recorded, 1);
  const row = s.store.actions.find((a) => a.kind === "advise")!;
  assert.deepEqual(row.transaction?.room, { how: "drop", playerId: JEFFERSON, name: "Justin Jefferson", from: "WR", outForSeason: true });
  assert.equal(s.espn.addDrops.length, 0, "nothing happens without the tap");
  const r = await decideAction(s.deps, "user-1", row.id, "approve");
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(s.espn.roster.entries.some((e) => e.player.id === JEFFERSON), false);
  assert.equal(entry(s.espn.roster, MASON).slot, "BENCH");

  // With the bench full, the same item has nowhere to put Mason: a heads-up, no tap.
  const full = league([item({ kind: "injury", title: "Jefferson tore his ACL", body: "Out for the year.", action: { add: MASON, drop: JEFFERSON, outForSeason: true } })]);
  await adviseConnection(full.deps, full.conn);
  assert.equal(full.store.actions.find((a) => a.kind === "advise")!.transaction, null);
});

test("the tap carries an advice item out: the add is verified and receipted; a decline leaves it", async () => {
  const s = league([item({ action: { add: MASON, drop: SHAHEED } }), item({ kind: "bye", title: "Byes ahead", body: "Plan.", sources: ["ESPN"] })]);
  await adviseConnection(s.deps, s.conn);
  const [add, note] = s.store.actions.filter((a) => a.kind === "advise");
  const r = await decideAction(s.deps, "user-1", add!.id, "approve");
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.ok && r.message, "Achane is hurt; Mason is free. Added Jordan Mason, dropping Rashid Shaheed. Done at 10:00 AM ET.");
  assert.equal(entry(s.espn.roster, MASON).slot, "BENCH");
  assert.equal(s.espn.roster.entries.some((e) => e.player.id === SHAHEED), false);
  assert.equal(s.store.actions.find((a) => a.id === add!.id)!.status, "done");

  const d = await decideAction(s.deps, "user-1", note!.id, "decline");
  assert.equal(d.ok && d.status, "declined");
  const again = await decideAction(s.deps, "user-1", note!.id, "approve");
  assert.equal(!again.ok && again.error, "not_pending");
});

test("an Advisor that fails, or a league with no AI, records nothing and does not throw", async () => {
  const ai = new FakeAi();
  ai.suggest = () => {
    throw new Error("anthropic is down");
  };
  const s = setup({ roster: team(), at: TUESDAY_10, authority: "ai_rescue", ai });
  const sum = await adviseConnection(s.deps, s.conn);
  assert.equal(sum.outcome, "error");
  assert.equal(s.store.actions.length, 0);
  const none = setup({ roster: team(), at: TUESDAY_10, authority: "ai_rescue" });
  assert.equal((await adviseConnection(none.deps, none.conn)).outcome, "skipped");
  assert.equal(T > 0, true);
});
