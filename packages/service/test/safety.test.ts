// The Oct 3 review's automation-safety findings, each as the scenario it described,
// run against the fakes. Every one of these wrote to ESPN, or stayed silent, before the fix.
import { test } from "node:test";
import assert from "node:assert/strict";
import { decideAction, manualSwap, signature } from "../src/index.ts";
import type { ActionRow } from "../src/index.ts";
import { ACHANE, KICKOFF, MIN, SHAHEED, SUNDAY_8AM, T, WALKER, WRIGHT, achaneOut, entry, setup, team } from "./fakes.ts";

const SWAP = [
  { playerId: ACHANE, from: "RB" as const, to: "BENCH" as const },
  { playerId: WRIGHT, from: "BENCH" as const, to: "RB" as const },
];
const ACHANE_KEY = `5:starter_out:${ACHANE}`;
const SATURDAY = "2026-10-03T18:00:00.000Z";
const failures = (s: ReturnType<typeof setup>) => s.store.activity.filter((x) => x.type === "ACTION_FAILED").length;

// ---- a failed write stops automatic moves for the week

test("after a partial write, the next check does not finish the job on its own", async () => {
  const s = setup({ roster: achaneOut() });
  s.espn.write = "partial"; // Achane benched, Wright never started: the RB slot is now empty
  await s.run();
  assert.equal(s.store.actions[0]!.status, "failed");

  s.espn.write = "apply";
  s.clock.advance(2);
  const next = await s.run();
  assert.equal(s.espn.writes.length, 1, "no second automatic write");
  assert.equal(next.proposed, 1);
  const p = s.store.actions.at(-1)!;
  assert.deepEqual([p.kind, p.status, p.findingKey, p.autoAt], ["propose", "pending", "5:empty_slot:RB#1", null]);
  assert.match(s.store.activity.at(-1)!.body, /didn't go through on ESPN earlier this week, so for the rest of the week I'll ask before every move\.$/);
});

test("a move held because a write just failed is not made automatically at the next check", async () => {
  const r = achaneOut();
  entry(r, WALKER).player.status = "out";
  entry(r, WALKER).player.game = { kickoff: KICKOFF };
  const s = setup({ roster: r });
  s.espn.write = "ignore";
  await s.run();
  assert.deepEqual(s.store.actions.map((a) => [a.kind, a.status]), [["execute", "failed"], ["propose", "pending"]]);

  s.espn.write = "apply";
  for (let i = 0; i < 3; i++) {
    s.clock.advance(2);
    await s.run();
  }
  assert.equal(s.espn.writes.length, 1);
  assert.equal(failures(s), 1);
  assert.equal(s.store.activity.length, 2, "nothing new to say");
});

test("an approval ESPN did not apply is never made again automatically at T-90", async () => {
  const s = setup({ roster: achaneOut(), at: T - 180 * MIN });
  await s.run();
  s.espn.write = "ignore";
  const r = await decideAction(s.deps, "user-1", s.store.actions[0]!.id, "approve");
  assert.equal(!r.ok && r.error, "not_applied");

  s.espn.write = "apply";
  s.clock.set(T - 90 * MIN);
  await s.run();
  assert.equal(s.espn.writes.length, 1);
  assert.equal(failures(s), 1, "the same failure is not told twice");
});

test("a change the user approved and then undid in the ESPN app is not redone at T-90", async () => {
  const s = setup({ roster: achaneOut(), at: T - 180 * MIN });
  await s.run();
  assert.equal((await decideAction(s.deps, "user-1", s.store.actions[0]!.id, "approve")).ok, true);
  entry(s.espn.roster, ACHANE).slot = "RB";
  entry(s.espn.roster, WRIGHT).slot = "BENCH";

  s.clock.set(T - 90 * MIN);
  await s.run();
  assert.equal(s.espn.writes.length, 1);
  assert.deepEqual(s.store.activity.map((x) => x.type), ["ACTION_RECOMMENDED", "ACTION_COMPLETED"]);
});

// ---- the reason for a move is checked again, and a proposal outlives no problem

