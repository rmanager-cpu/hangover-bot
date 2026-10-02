// protectConnection against fakes: Sunday automation inside its guardrails, and
// everything that must stop it. docs/BETA.md "The automation rule" is the spec.
import { test } from "node:test";
import assert from "node:assert/strict";
import { decideAction } from "../src/index.ts";
import {
  ACHANE, BIJAN, KICKOFF, LATE, MIN, SHAHEED, SUNDAY_8AM, T, WALKER, WRIGHT,
  achaneOut, entry, setup, team,
} from "./fakes.ts";

const SWAP = [
  { playerId: ACHANE, from: "RB", to: "BENCH" },
  { playerId: WRIGHT, from: "BENCH", to: "RB" },
];

// ---- the automatic move

test("a starter ruled OUT inside T-90..T-10 is replaced automatically, verified and receipted", async () => {
  const s = setup({ roster: achaneOut(), at: T - 45 * MIN });
  const sum = await s.run();

  assert.deepEqual(
    { outcome: sum.outcome, findings: sum.findings, executed: sum.executed, proposed: sum.proposed, notified: sum.notified },
    { outcome: "ok", findings: 1, executed: 1, proposed: 0, notified: 0 },
  );
  assert.deepEqual(s.espn.writes, [{ moves: SWAP, period: 5 }]);
  assert.equal(s.espn.reads, 3, "the check's read, the re-read before the write, the read that verifies it");
  assert.deepEqual(s.opened, [{ creds: { swid: "{TEST-SWID}", espnS2: "test-espn-s2" }, season: 2026 }]);

  assert.equal(s.store.actions.length, 1);
  const a = s.store.actions[0]!;
  assert.equal(a.kind, "execute");
  assert.equal(a.status, "done");
  assert.equal(a.executedAt, new Date(T - 45 * MIN).toISOString());
  assert.equal(a.summary, "Start Jaylen Wright at RB instead of De'Von Achane");
  assert.equal(a.reason, "Achane was ruled OUT");
  assert.equal(a.deadline, KICKOFF);
  assert.equal(a.findingKey, `5:starter_out:${ACHANE}`);

  assert.deepEqual(s.store.activity.map((x) => x.type), ["ACTION_COMPLETED"]);
  const receipt = s.store.activity[0]!;
  assert.equal(receipt.title, "Jaylen Wright is in at RB");
  assert.equal(receipt.body, "Achane was ruled OUT. Moved Jaylen Wright from bench to RB. Achane is on your bench. Done at 12:15 PM ET.");
  assert.equal(s.push.sent.length, 1);
  assert.deepEqual(s.push.sent[0]!.tokens, ["ExponentPushToken[pixel-8]"]);
  assert.equal(s.push.sent[0]!.msg.body, receipt.body);
  assert.deepEqual(s.push.sent[0]!.msg.data, { type: "ACTION_COMPLETED", connectionId: "conn-1", actionId: a.id });

  const saved = s.store.checks.at(-1)!.patch;
  assert.equal(entry(saved.lastRoster!, WRIGHT).slot, "RB", "the saved roster is the one read after the write");
  assert.equal(saved.nextCheckAt, new Date(T - 43 * MIN).toISOString(), "kickoff inside 100 minutes: every 2 minutes");
  assert.equal(sum.nextCheckAt, saved.nextCheckAt);
});

