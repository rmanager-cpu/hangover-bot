// decideAction and manualSwap: the user's own taps. The tap is the authority, but
// ESPN is still re-read first and verified after.
import { test } from "node:test";
import assert from "node:assert/strict";
import { decideAction, manualSwap } from "../src/index.ts";
import { ACHANE, BIJAN, DELL, HURTS, KICKOFF, MIN, SHAHEED, SUNDAY_8AM, T, WALKER, WRIGHT, achaneOut, entry, setup, team } from "./fakes.ts";

/** An Ask Me proposal sitting in the store at 8 AM Sunday, for an account nobody has claimed. */
async function proposed(over: Parameters<typeof setup>[0] = {}) {
  const s = setup({ roster: achaneOut(), authority: "ask_me", claimed: false, at: SUNDAY_8AM, ...over });
  await s.run();
  const action = s.store.actions[0]!;
  assert.equal(action.status, "pending");
  s.espn.reads = 0;
  return { ...s, id: action.id };
}

// ---- approve

test("approving re-reads, writes, verifies and receipts, with no claimed account needed", async () => {
  const s = await proposed();
  s.clock.advance(7);
  const r = await decideAction(s.deps, "user-1", s.id, "approve");
  assert.deepEqual(r, {
    ok: true,
    status: "done",
    message: "Achane was ruled OUT. Moved Jaylen Wright from bench to RB. Achane is on your bench. Done at 8:07 AM ET.",
  });
  assert.equal(s.espn.reads, 2, "a fresh read before, and the read that verifies");
  assert.deepEqual(s.espn.writes.map((w) => w.moves), [s.store.actions[0]!.moves]);
  const a = s.store.actions[0]!;
  assert.equal(a.status, "done");
  assert.equal(a.decidedAt, "2026-10-04T12:07:00.000Z");
  assert.equal(a.executedAt, "2026-10-04T12:07:00.000Z");
  assert.deepEqual(s.store.activity.map((x) => x.type), ["ACTION_RECOMMENDED", "ACTION_COMPLETED"]);
  assert.equal(await s.store.autoMovesSince("conn-1", "2026-10-04T00:00:00.000Z"), 0, "an approved move is not an automatic one");
});

test("approval refuses when a player has moved since, and retires the suggestion", async () => {
  const s = await proposed();
  entry(s.espn.roster, ACHANE).slot = "BENCH"; // the user benched him in the ESPN app
  const r = await decideAction(s.deps, "user-1", s.id, "approve");
  assert.deepEqual(r, {
    ok: false,
    error: "stale",
    message: "Achane isn't at RB any more, so this suggestion is out of date. I'll look again on the next check.",
  });
  assert.equal(s.espn.writes.length, 0);
  assert.equal(s.store.actions[0]!.status, "superseded");
});

test("approval refuses when a player is locked, and expires the suggestion", async () => {
  const s = await proposed();
  entry(s.espn.roster, WRIGHT).player.locked = true;
  const r = await decideAction(s.deps, "user-1", s.id, "approve");
  assert.deepEqual(r, { ok: false, error: "locked", message: "Wright's game has started, so ESPN won't let him move." });
  assert.equal(s.espn.writes.length, 0);
  assert.equal(s.store.actions[0]!.status, "expired");
});

test("approval refuses when a player has left the roster", async () => {
  const s = await proposed();
  s.espn.roster.entries = s.espn.roster.entries.filter((e) => e.player.id !== WRIGHT);
  const r = await decideAction(s.deps, "user-1", s.id, "approve");
  assert.equal(r.ok, false);
  assert.equal(!r.ok && r.error, "stale");
  assert.equal(s.espn.writes.length, 0);
});

test("approval refuses a move that would overfill a slot the user has since filled", async () => {
  const r0 = team();
  r0.entries = r0.entries.filter((e) => e.player.id !== ACHANE); // an empty RB slot
  const s = await proposed({ roster: r0 });
  assert.equal(s.store.actions[0]!.summary, "Start Jaylen Wright at RB");
  // The user fills it from the FLEX in ESPN, and the FLEX is now empty instead.
  entry(s.espn.roster, WALKER).slot = "RB";
  const r = await decideAction(s.deps, "user-1", s.id, "approve");
  assert.equal(!r.ok && r.error, "stale");
  assert.equal(s.espn.writes.length, 0);
});

