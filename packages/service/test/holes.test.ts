// The Oct 4 review: every way a hole (a starter OUT, on bye or projected for zero) could
// still be left in the lineup inside the window without a tap, each as the scenario that
// left it there before the fix. Owner, Oct 4: "never a situation in which an injured player
// with a 0 projection is in your starting lineup. I don't want to have to approve it or not."
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Player, Roster, Slot } from "@rosterbots/core";
import { decideAction } from "../src/index.ts";
import { ACHANE, BIJAN, JEFFERSON, KICKOFF, LATE, MIN, SHAHEED, T, WALKER, WRIGHT, achaneOut, entry, setup, team } from "./fakes.ts";

const RB: Slot[] = ["RB", "RB/WR", "FLEX", "BENCH", "IR"];
const WR: Slot[] = ["WR", "RB/WR", "WR/TE", "FLEX", "BENCH", "IR"];
const at = (iso: string) => Date.parse(iso);
const moved = (s: ReturnType<typeof setup>) => s.espn.writes.map((w) => w.moves.map((m) => `${m.playerId}:${m.from}>${m.to}`).join(","));

function player(id: string, name: string, eligibleSlots: Slot[], over: Partial<Player> = {}): Player {
  return { id, name, position: eligibleSlots.includes("WR") ? "WR" : "RB", proTeam: "LAC", status: "active", eligibleSlots, projection: 10, game: { kickoff: LATE }, locked: false, ...over };
}

// ---- the window's edges

test("the T-4 check acts, though the function reads the clock a few hundred ms after the tick", async () => {
  const s = setup({ roster: achaneOut(), at: T - 4 * MIN + 400 });
  const sum = await s.run();
  assert.equal(sum.executed, 1);
  assert.deepEqual(moved(s), [`${ACHANE}:RB>BENCH,${WRIGHT}:BENCH>RB`]);
});

test("a read that fails inside T-10 is tried again the next minute, not in five", async () => {
  const s = setup({ at: T - 30 * MIN });
  await s.run(); // a whole read, saved
  s.clock.set(T - 8 * MIN);
  s.espn.read = "error";
  const sum = await s.run();
  assert.equal(sum.outcome, "error");
  assert.equal(sum.nextCheckAt, new Date(T - 7 * MIN).toISOString());
});

test("an ESPN refusal inside T-10 is tried again the next minute too", async () => {
  const s = setup({ at: T - 30 * MIN });
  await s.run();
  s.clock.set(T - 8 * MIN);
  s.espn.read = "auth";
  const sum = await s.run();
  assert.equal(sum.outcome, "needs_reauth");
  assert.equal(sum.nextCheckAt, new Date(T - 7 * MIN).toISOString());
});

// ---- a fix that was made, or undone

test("a fill undone in ESPN a minute after it was made is made again on the next check", async () => {
  const s = setup({ roster: achaneOut(), at: T - 5 * MIN });
  assert.equal((await s.run()).executed, 1);
  // The owner puts Achane back as a test.
  entry(s.espn.roster, ACHANE).slot = "RB";
  entry(s.espn.roster, WRIGHT).slot = "BENCH";
  s.clock.advance(1); // T-4
  assert.equal((await s.run()).executed, 1);
  assert.equal(s.espn.writes.length, 2);
  assert.equal(entry(s.espn.roster, WRIGHT).slot, "RB");
});

test("a fill ESPN made but could not be read back on is settled by the next read, not failed for the week", async () => {
  const s = setup({ roster: achaneOut() });
  // The check's own read is #1, the fresh read before the write #2, the two read-backs #3 and #4.
  s.espn.onRead = (n) => {
    s.espn.read = n === 3 || n === 4 ? "error" : "ok";
  };
  const first = await s.run();
  assert.equal(first.executed, 0);
  const row = s.store.actions.find((a) => a.kind === "execute")!;
  assert.equal(row.status, "approved", "neither done nor failed until a read says which");
  assert.deepEqual(row.result, { unconfirmed: true, error: "roster (HTTP 503)" });
  assert.equal(s.store.activity.filter((a) => a.type === "ACTION_FAILED").length, 0, "nobody is told a change failed that may well have landed");

  s.clock.advance(1);
  await s.run();
  assert.equal(row.status, "done");
  assert.deepEqual(s.store.activity.map((a) => [a.type, a.title]), [["ACTION_COMPLETED", "Jaylen Wright is in at RB"]]);
  assert.equal(await s.store.failedWrites("conn-1", 5), 0);

  // And the week is not held: undone in ESPN, it is made again.
  entry(s.espn.roster, ACHANE).slot = "RB";
  entry(s.espn.roster, WRIGHT).slot = "BENCH";
  s.clock.advance(1);
  assert.equal((await s.run()).executed, 1);
});

