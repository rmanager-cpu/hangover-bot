// What the user does from the app: approve or decline a proposal, and the Saturday
// test swap. The user's tap is the authority here, so neither depends on Bench
// Protection or a claimed account. Both still re-read ESPN first and verify after.

import { IR, isStarting, type Move, type Player, type Roster, type Slot } from "@rosterbots/core";
import { announce, connect, errorText, failed, isSignedOut, keepRoster, readTeam, signedOut, writeAndVerify } from "./ops.ts";
import { summarizeRead } from "./read.ts";
import type { ActionStatus, DecisionResult, Deps, SwapResult } from "./types.ts";
import { SIGN_IN_AGAIN, clock, failure, notPending, playersIn, receipt, shortName, slotName, type Lookup } from "./words.ts";

const no = (error: string, message: string) => ({ ok: false as const, error, message });

const started = (p: Player, now: Date): boolean => p.locked || (p.game ? Date.parse(p.game.kickoff) <= now.getTime() : false);

/** Would these moves leave a starting slot with more players than the league allows? */
function overfills(roster: Roster, moves: Move[]): boolean {
  const count = new Map<Slot, number>();
  const bump = (s: Slot, n: number) => {
    if (isStarting(s)) count.set(s, (count.get(s) ?? 0) + n);
  };
  for (const e of roster.entries) bump(e.slot, 1);
  for (const m of moves) {
    bump(m.from, -1);
    bump(m.to, 1);
  }
  const room = new Map<Slot, number>();
  for (const s of roster.starterSlots) room.set(s, (room.get(s) ?? 0) + 1);
  for (const [s, n] of count) if (n > (room.get(s) ?? 0)) return true;
  return false;
}

/** Why a stored proposal can no longer be made on this roster, if it cannot. */
function invalid(moves: Move[], roster: Roster, now: Date): { status: ActionStatus; error: string; message: string } | undefined {
  const at = new Map(roster.entries.map((e) => [e.player.id, e]));
  for (const m of moves) {
    const e = at.get(m.playerId);
    if (!e) return { status: "superseded", error: "stale", message: "A player in this suggestion is no longer on your team, so it's out of date." };
    const who = shortName(e.player.name);
    if (started(e.player, now)) return { status: "expired", error: "locked", message: `${who}'s game has started, so ESPN won't let him move.` };
    if (e.slot !== m.from || !e.player.eligibleSlots.includes(m.to)) {
      return { status: "superseded", error: "stale", message: `${who} isn't at ${slotName(m.from)} any more, so this suggestion is out of date. I'll look again on the next check.` };
    }
  }
  if (overfills(roster, moves)) {
    return { status: "superseded", error: "stale", message: "Your lineup changed since this was suggested, so it's out of date. I'll look again on the next check." };
  }
  return undefined;
}

export async function decideAction(deps: Deps, userId: string, actionId: string, decision: "approve" | "decline"): Promise<DecisionResult> {
  const { store } = deps;
  const now = deps.now();
  const action = await store.getAction(actionId);
  // Someone else's action is answered exactly like a missing one.
  if (!action || action.userId !== userId) return no("not_found", "That suggestion isn't there any more.");
  if (action.status !== "pending") return no("not_pending", notPending(action.status));

  if (decision === "decline") {
    await store.updateAction(action.id, { status: "declined", decidedAt: now.toISOString() });
    return { ok: true, status: "declined", message: "Okay. I'll leave your lineup as it is." };
  }

  if (action.kind !== "propose" || !action.moves.length) return no("not_approvable", "There's no change to approve here.");
  if (action.deadline !== null && Date.parse(action.deadline) <= now.getTime()) {
    await store.updateAction(action.id, { status: "expired" });
    return no("expired", `Too late: this one expired at ${clock(action.deadline, now)}.`);
  }
  const conn = await store.getConnection(action.connectionId);
  if (!conn || conn.userId !== userId) return no("not_found", "That suggestion isn't there any more.");

  let wrote = false;
  let verified: string | undefined;
  let who: Lookup = playersIn();
  try {
    const espn = await connect(deps, conn);
    if (!espn) {
      await signedOut(deps, conn, now, null);
      return no("needs_reauth", SIGN_IN_AGAIN);
    }
    const fresh = await readTeam(espn, conn);
    who = playersIn(fresh);
    const at = deps.now();
    const bad = invalid(action.moves, fresh, at);
    if (bad) {
      await store.updateAction(action.id, { status: bad.status });
      // The lineup moved on since the last check; Home should show it as it is.
      await keepRoster(deps, conn, fresh, at);
      return no(bad.error, bad.message);
    }

    await store.updateAction(action.id, { status: "approved", decidedAt: at.toISOString() });
    wrote = true;
    const out = await writeAndVerify(espn, conn, action.moves, fresh.period);
    const done = deps.now();
    await keepRoster(deps, conn, out.after, done);
    if (!out.applied) {
      await failed(deps, conn, action, who, out.after, out.result, done);
      return no("not_applied", failure(action.reason, action.moves, who, out.after, action.deadline, done).body);
    }
    const notice = receipt(action.reason, action.moves, who, done);
    verified = notice.body;
    await store.updateAction(action.id, { status: "done", executedAt: done.toISOString(), result: out.result });
    await announce(deps, conn, notice, { actionId: action.id, findingKey: action.findingKey, moves: action.moves });
    return { ok: true, status: "done", message: notice.body };
  } catch (e) {
    // ESPN shows the change: it happened, whatever went wrong recording it.
    if (verified !== undefined) return { ok: true, status: "done", message: verified };
    try {
      // Asked ESPN but could not read back: unconfirmed is failed, and never retried.
      if (wrote) await failed(deps, conn, action, who, undefined, { error: errorText(e) }, deps.now());
      if (isSignedOut(e)) {
        await signedOut(deps, conn, now, e);
        return no("needs_reauth", wrote ? "I asked ESPN for the change but couldn't check it: ESPN signed HangoverBot out. Check your lineup in the ESPN app, then sign in again." : SIGN_IN_AGAIN);
      }
    } catch {
      // The store is failing too; the answer below is still true.
    }
    return wrote
      ? no("error", "I asked ESPN for the change but couldn't read your team back to check it. Check your lineup in the ESPN app.")
      : no("error", "I couldn't read your team from ESPN just now. Nothing was changed. Try again in a minute.");
  }
}

