// The Oct 3 review's automation-safety findings, each as the scenario it described,
// run against the fakes. Every one of these wrote to ESPN, or stayed silent, before the fix.
import { test } from "node:test";
import assert from "node:assert/strict";
import { decideAction, manualSwap, signature } from "../src/index.ts";
import type { ActionRow } from "../src/index.ts";
import { PROVED } from "../src/words.ts";
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
  // The one new thing: Achane is still OUT at RB, so the fix that failed is offered for a tap, once.
  assert.deepEqual(s.store.activity.map((x) => x.type), ["ACTION_FAILED", "ACTION_RECOMMENDED", "ACTION_RECOMMENDED"]);
  assert.match(s.store.activity[2]!.body, /An earlier change here didn't go through, so this one is yours to approve\.$/);
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
  const first = await manualSwap(s.deps, "user-1", "conn-1", SHAHEED, WALKER);
  assert.equal(first.ok, true);
  assert.equal(
    first.ok && first.message,
    "Moved Rashid Shaheed from bench to FLEX. Walker is on your bench. Done at 2:00 PM ET. " + PROVED,
    "the receipt says this is the change that unlocks automatic moves",
  );
  assert.equal(s.store.connections.get("conn-1")!.writeVerifiedAt, SATURDAY);
  const back = await manualSwap(s.deps, "user-1", "conn-1", SHAHEED, WALKER); // and back
  assert.equal(back.ok && back.message.includes(PROVED), false, "said once");
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

test("an approval ESPN shows is proof too, and its receipt says so", async () => {
  const s = setup({ roster: achaneOut(), authority: "ask_me", at: SUNDAY_8AM, conn: { writeVerifiedAt: null } });
  await s.run();
  s.clock.advance(5);
  const r = await decideAction(s.deps, "user-1", s.store.actions[0]!.id, "approve");
  assert.equal(r.ok && r.message, "Achane was ruled OUT. Moved Jaylen Wright from bench to RB. Achane is on your bench. Done at 8:05 AM ET. " + PROVED);
  assert.equal(s.store.activity.at(-1)!.body, r.ok && r.message, "the activity receipt carries the same line");
  assert.equal(s.store.connections.get("conn-1")!.writeVerifiedAt, "2026-10-04T12:05:00.000Z");
});

test("the gate is per league, not the connector's word: a write the connector calls verified still waits for the user's first change", async () => {
  const s = setup({ roster: achaneOut(), conn: { writeVerifiedAt: null } });
  s.espn.unverified = [];
  await s.run();
  assert.equal(s.espn.writes.length, 0);
  assert.match(s.store.activity[0]!.body, /Do the test swap/);

  const t = setup({ roster: achaneOut() }); // the Saturday test swap landed here
  t.espn.unverified = ["WRITE_LINEUP"];
  assert.equal((await t.run()).executed, 1);
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
  // Then, with Achane still OUT at RB, the same fix is a proposal (an attempt was made for it this week).
  assert.deepEqual(s.store.activity.map((x) => x.type), ["ACTION_FAILED", "ACTION_RECOMMENDED"]);
  assert.match(s.store.activity[0]!.body, /ESPN now shows Achane at RB and Wright on your bench\./);
  assert.match(s.store.activity[1]!.body, /An earlier change here didn't go through/);
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

// ---- the Oct 3 second review: incomplete reads, the verifying read, undone moves, the cadence

/** Every player's kickoff gone, the way a failed schedule request leaves a read. The fake's roster is live, so this sticks. */
function noSchedule(r: ReturnType<typeof team>): void {
  for (const e of r.entries) e.player.game = undefined;
}

/** The kickoffs back, as a whole read has them. */
function withSchedule(r: ReturnType<typeof team>): void {
  const fresh = team();
  for (const e of r.entries) e.player.game = entry(fresh, e.player.id).player.game;
}

test("a schedule that drops out for one check neither withdraws a scheduled move, re-announces it, nor asks the user to pick", async () => {
  const s = setup({ roster: achaneOut(), at: SUNDAY_8AM });
  await s.run();
  const id = s.store.actions[0]!.id;
  // Three drop-outs between 8 and 11, each followed by a whole read.
  s.espn.onRead = (n, r) => (n % 2 === 0 ? noSchedule(r) : withSchedule(r));
  const outcomes: string[] = [];
  for (let i = 0; i < 6; i++) {
    s.clock.advance(15);
    outcomes.push((await s.run()).outcome);
  }
  assert.deepEqual(outcomes, ["error", "ok", "error", "ok", "error", "ok"]);
  assert.equal(s.store.actions.find((a) => a.id === id)!.status, "pending", "the scheduled move stands");
  assert.deepEqual(s.store.actions.filter((a) => a.kind === "propose").length, 1, "and was not re-inserted");
  assert.equal(s.store.activity.length, 1, "said once, with no withdrawal and no 'not sure enough to pick one' in between");
  assert.equal(s.push.sent.length, 1);
  assert.equal(s.espn.writes.length, 0);
});

test("a pending proposal is kept when the engine downgrades its finding to a choice that still includes it", async () => {
  const s = setup({ roster: achaneOut(), authority: "ask_me", at: SUNDAY_8AM });
  await s.run();
  entry(s.espn.roster, WRIGHT).player.game = undefined; // only his kickoff is missing now
  s.clock.advance(15);
  const sum = await s.run();
  assert.equal(sum.outcome, "ok");
  assert.deepEqual(s.store.actions.map((a) => [a.kind, a.status]), [["propose", "pending"]]);
  assert.equal(s.store.activity.length, 1, "the proposal is still the right question, so nothing new is asked");
  // Approving it still works: Wright is among the options.
  assert.equal((await decideAction(s.deps, "user-1", s.store.actions[0]!.id, "approve")).ok, true);
});

test("a half payload with HTTP 200 is a failed read, not an alarm per starting slot", async () => {
  const empty = team();
  empty.entries = []; // roster.entries absent from ESPN's answer
  const s = setup({ roster: empty, at: SUNDAY_8AM });
  const sum = await s.run();
  assert.equal(sum.outcome, "error");
  assert.equal(s.store.activity.length, 0, "not seven 'Nobody is starting at ...'");
  assert.equal(s.store.checks.at(-1)!.patch.lastRoster, undefined);
  assert.equal(sum.nextCheckAt, "2026-10-04T12:05:00.000Z");

  const blank = team(); // entries present, player data absent: every status unknown, no kickoffs
  for (const e of blank.entries) {
    e.player.status = "unknown";
    e.player.game = undefined;
  }
  const t = setup({ roster: blank, at: SUNDAY_8AM });
  assert.equal((await t.run()).outcome, "error");
  assert.equal(t.store.activity.length, 0, "not seven 'injury status could not be read'");

  // The whole read that follows has nothing to add or withdraw.
  s.espn.roster = team();
  s.clock.advance(5);
  const next = await s.run();
  assert.deepEqual([next.outcome, next.findings, next.notified], ["ok", 0, 0]);
  assert.equal(s.store.activity.length, 0);
});

test("the third incomplete read in a row is said once; a whole read in between starts the count again", async () => {
  const s = setup({ roster: achaneOut(), at: SUNDAY_8AM });
  s.espn.onRead = (_n, r) => noSchedule(r);
  await s.run();
  s.clock.advance(5);
  await s.run();
  assert.equal(s.store.activity.length, 0, "one or two is ESPN's half payload");
  s.clock.advance(5);
  const third = await s.run();
  assert.equal(third.notified, 1);
  assert.deepEqual(
    s.store.activity.map((x) => [x.type, x.title]),
    [["STATUS_CHANGED", "ESPN's data looks incomplete"]],
  );
  assert.match(s.store.activity[0]!.body, /won't make a move on my own until a read looks right\. Check your lineup in the ESPN app for now\.$/);
  s.clock.advance(5);
  await s.run();
  s.clock.advance(5);
  await s.run();
  assert.equal(s.store.activity.length, 1, "said once");
  assert.equal(s.push.sent.length, 1);

  const t = setup({ roster: achaneOut(), at: SUNDAY_8AM });
  t.espn.onRead = (n, r) => (n === 3 ? withSchedule(r) : noSchedule(r));
  for (let i = 0; i < 5; i++) {
    await t.run();
    t.clock.advance(5);
  }
  assert.deepEqual(t.store.activity.map((x) => x.type), ["ACTION_RECOMMENDED"], "the whole read's proposal; no run of three");
});

test("a passing refusal on the read that verifies a write is not a failed write, a sign-out or a held week", async () => {
  const s = setup({ roster: achaneOut() });
  s.espn.onRead = (n) => {
    s.espn.read = n === 3 ? "auth" : "ok"; // ESPN's WAF, once, on the read after the write
  };
  const sum = await s.run();
  assert.equal(sum.outcome, "ok");
  assert.equal(sum.executed, 1);
  assert.equal(s.espn.reads, 4);
  assert.deepEqual(s.pauses, [3000]);
  assert.equal(s.store.actions[0]!.status, "done");
  assert.equal(s.store.connections.get("conn-1")!.status, "active");
  assert.deepEqual(s.store.activity.map((x) => x.type), ["ACTION_COMPLETED"]);
  assert.equal(await s.store.failedWrites("conn-1", 5), 0, "the rest of the week stays automatic");
});

test("a 5xx on the read that verifies a write is tried again before anything is called unconfirmed", async () => {
  const s = setup({ roster: achaneOut() });
  s.espn.onRead = (n) => {
    s.espn.read = n === 3 ? "error" : "ok";
  };
  const sum = await s.run();
  assert.equal(sum.executed, 1);
  assert.deepEqual(s.store.activity.map((x) => x.type), ["ACTION_COMPLETED"]);
  assert.equal(s.espn.writes.length, 1, "the write itself is never sent twice");
});

test("a read host that lags the write by a moment gets a second look before the write is called unconfirmed", async () => {
  const s = setup({ roster: achaneOut() });
  s.espn.onRead = (n, r) => {
    if (n < 3) return; // the check's read and the re-read before the write see the problem
    const lag = n === 3; // the first read after the write still shows the old lineup
    entry(r, ACHANE).slot = lag ? "RB" : "BENCH";
    entry(r, WRIGHT).slot = lag ? "BENCH" : "RB";
  };
  const sum = await s.run();
  assert.equal(sum.executed, 1);
  assert.equal(s.espn.reads, 4);
  assert.deepEqual(s.pauses, [3000]);
  assert.equal(s.store.actions[0]!.status, "done");
  assert.equal(s.espn.writes.length, 1);
});

test("the Saturday test swap's verifying read is patient in the same way", async () => {
  const s = setup({ at: "2026-10-03T18:00:00.000Z", conn: { writeVerifiedAt: null } });
  s.espn.onRead = (n) => {
    s.espn.read = n === 2 ? "auth" : "ok";
  };
  const r = await manualSwap(s.deps, "user-1", "conn-1", SHAHEED, WALKER);
  assert.equal(r.ok, true);
  assert.equal(s.store.connections.get("conn-1")!.writeVerifiedAt, "2026-10-03T18:00:00.000Z", "the proof is not lost to a passing 403");
  assert.equal(s.store.connections.get("conn-1")!.status, "active");
});

test("an automatic move the user undoes in the ESPN app is offered once for a tap, never made again, never silent", async () => {
  const s = setup({ roster: achaneOut() });
  assert.equal((await s.run()).executed, 1);
  entry(s.espn.roster, ACHANE).slot = "RB"; // undone by mistake in the ESPN app at T-40
  entry(s.espn.roster, WRIGHT).slot = "BENCH";
  s.clock.advance(5);
  const sum = await s.run();
  assert.deepEqual([sum.findings, sum.executed, sum.proposed], [1, 0, 1]);
  assert.equal(s.espn.writes.length, 1);
  assert.equal(s.store.activity.at(-1)!.body, "Start Jaylen Wright at RB instead? Tap to approve. I already made an automatic move for this, so this one is yours to approve.");
  for (let i = 0; i < 3; i++) {
    s.clock.advance(2);
    await s.run();
  }
  assert.equal(s.store.activity.length, 2, "said once");
  assert.equal(s.espn.writes.length, 1);
});

test("the retry after a failed read, and after a sign-out, sit on the minute boundary the cron tick lands on", async () => {
  const s = setup({ roster: achaneOut(), at: T - 45 * MIN + 800 }); // a check that started 800 ms after the tick
  s.espn.read = "error";
  assert.equal((await s.run()).nextCheckAt, new Date(T - 40 * MIN).toISOString(), "no roster to set a cadence by: 5 minutes, from the minute");

  const r = achaneOut();
  r.entries.push({ slot: "TE", player: { ...entry(r, SHAHEED).player, id: "9999" } });
  const u = setup({ roster: r, at: T - 45 * MIN + 800 });
  assert.equal((await u.run()).nextCheckAt, new Date(T - 43 * MIN).toISOString(), "an incomplete read's kickoffs still set the cadence: 2 minutes, from the minute");

  const t = setup({ roster: achaneOut(), at: T - 45 * MIN + 800 });
  t.espn.read = "auth";
  assert.equal((await t.run()).nextCheckAt, new Date(T - 40 * MIN).toISOString());
});