test("hours before kickoff it is a proposal that says when; at T-90 a later check supersedes it and acts", async () => {
  const s = setup({ roster: achaneOut(), at: SUNDAY_8AM });
  const early = await s.run();
  assert.equal(early.proposed, 1);
  assert.equal(s.espn.writes.length, 0);
  const proposal = s.store.actions[0]!;
  assert.deepEqual(
    { kind: proposal.kind, status: proposal.status, autoAt: proposal.autoAt, deadline: proposal.deadline, moves: proposal.moves },
    { kind: "propose", status: "pending", autoAt: "2026-10-04T15:30:00.000Z", deadline: KICKOFF, moves: SWAP },
  );
  const told = s.store.activity[0]!;
  assert.equal(told.type, "ACTION_RECOMMENDED");
  assert.equal(told.title, "Achane was ruled OUT");
  assert.equal(told.body, "Start Jaylen Wright at RB instead? Tap to approve. I'll do it automatically at 11:30 AM ET if you don't decide first.");
  assert.equal(early.nextCheckAt, "2026-10-04T12:15:00.000Z", "kickoff within 12 hours: every 15 minutes");

  s.clock.set(T - 90 * MIN);
  const later = await s.run();
  assert.equal(later.executed, 1);
  assert.equal(s.store.actions[0]!.status, "superseded");
  assert.equal(s.store.actions[1]!.kind, "execute");
  assert.equal(s.store.actions[1]!.status, "done");
  assert.deepEqual(s.espn.writes.map((w) => w.moves), [SWAP]);
  assert.deepEqual(s.store.activity.map((x) => x.type), ["ACTION_RECOMMENDED", "ACTION_COMPLETED"]);
  assert.match(s.store.activity[1]!.body, /Done at 11:30 AM ET\.$/);
});

test("after T-10 it is a proposal only, with no promise", async () => {
  const s = setup({ roster: achaneOut(), at: T - 9 * MIN });
  await s.run();
  assert.equal(s.espn.writes.length, 0);
  assert.equal(s.store.actions[0]!.autoAt, null);
  assert.equal(s.store.activity[0]!.body, "Start Jaylen Wright at RB instead? Tap to approve. It's too close to kickoff for me to do it on my own.");
});

test("AI Rescue is treated as Bench Protection: the same automatic move, no AI", async () => {
  const s = setup({ roster: achaneOut(), authority: "ai_rescue" });
  const sum = await s.run();
  assert.equal(sum.executed, 1);
  assert.deepEqual(s.espn.writes.map((w) => w.moves), [SWAP]);
});

test("AI Rescue with a questionable starter at T-60 asks the user; nothing consults AI", async () => {
  const r = team();
  entry(r, ACHANE).player.status = "questionable";
  const s = setup({ roster: r, authority: "ai_rescue", at: T - 60 * MIN });
  await s.run();
  assert.equal(s.espn.writes.length, 0);
  assert.deepEqual(s.store.actions.map((a) => [a.kind, a.status]), [["ask_user", "done"]]);
  const told = s.store.activity[0]!;
  assert.equal(told.type, "ACTION_REQUIRED");
  assert.equal(told.body, "He might play. Bench options at RB: Jaylen Wright. Your call before 1:00 PM ET: swap in the app or in ESPN.");
  assert.deepEqual(told.data?.candidates, [{ playerId: WRIGHT, name: "Jaylen Wright", moves: SWAP }]);
});

// ---- who never gets an automatic move

test("an anonymous account never gets an automatic move, anywhere in the window", async () => {
  for (const m of [90, 45, 10]) {
    const s = setup({ roster: achaneOut(), claimed: false, at: T - m * MIN });
    await s.run();
    assert.equal(s.espn.writes.length, 0, `T-${m}`);
    assert.deepEqual(s.store.actions.map((a) => [a.kind, a.status, a.autoAt]), [["propose", "pending", null]], `T-${m}`);
    assert.equal(
      s.store.activity[0]!.body,
      "Start Jaylen Wright at RB instead? Tap to approve. Claim your account in Settings and I can make moves like this on my own.",
    );
  }
});

test("Ask Me proposes, Alerts only tells, and bench swaps off holds Bench Protection back", async () => {
  const ask = setup({ roster: achaneOut(), authority: "ask_me" });
  await ask.run();
  assert.equal(ask.espn.writes.length, 0);
  assert.equal(ask.store.activity[0]!.body, "Start Jaylen Wright at RB instead? Tap to approve.");

  const alerts = setup({ roster: achaneOut(), authority: "alerts" });
  await alerts.run();
  assert.equal(alerts.espn.writes.length, 0);
  assert.deepEqual(alerts.store.actions.map((a) => [a.kind, a.status]), [["notify", "done"]]);
  assert.equal(alerts.store.activity[0]!.type, "ACTION_REQUIRED");
  assert.equal(alerts.store.activity[0]!.body, "Jaylen Wright is your best bench option at RB. You're on Alerts, so I haven't changed anything.");

  const off = setup({ roster: achaneOut(), conn: { benchSwaps: false } });
  await off.run();
  assert.equal(off.espn.writes.length, 0);
  assert.match(off.store.activity[0]!.body, /Bench swaps are off in your settings/);
});