test("approval after the deadline expires it without touching ESPN", async () => {
  const s = await proposed();
  s.clock.set(T + MIN);
  const r = await decideAction(s.deps, "user-1", s.id, "approve");
  assert.deepEqual(r, { ok: false, error: "expired", message: "Too late: this one expired at 1:00 PM ET." });
  assert.equal(s.espn.reads, 0);
  assert.equal(s.store.actions[0]!.status, "expired");
});

test("an approved write ESPN does not apply is failed and told", async () => {
  const s = await proposed();
  s.espn.write = "ignore";
  const r = await decideAction(s.deps, "user-1", s.id, "approve");
  assert.equal(r.ok, false);
  assert.equal(!r.ok && r.error, "not_applied");
  assert.match(!r.ok ? r.message : "", /ESPN now shows Achane at RB and Wright on your bench\. Fix it in the ESPN app before 1:00 PM ET\.$/);
  assert.equal(s.store.actions[0]!.status, "failed");
  assert.equal(s.store.activity.at(-1)!.type, "ACTION_FAILED");
});

test("approval while signed out of ESPN leaves the suggestion waiting and asks for a sign-in", async () => {
  const s = await proposed();
  s.espn.read = "auth";
  const r = await decideAction(s.deps, "user-1", s.id, "approve");
  assert.deepEqual(r, { ok: false, error: "needs_reauth", message: "ESPN signed RosterBots out. Sign in to ESPN again, then try once more." });
  assert.equal(s.store.actions[0]!.status, "pending");
  assert.equal(s.store.connections.get("conn-1")!.status, "needs_reauth");
  assert.equal(s.store.activity.at(-1)!.title, "Sign in to ESPN again");
});

test("an action that is not the user's is answered as if it did not exist", async () => {
  const s = await proposed();
  const r = await decideAction(s.deps, "someone-else", s.id, "approve");
  assert.deepEqual(r, { ok: false, error: "not_found", message: "That suggestion isn't there any more." });
  assert.deepEqual(await decideAction(s.deps, "user-1", "act-404", "approve"), r);
  assert.equal(s.store.actions[0]!.status, "pending");
  assert.equal(s.espn.reads, 0);
});

test("only a pending action can be decided", async () => {
  const s = await proposed();
  await decideAction(s.deps, "user-1", s.id, "approve");
  const again = await decideAction(s.deps, "user-1", s.id, "approve");
  assert.deepEqual(again, { ok: false, error: "not_pending", message: "That's already done." });
  assert.equal(s.espn.writes.length, 1);
});

test("a notification is not something to approve", async () => {
  const s = setup({ roster: achaneOut(), authority: "alerts" });
  await s.run();
  const id = s.store.actions[0]!.id;
  assert.equal((await decideAction(s.deps, "user-1", id, "approve")).ok, false);
});

// ---- decline

test("declining records the decision and touches nothing", async () => {
  const s = await proposed();
  s.clock.advance(3);
  const r = await decideAction(s.deps, "user-1", s.id, "decline");
  assert.deepEqual(r, { ok: true, status: "declined", message: "Okay. I'll leave your lineup as it is." });
  assert.equal(s.store.actions[0]!.status, "declined");
  assert.equal(s.store.actions[0]!.decidedAt, "2026-10-04T12:03:00.000Z");
  assert.equal(s.espn.reads, 0);
  assert.equal(s.espn.writes.length, 0);
  assert.deepEqual(await decideAction(s.deps, "user-1", s.id, "approve"), {
    ok: false, error: "not_pending", message: "You already turned that one down.",
  });
});

// ---- the Saturday test swap

const SATURDAY = "2026-10-03T18:00:00.000Z";