/** The Saturday test swap: any two of the user's players who can trade places. */
export async function manualSwap(deps: Deps, userId: string, connectionId: string, playerIdA: string, playerIdB: string): Promise<SwapResult> {
  const conn = await deps.store.getConnection(connectionId);
  if (!conn || conn.userId !== userId) return no("not_found", "That league isn't connected to your account.");
  if (playerIdA === playerIdB) return no("same_player", "Pick two different players.");

  let moves: Move[] = [];
  let verified: SwapResult | undefined;
  let who: Lookup = playersIn();
  try {
    const espn = await connect(deps, conn);
    if (!espn) {
      await signedOut(deps, conn, deps.now(), null);
      return no("needs_reauth", SIGN_IN_AGAIN);
    }
    const roster = await readTeam(espn, conn);
    who = playersIn(roster);
    const now = deps.now();
    const a = roster.entries.find((e) => e.player.id === playerIdA);
    const b = roster.entries.find((e) => e.player.id === playerIdB);
    if (!a || !b) return no("not_on_team", "Both players have to be on your team.");
    for (const e of [a, b]) {
      if (started(e.player, now)) return no("locked", `${shortName(e.player.name)}'s game has started, so ESPN won't let him move.`);
    }
    if (a.slot === b.slot) return no("same_slot", "Those two are in the same slot, so swapping them changes nothing.");
    // IR moves are not in the beta.
    if (a.slot === IR || b.slot === IR) return no("ir", "IR moves aren't part of the beta. Pick two players who aren't on IR.");
    for (const [x, y] of [[a, b], [b, a]] as const) {
      if (!x.player.eligibleSlots.includes(y.slot)) return no("not_eligible", `${shortName(x.player.name)} can't play ${slotName(y.slot)}.`);
    }

    moves = [
      { playerId: a.player.id, from: a.slot, to: b.slot },
      { playerId: b.player.id, from: b.slot, to: a.slot },
    ];
    const out = await writeAndVerify(espn, conn, moves, roster.period);
    const done = deps.now();
    await keepRoster(deps, conn, out.after, done);
    if (!out.applied) {
      const notice = failure(null, moves, who, out.after, null, done);
      await announce(deps, conn, notice, { moves, result: out.result });
      return no("not_applied", notice.body);
    }
    const notice = receipt(null, moves, who, done);
    verified = { ok: true, message: notice.body, after: summarizeRead(out.after, done) };
    await announce(deps, conn, notice, { moves, result: out.result });
    return verified;
  } catch (e) {
    // ESPN shows the swap: it happened, whatever went wrong recording it.
    if (verified) return verified;
    // Moves are set only once the write is under way, so a non-empty list means ESPN was asked.
    const wrote = moves.length > 0;
    try {
      if (wrote) await announce(deps, conn, failure(null, moves, who, undefined, null, deps.now()), { moves, result: { error: errorText(e) } });
      if (isSignedOut(e)) await signedOut(deps, conn, deps.now(), e);
    } catch {
      // The store is failing too; the answer below is still true.
    }
    if (isSignedOut(e)) {
      return no("needs_reauth", wrote ? "I asked ESPN for the swap but couldn't check it: ESPN signed HangoverBot out. Check your lineup in the ESPN app, then sign in again." : SIGN_IN_AGAIN);
    }
    return wrote
      ? no("error", "I asked ESPN for the swap but couldn't read your team back to check it. Check your lineup in the ESPN app.")
      : no("error", "I couldn't read your team from ESPN just now. Nothing was changed. Try again in a minute.");
  }
}