// ---- the guardrails

test("the daily cap holds the fourth automatic move of the UTC day as a proposal", async () => {
  const s = setup({ roster: achaneOut() });
  for (const at of ["2026-10-04T00:05:00.000Z", "2026-10-04T13:00:00.000Z", "2026-10-04T15:40:00.000Z"]) s.store.seedExecute("conn-1", at);
  await s.run();
  assert.equal(s.espn.writes.length, 0);
  const p = s.store.actions.at(-1)!;
  assert.deepEqual([p.kind, p.status, p.autoAt], ["propose", "pending", null]);
  assert.equal(s.store.activity[0]!.body, "Start Jaylen Wright at RB instead? Tap to approve. I've already made today's limit of automatic moves.");
});

test("yesterday's automatic moves do not count against today", async () => {
  const s = setup({ roster: achaneOut() });
  for (let i = 0; i < 3; i++) s.store.seedExecute("conn-1", "2026-10-03T23:59:59.000Z");
  assert.equal((await s.run()).executed, 1);
});

test("the connection's own daily limit is the one used, and zero means never", async () => {
  const s = setup({ roster: achaneOut(), conn: { maxAutoMovesPerDay: 0 } });
  await s.run();
  assert.equal(s.espn.writes.length, 0);
  assert.match(s.store.activity[0]!.body, /today's limit/);
});

test("a read that does not look sane is never acted on", async () => {
  const r = achaneOut();
  // A starter in a slot this league does not have: a bad read, not a bad lineup.
  r.entries.push({ slot: "TE", player: { ...entry(r, SHAHEED).player, id: "9999" } });
  const s = setup({ roster: r });
  await s.run();
  assert.equal(s.espn.writes.length, 0);
  assert.equal(s.espn.reads, 1);
  assert.equal(s.store.activity[0]!.body, "Start Jaylen Wright at RB instead? Tap to approve. Something in ESPN's data looked off, so I won't do it on my own.");
});

test("a fresh read that no longer gives the same move stops the write: the user fixed it first", async () => {
  const s = setup({ roster: achaneOut() });
  s.espn.onRead = (n, r) => {
    if (n !== 2) return;
    entry(r, ACHANE).slot = "BENCH";
    entry(r, WRIGHT).slot = "RB";
  };
  const sum = await s.run();
  assert.equal(s.espn.writes.length, 0);
  assert.equal(s.store.actions.length, 0, "nothing to record: the problem is gone");
  assert.equal(sum.executed, 0);
  assert.equal(entry(s.store.checks.at(-1)!.patch.lastRoster!, WRIGHT).slot, "RB", "the newest read is the one saved");
});

test("a fresh read that turns odd before the write stops it", async () => {
  const s = setup({ roster: achaneOut() });
  s.espn.onRead = (n, r) => {
    if (n === 2) r.entries.push({ slot: "BENCH", player: { ...entry(r, WRIGHT).player } });
  };
  await s.run();
  assert.equal(s.espn.writes.length, 0);
});

test("with no schedule from ESPN nothing moves on its own: the user decides", async () => {
  const r = achaneOut();
  for (const e of r.entries) e.player.game = undefined;
  const s = setup({ roster: r });
  await s.run();
  assert.equal(s.espn.writes.length, 0);
  assert.deepEqual(s.store.actions.map((a) => a.kind), ["ask_user"]);
  assert.equal(
    s.store.activity[0]!.body,
    "Bench options at RB: Jaylen Wright. I'm not sure enough to pick one for you. Your call: swap in the app or in ESPN.",
  );
});

// ---- said once

test("the same proposal is announced once, however many checks see it", async () => {
  const s = setup({ roster: achaneOut(), at: SUNDAY_8AM });
  await s.run();
  s.clock.advance(15);
  await s.run();
  s.clock.advance(15);
  await s.run();
  assert.equal(s.store.actions.length, 1);
  assert.equal(s.store.activity.length, 1);
  assert.equal(s.push.sent.length, 1);
});

test("a heads-up, then a decision, each said once", async () => {
  const r = team();
  entry(r, ACHANE).player.status = "questionable";
  const s = setup({ roster: r, at: SUNDAY_8AM });
  await s.run();
  await s.run();
  assert.deepEqual(s.store.activity.map((x) => x.type), ["PREGAME_WARNING"]);
  assert.equal(s.store.activity[0]!.title, "Achane is questionable");
  assert.equal(s.store.activity[0]!.body, "He plays at 1:00 PM ET. News can change until inactives, so I'll look again at 11:20 AM ET.");

  s.clock.set(T - 99 * MIN);
  await s.run();
  await s.run();
  assert.deepEqual(s.store.activity.map((x) => x.type), ["PREGAME_WARNING", "ACTION_REQUIRED"]);
  assert.equal(s.espn.writes.length, 0, "a questionable starter is never moved automatically");
});

test("a proposal for the same finding with different moves supersedes the old one", async () => {
  const r = achaneOut();
  entry(r, SHAHEED).player.eligibleSlots = ["RB", "WR", "FLEX", "BENCH"];
  entry(r, SHAHEED).player.projection = 9; // ahead of Wright's 8.1
  const s = setup({ roster: r, authority: "ask_me", at: SUNDAY_8AM });
  await s.run();
  assert.match(s.store.actions[0]!.summary, /Rashid Shaheed/);

  s.espn.roster.entries.find((e) => e.player.id === SHAHEED)!.player.projection = 5;
  s.clock.advance(15);
  await s.run();
  assert.deepEqual(s.store.actions.map((a) => [a.status, a.summary]), [
    ["superseded", "Start Rashid Shaheed at RB instead of De'Von Achane"],
    ["pending", "Start Jaylen Wright at RB instead of De'Von Achane"],
  ]);
  assert.equal(s.store.activity.length, 2);
});

test("a promise of an automatic move that cannot be kept is said, once", async () => {
  const s = setup({ roster: achaneOut(), at: SUNDAY_8AM });
  await s.run();
  for (let i = 0; i < 3; i++) s.store.seedExecute("conn-1", "2026-10-04T13:00:00.000Z");

  s.clock.set(T - 90 * MIN);
  await s.run();
  assert.equal(s.espn.writes.length, 0);
  const props = s.store.actions.filter((a) => a.kind === "propose");
  assert.deepEqual(props.map((a) => [a.status, a.autoAt]), [["superseded", "2026-10-04T15:30:00.000Z"], ["pending", null]]);
  assert.equal(s.store.activity.at(-1)!.body, "Start Jaylen Wright at RB instead? Tap to approve. I've already made today's limit of automatic moves.");

  s.clock.advance(2);
  await s.run();
  assert.equal(s.store.activity.length, 2);
});

test("a declined proposal is never made automatically at T-90", async () => {
  const s = setup({ roster: achaneOut(), at: SUNDAY_8AM });
  await s.run();
  const id = s.store.actions[0]!.id;
  assert.deepEqual(await decideAction(s.deps, "user-1", id, "decline"), { ok: true, status: "declined", message: "Okay. I'll leave your lineup as it is." });

  s.clock.set(T - 90 * MIN);
  await s.run();
  assert.equal(s.espn.writes.length, 0);
  assert.equal(s.store.actions.length, 1);
  assert.equal(s.store.activity.length, 1, "and it is not offered again");
});

test("a proposal nobody answered is marked expired once its deadline passes", async () => {
  const r = achaneOut();
  entry(r, ACHANE).player.game = { kickoff: LATE }; // Achane at 4:25, Wright at 1:00: the deadline is 1:00
  const s = setup({ roster: r, authority: "ask_me", at: SUNDAY_8AM });
  await s.run();
  assert.equal(s.store.actions[0]!.deadline, KICKOFF);

  s.clock.set(T + 5 * MIN);
  entry(s.espn.roster, WRIGHT).player.locked = true;
  await s.run();
  assert.deepEqual(s.store.actions.map((a) => [a.kind, a.status]), [["propose", "expired"], ["notify", "done"]]);
  assert.equal(s.store.activity.at(-1)!.body, "Nobody on your bench can play RB. Fix it in the ESPN app before 4:25 PM ET.");
});

// ---- writes that do not land

test("a write ESPN does not apply is failed, told as ACTION_FAILED, and never retried", async () => {
  const s = setup({ roster: achaneOut() });
  s.espn.write = "ignore";
  const sum = await s.run();
  assert.equal(sum.outcome, "ok");
  assert.equal(sum.executed, 0);
  const a = s.store.actions[0]!;
  assert.equal(a.status, "failed");
  assert.deepEqual(a.result, { httpStatus: 409, detail: "" });
  const told = s.store.activity[0]!;
  assert.equal(told.type, "ACTION_FAILED");
  assert.equal(told.title, "Couldn't start Jaylen Wright at RB");
  assert.equal(
    told.body,
    "Achane was ruled OUT. I asked ESPN to start Jaylen Wright at RB, but it didn't go through, and I won't try it again on my own. " +
      "ESPN now shows Achane at RB and Wright on your bench. Fix it in the ESPN app before 1:00 PM ET.",
  );
  assert.equal(s.push.sent.length, 1);

  s.clock.advance(2);
  await s.run();
  s.clock.advance(2);
  await s.run();
  assert.equal(s.espn.writes.length, 1, "never retried");
  assert.equal(s.store.activity.length, 1, "and not re-announced");
  assert.equal(await s.store.autoMovesSince("conn-1", "2026-10-04T00:00:00.000Z"), 1, "a failed move counts against the day");
});

test("a partial write is failed and says what ESPN shows now", async () => {
  const s = setup({ roster: achaneOut() });
  s.espn.write = "partial";
  await s.run();
  assert.equal(s.store.actions[0]!.status, "failed");
  assert.match(s.store.activity[0]!.body, /ESPN now shows Achane on your bench and Wright on your bench\./);
});

test("a write that throws is still checked by a read, and failed when the read says so", async () => {
  const s = setup({ roster: achaneOut() });
  s.espn.write = "throw";
  await s.run();
  assert.equal(s.espn.reads, 3);
  assert.equal(s.store.actions[0]!.status, "failed");
  assert.deepEqual(s.store.actions[0]!.result, { httpStatus: 500, detail: "", error: "transaction (HTTP 500)" });
});

test("after a failed write, the next automatic move in the same check waits for a tap", async () => {
  const r = achaneOut();
  entry(r, WALKER).player.status = "out"; // FLEX, 4:25
  entry(r, WALKER).player.game = { kickoff: KICKOFF };
  const s = setup({ roster: r });
  s.espn.write = "ignore";
  await s.run();
  assert.equal(s.espn.writes.length, 1);
  assert.deepEqual(s.store.actions.map((a) => [a.kind, a.status]), [["execute", "failed"], ["propose", "pending"]]);
  assert.match(s.store.activity.at(-1)!.body, /An automatic move just failed, so this one is yours to approve\./);
});

// ---- signed out, and other failures

test("an AuthError marks the connection needs_reauth, says so once, and stops", async () => {
  const s = setup({ roster: achaneOut() });
  s.espn.read = "auth";
  const sum = await s.run();
  assert.equal(sum.outcome, "needs_reauth");
  assert.equal(sum.notified, 1);
  assert.equal(s.store.checks.at(-1)!.patch.status, "needs_reauth");
  assert.deepEqual(s.store.activity.map((x) => [x.type, x.title]), [["ACTION_REQUIRED", "Sign in to ESPN again"]]);
  assert.equal(s.store.activity[0]!.body, "ESPN signed HangoverBot out, so I can't watch Trust The Process right now. Open the app and sign in to ESPN again.");
  assert.equal(s.push.sent.length, 1);
  assert.equal(s.store.actions.length, 0);
  assert.equal(s.espn.writes.length, 0);

  s.clock.advance(60);
  await s.run();
  assert.equal(s.store.activity.length, 1, "not said again on the hourly retry");

  s.espn.read = "ok";
  s.clock.advance(60);
  const back = await s.run();
  assert.equal(back.outcome, "ok");
  assert.equal(s.store.connections.get("conn-1")!.status, "active", "a good read restores it");
});

test("missing credentials are a sign-in problem too", async () => {
  const s = setup({ roster: achaneOut() });
  s.store.creds.clear();
  assert.equal((await s.run()).outcome, "needs_reauth");
  assert.equal(s.espn.reads, 0);
  assert.equal(s.store.activity[0]!.title, "Sign in to ESPN again");
});

test("an ESPN account that manages a different team is never acted for", async () => {
  const r = achaneOut();
  r.teamId = "6";
  const s = setup({ roster: r });
  const sum = await s.run();
  assert.equal(sum.outcome, "needs_reauth");
  assert.equal(s.espn.writes.length, 0);
  assert.equal(
    s.store.activity[0]!.body,
    "The ESPN account you're signed in with doesn't manage Trust The Process. Sign in to ESPN again with the account that does.",
  );
});

test("any other failure is caught for that connection and retried soon; the next connection still runs", async () => {
  const bad = setup({ roster: achaneOut() });
  bad.espn.read = "error";
  const sum = await bad.run();
  assert.equal(sum.outcome, "error");
  assert.equal(sum.error, "roster (HTTP 503)");
  assert.equal(sum.nextCheckAt, new Date(T - 40 * MIN).toISOString(), "within 5 minutes");
  assert.equal(bad.store.checks.at(-1)!.patch.nextCheckAt, sum.nextCheckAt);

  const good = setup({ roster: achaneOut() });
  assert.equal((await good.run()).executed, 1);
});

test("a store that throws is an error outcome, not a crash", async () => {
  const s = setup({ roster: achaneOut() });
  s.store.actionsFor = async () => {
    throw new Error("database unavailable");
  };
  const sum = await s.run();
  assert.equal(sum.outcome, "error");
  assert.equal(sum.error, "database unavailable");
  assert.equal(s.espn.writes.length, 0);
});

test("an automatic move that lands but cannot be receipted is never written twice", async () => {
  const s = setup({ roster: achaneOut() });
  s.store.addActivity = async () => {
    throw new Error("database unavailable");
  };
  assert.equal((await s.run()).outcome, "error");
  s.clock.advance(2);
  await s.run();
  assert.equal(s.espn.writes.length, 1);
});

test("a push that fails does not fail the check, and the activity row stands", async () => {
  const s = setup({ roster: achaneOut() });
  s.push.fail = true;
  const sum = await s.run();
  assert.equal(sum.outcome, "ok");
  assert.equal(sum.executed, 1);
  assert.equal(s.store.activity.length, 1);
});

test("a paused connection is skipped without reading ESPN", async () => {
  const s = setup({ roster: achaneOut(), conn: { status: "paused" } });
  const sum = await s.run();
  assert.equal(sum.outcome, "skipped");
  assert.equal(s.espn.reads, 0);
  assert.equal(s.store.actions.length, 0);
  assert.equal(sum.nextCheckAt, new Date(T + 15 * MIN).toISOString());
});

test("a healthy lineup is a quiet check", async () => {
  const s = setup({ roster: team() });
  const sum = await s.run();
  assert.deepEqual({ ...sum, nextCheckAt: undefined }, {
    connectionId: "conn-1", outcome: "ok", findings: 0, executed: 0, proposed: 0, notified: 0, nextCheckAt: undefined,
  });
  assert.equal(s.store.activity.length, 0);
  assert.equal(s.espn.reads, 1);
  assert.equal(entry(s.store.checks.at(-1)!.patch.lastRoster!, BIJAN).slot, "RB");
});