test("a test swap writes both moves, verifies them and receipts", async () => {
  const s = setup({ at: SATURDAY });
  const r = await manualSwap(s.deps, "user-1", "conn-1", WRIGHT, WALKER);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.message, "Moved Jaylen Wright from bench to FLEX. Walker is on your bench. Done at 2:00 PM ET.");
  assert.deepEqual(s.espn.writes, [{
    period: 5,
    moves: [
      { playerId: WRIGHT, from: "BENCH", to: "FLEX" },
      { playerId: WALKER, from: "FLEX", to: "BENCH" },
    ],
  }]);
  assert.equal(r.after.players.find((p) => p.id === WRIGHT)!.slot, "FLEX");
  assert.equal(r.after.players.find((p) => p.id === WALKER)!.slot, "BENCH");
  assert.deepEqual(s.store.activity.map((x) => [x.type, x.title]), [["ACTION_COMPLETED", "Jaylen Wright is in at FLEX"]]);
  assert.equal(s.push.sent.length, 1, "the test swap also proves a push reaches the phone");
  assert.equal(s.store.actions.length, 0, "a user's own swap is not an automatic move and does not count against the day");
});

test("a swap between two starters names both moves", async () => {
  const s = setup({ at: SATURDAY });
  const r = await manualSwap(s.deps, "user-1", "conn-1", BIJAN, WALKER);
  assert.equal(r.ok && r.message, "Moved Bijan Robinson from RB to FLEX. Moved Kenneth Walker III from FLEX to RB. Done at 2:00 PM ET.");
});

test("a test swap checks everything before it writes", async () => {
  const s = setup({ at: SATURDAY });
  const swap = (a: string, b: string, user = "user-1", conn = "conn-1") => manualSwap(s.deps, user, conn, a, b);
  const err = async (p: ReturnType<typeof swap>) => {
    const r = await p;
    return r.ok ? "ok" : `${r.error}: ${r.message}`;
  };

  assert.equal(await err(swap(WRIGHT, WALKER, "someone-else")), "not_found: That league isn't connected to your account.");
  assert.equal(await err(swap(WRIGHT, WALKER, "user-1", "conn-404")), "not_found: That league isn't connected to your account.");
  assert.equal(await err(swap(WRIGHT, WRIGHT)), "same_player: Pick two different players.");
  assert.equal(await err(swap(WRIGHT, "123")), "not_on_team: Both players have to be on your team.");
  assert.equal(await err(swap(WRIGHT, SHAHEED)), "same_slot: Those two are in the same slot, so swapping them changes nothing.");
  assert.equal(await err(swap(WRIGHT, HURTS)), "not_eligible: Wright can't play QB.");
  assert.equal(await err(swap(HURTS, WRIGHT)), "not_eligible: Wright can't play QB.", "checked both ways");
  assert.equal(await err(swap(SHAHEED, DELL)), "ir: IR moves aren't part of the beta. Pick two players who aren't on IR.");

  entry(s.espn.roster, WALKER).player.locked = true;
  assert.equal(await err(swap(WRIGHT, WALKER)), "locked: Walker's game has started, so ESPN won't let him move.");
  entry(s.espn.roster, WALKER).player.locked = false;
  s.clock.set(T + MIN); // Wright's 1:00 game is under way even if ESPN has not locked him yet
  assert.equal(await err(swap(WRIGHT, WALKER)), "locked: Wright's game has started, so ESPN won't let him move.");

  assert.equal(s.espn.writes.length, 0);
});

test("a test swap ESPN does not apply is reported, not claimed", async () => {
  const s = setup({ at: SATURDAY });
  s.espn.write = "ignore";
  const r = await manualSwap(s.deps, "user-1", "conn-1", WRIGHT, WALKER);
  assert.equal(r.ok, false);
  assert.equal(!r.ok && r.error, "not_applied");
  assert.equal(
    !r.ok && r.message,
    "I asked ESPN to start Jaylen Wright at FLEX, but it didn't go through, and I won't try it again on my own. " +
      "ESPN now shows Wright on your bench and Walker at FLEX. Check your lineup in the ESPN app.",
  );
  assert.equal(s.store.activity.at(-1)!.type, "ACTION_FAILED");
});