test("an approval ESPN could not be read back on stays in flight, and the next check settles it as proof", async () => {
  const s = setup({ roster: achaneOut(), at: "2026-10-04T12:00:00.000Z", conn: { writeVerifiedAt: null } });
  await s.run();
  const proposal = s.store.actions.find((a) => a.kind === "propose")!;
  s.espn.onRead = (n) => {
    s.espn.read = n === 3 || n === 4 ? "error" : "ok"; // #2 is decide's read; #3 and #4 the read-backs
  };
  const answer = await decideAction(s.deps, "user-1", proposal.id, "approve");
  assert.equal(answer.ok, false);
  assert.match(answer.ok ? "" : answer.message, /I'll look again on the next check/);
  assert.equal(proposal.status, "approved");

  s.espn.onRead = undefined;
  s.espn.read = "ok";
  s.clock.advance(2);
  await s.run();
  assert.equal(proposal.status, "done");
  assert.ok(s.store.connections.get("conn-1")!.writeVerifiedAt, "the user's own change, seen on ESPN, is the proof");
});

// ---- two holes at once

test("when the first fill changes the second hole's best route, the second is made on the new route in the same check", async () => {
  const r = team();
  r.entries = r.entries.filter((e) => e.player.id !== WALKER);
  const MCCONKEY = "4612826";
  const DOBBINS = "4241985";
  r.entries.push(
    { slot: "FLEX", player: player(MCCONKEY, "Ladd McConkey", WR, { projection: 11 }) },
    { slot: "BENCH", player: player(DOBBINS, "J.K. Dobbins", RB, { projection: 10 }) },
  );
  entry(r, JEFFERSON).player.status = "out";
  entry(r, JEFFERSON).player.game = { kickoff: "2026-10-04T20:05:00.000Z" };
  entry(r, ACHANE).player.status = "out";
  entry(r, ACHANE).player.game = { kickoff: LATE };
  entry(r, WRIGHT).player.projection = 7.5;
  entry(r, WRIGHT).player.game = { kickoff: LATE };
  entry(r, SHAHEED).player.projection = 8.2;
  entry(r, SHAHEED).player.game = { kickoff: LATE };
  const s = setup({ roster: r, at: "2026-10-04T19:30:00.000Z" });
  const sum = await s.run();
  assert.equal(sum.executed, 2);
  assert.deepEqual(moved(s), [
    `${JEFFERSON}:WR>BENCH,${MCCONKEY}:FLEX>WR,${DOBBINS}:BENCH>FLEX`,
    // Dobbins at FLEX can now slide to RB, so Shaheed (8.2) comes in rather than Wright (7.5).
    `${ACHANE}:RB>BENCH,${DOBBINS}:FLEX>RB,${SHAHEED}:BENCH>FLEX`,
  ]);
});

test("a hole the user declined does not keep its bench player from another hole", async () => {
  const r = team();
  entry(r, ACHANE).player.status = "out";
  entry(r, ACHANE).player.game = { kickoff: "2026-10-04T20:05:00.000Z" };
  entry(r, WALKER).player.status = "out"; // FLEX, 4:25
  entry(r, WRIGHT).player.game = { kickoff: LATE };
  entry(r, SHAHEED).player.projection = 0; // the only other FLEX option is not playing
  const s = setup({ roster: r, at: "2026-10-04T18:00:00.000Z" });
  await s.run();
  const achane = s.store.actions.find((a) => a.kind === "propose" && a.moves.some((m) => m.playerId === ACHANE))!;
  assert.equal((await decideAction(s.deps, "user-1", achane.id, "decline")).ok, true);

  s.clock.set(at("2026-10-04T19:00:00.000Z"));
  const sum = await s.run();
  assert.equal(sum.executed, 1);
  assert.deepEqual(moved(s), [`${WALKER}:FLEX>BENCH,${WRIGHT}:BENCH>FLEX`]);
  assert.equal(entry(s.espn.roster, ACHANE).slot, "RB", "the declined hole is left as the user chose");
});

// ---- the fill itself

test("a questionable bench player ESPN still projects fills a hole automatically", async () => {
  const r = achaneOut();
  entry(r, WRIGHT).player.status = "questionable";
  entry(r, SHAHEED).player.projection = 0; // else Walker slides to RB and the healthy Shaheed takes FLEX
  const s = setup({ roster: r });
  assert.equal((await s.run()).executed, 1);
  assert.deepEqual(moved(s), [`${ACHANE}:RB>BENCH,${WRIGHT}:BENCH>RB`]);
});

test("a promise of an automatic move that can no longer be kept is withdrawn and said, not left standing", async () => {
  const r = achaneOut();
  entry(r, SHAHEED).player.projection = 0;
  const s = setup({ roster: r, at: T - 120 * MIN });
  await s.run();
  const promised = s.store.actions[0]!;
  assert.equal(promised.autoAt, new Date(T - 90 * MIN).toISOString());
  // By the promised time Wright is questionable with no projection: a choice, not a move.
  entry(s.espn.roster, WRIGHT).player.status = "questionable";
  delete entry(s.espn.roster, WRIGHT).player.projection;
  s.clock.set(T - 90 * MIN);
  await s.run();
  assert.equal(s.espn.writes.length, 0);
  assert.equal(promised.status, "superseded");
  // Still one tap away: the same move, approvable, no longer promised.
  const again = s.store.actions.at(-1)!;
  assert.deepEqual([again.kind, again.status, again.autoAt, again.signature], ["propose", "pending", null, promised.signature]);
  assert.equal(s.store.activity.at(-1)!.type, "ACTION_RECOMMENDED");
  assert.match(s.store.activity.at(-1)!.body, /Tap to approve\. Something about this option has changed since I said I'd do it/);
  // Said once.
  s.clock.advance(2);
  await s.run();
  assert.equal(s.store.activity.filter((a) => a.type === "ACTION_RECOMMENDED").length, 2);
});

test("an approval that finishes while the checker reads ESPN is not written a second time", async () => {
  const s = setup({ roster: achaneOut(), at: T - 120 * MIN });
  await s.run();
  const proposal = s.store.actions[0]!;
  s.clock.set(T - 90 * MIN);
  // This check's own read is the next one; the one after is the fresh read before its write.
  // ESPN serves that fresh read, then the user's Approve runs to the end before the last look.
  const fresh = s.espn.reads + 2;
  const realRead = s.espn.getRoster.bind(s.espn);
  let approving = false;
  s.espn.getRoster = async (league: string) => {
    const r = await realRead(league);
    if (s.espn.reads === fresh && !approving) {
      approving = true;
      assert.equal((await decideAction(s.deps, "user-1", proposal.id, "approve")).ok, true);
    }
    return r;
  };
  await s.run();
  assert.equal(s.espn.writes.length, 1, "the user's own write only");
});

test("an unconfirmed write does not hold another hole in the same check", async () => {
  const r = achaneOut();
  entry(r, WALKER).player.status = "out";
  entry(r, WALKER).player.game = { kickoff: KICKOFF };
  const s = setup({ roster: r });
  // #1 the check's read; #2 the fresh read for the first fill; #3 and #4 its read-backs fail.
  s.espn.onRead = (n) => {
    s.espn.read = n === 3 || n === 4 ? "error" : "ok";
  };
  await s.run();
  assert.equal(s.espn.writes.length, 2);
  assert.equal(s.store.activity.filter((a) => /for the rest of the week/.test(a.body)).length, 0);
});

test("a doubtful bench player ESPN projects fills a hole even when an unprojected questionable one ranks above him", async () => {
  const r = achaneOut();
  entry(r, WRIGHT).player.status = "questionable";
  delete entry(r, WRIGHT).player.projection;
  entry(r, SHAHEED).player.projection = 0;
  r.entries.push({ slot: "BENCH", player: player("4999001", "Backup Back", RB, { status: "doubtful", projection: 5, game: { kickoff: KICKOFF } }) });
  const s = setup({ roster: r });
  assert.equal((await s.run()).executed, 1);
  assert.deepEqual(moved(s), [`${ACHANE}:RB>BENCH,4999001:BENCH>RB`]);
});

test("a refusal while approving never turns a paused league back on", async () => {
  const s = setup({ roster: achaneOut(), at: "2026-10-04T12:00:00.000Z" });
  await s.run();
  const proposal = s.store.actions[0]!;
  s.store.connections.get("conn-1")!.status = "paused";
  s.espn.read = "auth";
  await decideAction(s.deps, "user-1", proposal.id, "approve");
  assert.equal(s.store.connections.get("conn-1")!.status, "paused");
});

test("a starter who played Thursday and is now on IR does not stop Sunday's fills", async () => {
  const r: Roster = achaneOut();
  entry(r, BIJAN).player.status = "ir";
  entry(r, BIJAN).player.locked = true;
  entry(r, JEFFERSON).player.status = "out";
  entry(r, WALKER).player.status = "out";
  // Three holes not yet locked, one locked IR: three is a bad week, not a bad read.
  const s = setup({ roster: r });
  const sum = await s.run();
  assert.equal(sum.outcome, "ok");
  assert.ok(sum.executed >= 1);
});