test("approving a move whose problem went away writes nothing", async () => {
  const s = setup({ roster: achaneOut(), authority: "ask_me", at: SUNDAY_8AM });
  await s.run();
  entry(s.espn.roster, ACHANE).player.status = "active"; // upgraded on Saturday night
  const r = await decideAction(s.deps, "user-1", s.store.actions[0]!.id, "approve");
  assert.deepEqual(r, { ok: false, error: "not_needed", message: "This isn't needed any more: ESPN no longer shows the problem it was for. Nothing was changed." });
  assert.equal(s.espn.writes.length, 0);
  assert.equal(s.store.actions[0]!.status, "superseded");
});

test("approving a move whose replacement has since been ruled out writes nothing", async () => {
  const s = setup({ roster: achaneOut(), authority: "ask_me", at: SUNDAY_8AM });
  await s.run();
  entry(s.espn.roster, WRIGHT).player.status = "out";
  const r = await decideAction(s.deps, "user-1", s.store.actions[0]!.id, "approve");
  assert.equal(!r.ok && r.error, "stale");
  assert.equal(s.espn.writes.length, 0);

  const t = setup({ roster: achaneOut(), authority: "ask_me", at: SUNDAY_8AM });
  await t.run();
  entry(t.espn.roster, WRIGHT).player.status = "out";
  entry(t.espn.roster, ACHANE).player.status = "active";
  assert.equal((await decideAction(t.deps, "user-1", t.store.actions[0]!.id, "approve")).ok, false, "never an OUT player for a healthy one");
  assert.equal(t.espn.writes.length, 0);
});

test("a scheduled move whose problem went away is withdrawn, said once, and never made", async () => {
  const s = setup({ roster: achaneOut(), at: SUNDAY_8AM });
  await s.run();
  assert.equal(s.store.actions[0]!.autoAt, "2026-10-04T15:30:00.000Z");

  entry(s.espn.roster, ACHANE).player.status = "active";
  s.clock.advance(15);
  assert.equal((await s.run()).notified, 1);
  assert.equal(s.store.actions[0]!.status, "superseded");
  const told = s.store.activity.at(-1)!;
  assert.deepEqual(
    [told.type, told.title, told.body],
    ["STATUS_CHANGED", "No change needed", `I've dropped "Start Jaylen Wright at RB instead of De'Von Achane". ESPN no longer shows the problem it was for, so nothing needs changing.`],
  );

  s.clock.set(T - 90 * MIN);
  await s.run();
  assert.equal(s.espn.writes.length, 0);
  assert.equal(s.store.activity.length, 2);
});

test("a proposal whose fix has gone is replaced by the notice that says so", async () => {
  const s = setup({ roster: achaneOut(), authority: "ask_me", at: SUNDAY_8AM });
  await s.run();
  entry(s.espn.roster, WRIGHT).player.status = "out";
  s.clock.advance(15);
  await s.run();
  assert.deepEqual(s.store.actions.map((a) => [a.kind, a.status]), [["propose", "superseded"], ["notify", "done"]]);
});

test("a proposal whose players are locked is expired quietly, not withdrawn with a notice", async () => {
  const s = setup({ roster: achaneOut(), authority: "ask_me", at: SUNDAY_8AM });
  await s.run();
  entry(s.espn.roster, ACHANE).player.locked = true; // ESPN locked him a moment before kickoff
  s.clock.set(T - MIN);
  await s.run();
  assert.equal(s.store.actions[0]!.status, "expired");
  assert.equal(s.store.activity.length, 1);
});

// ---- no automatic move until a change has been seen landing on ESPN