test("a test swap while signed out asks for a sign-in and writes nothing", async () => {
  const s = setup({ at: SATURDAY });
  s.espn.read = "auth";
  const r = await manualSwap(s.deps, "user-1", "conn-1", WRIGHT, WALKER);
  assert.equal(!r.ok && r.error, "needs_reauth");
  assert.equal(s.espn.writes.length, 0);
  assert.equal(s.store.connections.get("conn-1")!.status, "needs_reauth");
});

test("a D/ST keeps its negative id through a swap", async () => {
  const r0 = team();
  r0.entries.push({ slot: "BENCH", player: { ...entry(r0, "-16016").player, id: "-16020", name: "Dolphins D/ST", proTeam: "MIA", game: { kickoff: KICKOFF } } });
  const s = setup({ roster: r0, at: SATURDAY });
  const r = await manualSwap(s.deps, "user-1", "conn-1", "-16016", "-16020");
  assert.equal(r.ok && r.message, "Moved Dolphins D/ST from bench to D/ST. Vikings D/ST is on your bench. Done at 2:00 PM ET.");
});

test("a verified move stays done even if recording the receipt fails", async () => {
  const s = await proposed();
  s.store.addActivity = async () => {
    throw new Error("database unavailable");
  };
  const r = await decideAction(s.deps, "user-1", s.id, "approve");
  assert.equal(r.ok && r.status, "done");
  assert.equal(s.store.actions[0]!.status, "done", "not marked failed: ESPN shows it");

  const swap = setup({ at: SATURDAY });
  swap.store.addActivity = s.store.addActivity;
  const r2 = await manualSwap(swap.deps, "user-1", "conn-1", WRIGHT, WALKER);
  assert.equal(r2.ok, true);
});

// ---- Home reads the saved roster, so the user's own taps keep it current

const slotIn = (r: { roster: { entries: { player: { id: string }; slot: string }[] } } | undefined, id: string) =>
  r?.roster.entries.find((e) => e.player.id === id)?.slot;

test("an approval and a test swap save the read that verified them", async () => {
  const s = await proposed();
  s.clock.advance(7);
  await decideAction(s.deps, "user-1", s.id, "approve");
  assert.equal(s.store.rosters.length, 1);
  assert.equal(s.store.rosters[0]!.readAt, "2026-10-04T12:07:00.000Z");
  assert.equal(slotIn(s.store.rosters[0], WRIGHT), "RB");
  assert.equal(slotIn(s.store.rosters[0], ACHANE), "BENCH");

  const swap = setup({ at: SATURDAY });
  await manualSwap(swap.deps, "user-1", "conn-1", WRIGHT, WALKER);
  assert.equal(slotIn(swap.store.rosters.at(-1), WRIGHT), "FLEX");
  assert.equal(swap.store.checks.length, 0, "the check schedule is the checker's");
});

test("a write ESPN did not apply, and a stale approval, save what ESPN shows now", async () => {
  const s = await proposed();
  s.espn.write = "ignore";
  await decideAction(s.deps, "user-1", s.id, "approve");
  assert.equal(slotIn(s.store.rosters.at(-1), ACHANE), "RB");

  const t = await proposed();
  entry(t.espn.roster, ACHANE).slot = "BENCH";
  entry(t.espn.roster, WRIGHT).slot = "RB";
  await decideAction(t.deps, "user-1", t.id, "approve");
  assert.equal(slotIn(t.store.rosters.at(-1), WRIGHT), "RB", "the user fixed it in the ESPN app; Home should say so");
});

test("failing to save the roster changes nothing the user is told", async () => {
  const s = await proposed();
  s.store.failRosters = true;
  const r = await decideAction(s.deps, "user-1", s.id, "approve");
  assert.equal(r.ok && r.status, "done");
  assert.deepEqual(s.store.activity.map((x) => x.type), ["ACTION_RECOMMENDED", "ACTION_COMPLETED"]);

  const swap = setup({ at: SATURDAY });
  swap.store.failRosters = true;
  assert.equal((await manualSwap(swap.deps, "user-1", "conn-1", WRIGHT, WALKER)).ok, true);
});