test("before any change has been seen landing on ESPN, nothing is automatic and nothing is promised", async () => {
  const s = setup({ roster: achaneOut(), at: SUNDAY_8AM, conn: { writeVerifiedAt: null } });
  await s.run();
  const p = s.store.actions[0]!;
  assert.deepEqual([p.kind, p.status, p.autoAt], ["propose", "pending", null]);
  assert.match(s.store.activity[0]!.body, /^Start Jaylen Wright at RB instead\? Tap to approve\. I haven't yet seen a change from HangoverBot go through on ESPN/);

  s.clock.set(T - 45 * MIN);
  await s.run();
  assert.equal(s.espn.writes.length, 0);
  assert.equal(s.store.activity.length, 1, "already said");
});

test("a test swap that lands unlocks automatic moves, and one ESPN ignores locks them again", async () => {
  const s = setup({ roster: achaneOut(), at: SATURDAY, conn: { writeVerifiedAt: null } });
  assert.equal((await manualSwap(s.deps, "user-1", "conn-1", SHAHEED, WALKER)).ok, true);
  assert.equal(s.store.connections.get("conn-1")!.writeVerifiedAt, SATURDAY);
  await manualSwap(s.deps, "user-1", "conn-1", SHAHEED, WALKER); // and back
  s.clock.set(T - 45 * MIN);
  assert.equal((await s.run()).executed, 1);

  const t = setup({ at: SATURDAY });
  t.espn.write = "ignore";
  await manualSwap(t.deps, "user-1", "conn-1", WRIGHT, WALKER);
  assert.equal(t.store.connections.get("conn-1")!.writeVerifiedAt, null);
  t.espn.roster = achaneOut();
  t.clock.set(T - 45 * MIN);
  await t.run();
  assert.equal(t.espn.writes.length, 1, "only the test swap");
  assert.match(t.store.activity.at(-1)!.body, /Do the test swap/);
});

test("an approval ESPN shows is proof too", async () => {
  const s = setup({ roster: achaneOut(), authority: "ask_me", at: SUNDAY_8AM, conn: { writeVerifiedAt: null } });
  await s.run();
  s.clock.advance(5);
  await decideAction(s.deps, "user-1", s.store.actions[0]!.id, "approve");
  assert.equal(s.store.connections.get("conn-1")!.writeVerifiedAt, "2026-10-04T12:05:00.000Z");
});

// ---- a write a dead run left in flight

function inFlight(s: ReturnType<typeof setup>, minutesAgo: number): ActionRow {
  const row: ActionRow = {
    id: "act-dead", connectionId: "conn-1", userId: "user-1", findingKey: ACHANE_KEY, period: 5, kind: "execute", status: "approved",
    moves: SWAP, summary: "Start Jaylen Wright at RB instead of De'Von Achane", reason: "Achane was ruled OUT", deadline: KICKOFF, autoAt: null,
    signature: signature("execute", ACHANE_KEY, SWAP), createdAt: new Date(s.clock.t - minutesAgo * MIN).toISOString(),
    decidedAt: null, executedAt: null, result: null,
  };
  s.store.actions.push(row);
  return row;
}

test("a write a dead run left in flight is failed and told, if ESPN does not show it", async () => {
  const s = setup({ roster: achaneOut() });
  inFlight(s, 6);
  await s.run();
  assert.equal(s.store.actions[0]!.status, "failed");
  assert.equal(s.espn.writes.length, 0, "never retried");
  assert.deepEqual(s.store.activity.map((x) => x.type), ["ACTION_FAILED"]);
  assert.match(s.store.activity[0]!.body, /ESPN now shows Achane at RB and Wright on your bench\./);
});

test("a write a dead run left in flight gets its receipt, if ESPN shows it", async () => {
  const s = setup({ roster: achaneOut() });
  entry(s.espn.roster, ACHANE).slot = "BENCH";
  entry(s.espn.roster, WRIGHT).slot = "RB";
  inFlight(s, 6);
  await s.run();
  assert.equal(s.store.actions[0]!.status, "done");
  assert.deepEqual(s.store.activity.map((x) => [x.type, x.title]), [["ACTION_COMPLETED", "Jaylen Wright is in at RB"]]);
});

test("a write still in flight is left alone, and counts against the day", async () => {
  const s = setup({ roster: achaneOut() });
  inFlight(s, 1);
  for (const at of ["2026-10-04T13:00:00.000Z", "2026-10-04T14:00:00.000Z"]) s.store.seedExecute("conn-1", at);
  const r = team();
  entry(r, WALKER).player.status = "out";
  entry(r, WALKER).player.game = { kickoff: KICKOFF };
  s.espn.roster = r; // a different problem: Walker at FLEX
  await s.run();
  assert.equal(s.store.actions[0]!.status, "approved", "not this run's to settle");
  assert.equal(s.espn.writes.length, 0, "two done and one in flight: today's three");
  assert.match(s.store.activity.at(-1)!.body, /today's limit/);
});

// ---- the user's answer and the checker never overwrite each other

test("a decline that lands while the checker reads ESPN wins: nothing is written", async () => {
  const s = setup({ roster: achaneOut(), at: SUNDAY_8AM });
  await s.run();
  s.clock.set(T - 90 * MIN);
  s.espn.onRead = (n) => {
    if (n === 3) s.store.actions[0]!.status = "declined"; // the check's own read is #2; #3 is the one before the write
  };
  await s.run();
  assert.equal(s.espn.writes.length, 0);
  assert.equal(s.store.actions[0]!.status, "declined");
  assert.equal(s.store.actions.length, 1);
});

test("a pause, or protection turned down, while the checker reads ESPN stops the write", async () => {
  for (const change of [{ status: "paused" as const }, { authority: "ask_me" as const }, { benchSwaps: false }]) {
    const s = setup({ roster: achaneOut() });
    s.espn.onRead = (n) => {
      if (n === 2) Object.assign(s.store.connections.get("conn-1")!, change);
    };
    await s.run();
    assert.equal(s.espn.writes.length, 0, JSON.stringify(change));
  }
});

test("an approval that lands while the checker reads ESPN makes the only write", async () => {
  const s = setup({ roster: achaneOut(), at: SUNDAY_8AM });
  await s.run();
  s.clock.set(T - 90 * MIN);
  s.espn.onRead = (n) => {
    if (n === 3) s.store.actions[0]!.status = "approved"; // the user's write is under way
  };
  await s.run();
  assert.equal(s.espn.writes.length, 0, "the checker stands back");
  assert.equal(s.store.actions.length, 1);
});

test("an approval that loses to the checker is refused, not written twice", async () => {
  const s = setup({ roster: achaneOut(), at: SUNDAY_8AM });
  await s.run();
  const id = s.store.actions[0]!.id;
  s.espn.onRead = (n) => {
    if (n === 2) s.store.actions[0]!.status = "superseded"; // the checker took it while the approval read ESPN
  };
  const r = await decideAction(s.deps, "user-1", id, "approve");
  assert.deepEqual(r, { ok: false, error: "not_pending", message: "That suggestion was replaced by a newer one. Check Activity." });
  assert.equal(s.espn.writes.length, 0);
});

// ---- one refusal from ESPN is not a sign-out

test("one refusal from ESPN is looked at again before anyone is told to sign in", async () => {
  const s = setup({ roster: achaneOut() });
  s.espn.read = "auth";
  s.espn.onRead = (n) => {
    if (n === 2) s.espn.read = "ok";
  };
  const sum = await s.run();
  assert.equal(sum.outcome, "ok");
  assert.equal(sum.executed, 1);
  assert.deepEqual(s.pauses, [3000]);
  assert.equal(s.store.connections.get("conn-1")!.status, "active");
  assert.equal(s.store.activity.some((x) => x.title === "Sign in to ESPN again"), false);
});

test("a league waiting for a new sign-in is tried again within 5 minutes, not an hour", async () => {
  const s = setup({ roster: achaneOut() });
  s.espn.read = "auth";
  const sum = await s.run();
  assert.equal(sum.outcome, "needs_reauth");
  assert.equal(sum.nextCheckAt, new Date(T - 40 * MIN).toISOString());
  assert.equal(s.store.checks.at(-1)!.patch.nextCheckAt, sum.nextCheckAt);
  assert.equal(s.espn.reads, 2, "the refusal was looked at twice");
});
