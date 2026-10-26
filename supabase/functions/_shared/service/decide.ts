// Copied from packages/service/src/decide.ts by scripts/build-functions.ts. Edit the original.
// What the user does from the app: approve or decline a proposal (a bench move, AI Native's
// add, or a piece of Roster Advice), and the Saturday test swap. The user's tap is the
// authority here, so neither depends on the protection level or a claimed account. Both
// still re-read ESPN first and verify after; an add is also re-checked against the No-Cray
// Rules, where the tap waives only the Droppable switch and data ESPN did not send.

import { BENCH, IR, evaluate, isHole, isStarting, noCray, type Candidate, type Move, type Player, type Room, type Roster, type Settings, type Slot } from "@rosterbots/core";
import type { FantasyConnector } from "@rosterbots/connectors";
import {
  announce,
  connect,
  declinedHoles,
  errorText,
  failed,
  isSignedOut,
  keepRoster,
  leaveUnconfirmed,
  noteWrite,
  outsideHistory,
  readTeamPatiently,
  settingsFor,
  signature,
  signedOut,
  writeAndVerify,
  writeOutsideAndVerify,
} from "./ops.ts";
import { fillOf } from "./outside.ts";
import { summarizeRead } from "./read.ts";
import type { ActionRow, ActionStatus, ConnectionRow, DecisionResult, Deps, Store, SwapResult } from "./types.ts";
import { NOT_NEEDED, OUT_OF_DATE, PROVED, SIGN_IN_AGAIN, clock, failure, notPending, playersIn, receipt, shortName, slotName, type Lookup } from "./words.ts";

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

type Refusal = { status: ActionStatus; error: string; message: string };

/** Why a stored proposal can no longer be made on this roster, if it cannot. */
function invalid(moves: Move[], roster: Roster, now: Date): Refusal | undefined {
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

/**
 * Is the reason for this proposal still there? Its finding must still exist on the fresh
 * read and still have these exact moves as one of its fixes. Otherwise approving it could
 * bench a starter who has since been cleared, or start one who has since been ruled out.
 */
async function stillNeeded(store: Store, action: ActionRow, roster: Roster, now: Date, settings: Settings): Promise<Refusal | undefined> {
  // As the checker sees it: a hole the user declined does not hold on to its bench player.
  const first = evaluate(roster, now, settings);
  const release = await declinedHoles(store, action.connectionId, first, roster.period);
  const found = release.size ? evaluate(roster, now, settings, release) : first;
  const f = found.find((x) => x.key === action.findingKey);
  if (!f) return { status: "superseded", error: "not_needed", message: NOT_NEEDED };
  const r = f.resolution;
  const fixes = r.type === "deterministic" ? [r.candidate] : r.type === "judgment" ? r.candidates : [];
  const sig = signature("propose", f.key, action.moves);
  if (!fixes.some((x) => signature("propose", f.key, x.moves) === sig)) return { status: "superseded", error: "stale", message: OUT_OF_DATE };
  return undefined;
}

/** How many free agents to read when looking for the one an approval names, among those who play his position. */
const FREE_AGENTS_TO_FIND = 150;

/** The slot a position's players are listed under, for the free-agent filter. */
const slotOfPosition = (position: string): Slot | undefined =>
  (({ QB: "QB", RB: "RB", WR: "WR", TE: "TE", K: "K", DST: "DST", "D/ST": "DST" }) as Record<string, Slot>)[position];

/**
 * An approved add, rebuilt on fresh reads: the free agent must still be free, the player
 * who makes room still where he was, the slot's own moves still possible, and the No-Cray
 * Rules still satisfied, the user's tap waiving only what a tap may waive.
 */
async function outsideCandidateFor(
  deps: Deps,
  espn: FantasyConnector,
  conn: ConnectionRow,
  action: ActionRow,
  fresh: Roster,
  now: Date,
  settings: Settings,
): Promise<{ candidate: Candidate; who: Lookup } | { refused: Refusal }> {
  const tx = action.transaction!;
  const stale = (message: string): { refused: Refusal } => ({ refused: { status: "superseded", error: "stale", message } });
  const positionSlot = slotOfPosition(tx.add.position);
  const fas = await espn.getFreeAgents(conn.leagueId, fresh.period, { ...(positionSlot ? { slots: [positionSlot] } : {}), limit: FREE_AGENTS_TO_FIND });
  const fa = fas.find((f) => f.player.id === tx.add.playerId);
  if (!fa) return stale(`${tx.add.name} is no longer a free agent, so this is out of date. Nothing was changed.`);
  if (fa.onWaivers) return stale(`${tx.add.name} is on waivers now, and RosterBots never makes waiver claims. Nothing was changed.`);
  const at = (id: string) => fresh.entries.find((e) => e.player.id === id);

  let room: Room;
  if (tx.room.how === "open") room = { how: "open" };
  else {
    const e = at(tx.room.playerId);
    if (!e || e.slot !== tx.room.from) return stale(`${tx.room.name} isn't where he was, so this is out of date. Nothing was changed.`);
    if (started(e.player, now)) return { refused: { status: "expired", error: "locked", message: `${shortName(e.player.name)}'s game has started, so ESPN won't let him move.` } };
    // The AI's word that his season is over (advice, from a web report) stands for the tap that takes it.
    const player = tx.room.how === "drop" && tx.room.outForSeason ? { ...e.player, outForSeason: true } : e.player;
    room = { how: tx.room.how, player, from: e.slot };
  }
  // The slot's own moves (the starter who sits) must still be possible; the add's are his to make.
  const own = action.moves.filter((m) => m.playerId !== tx.add.playerId);
  const bad = invalid(own, fresh, now);
  if (bad) return { refused: bad };

  const slot = action.moves.find((m) => m.playerId === tx.add.playerId)?.to ?? tx.add.to;
  const occupantId = own.find((m) => isStarting(m.from))?.playerId;
  const occupant = occupantId ? at(occupantId)?.player : undefined;
  const advice = action.findingKey.includes(":advice:");
  if (!advice) {
    // The hole must still be one: its starter still a hole, or still RosterBots' own fill; an empty slot still empty.
    if (occupant) {
      const fill = (await deps.store.doneExecutes(conn.id, fresh.period)).some((a) => a.findingKey === action.findingKey && fillOf(a)?.playerId === occupant.id);
      if (!isHole(occupant) && !fill) return { refused: { status: "superseded", error: "not_needed", message: NOT_NEEDED } };
    } else if (isStarting(slot) && fresh.entries.filter((e) => e.slot === slot).length >= fresh.starterSlots.filter((s) => s === slot).length) {
      return { refused: { status: "superseded", error: "not_needed", message: NOT_NEEDED } };
    }
  }
  const history = await outsideHistory(deps.store, conn.id, fresh.period);
  const v = noCray(
    { add: fa.player, room },
    { roster: fresh, settings, now, history, slot: advice ? BENCH : slot, baseline: 0, purpose: advice ? "advice" : "hole", ...(occupant ? { occupant } : {}) },
  );
  if (!v.ok && !v.waivable) return { refused: { status: "superseded", error: "not_allowed", message: `I can't make this one: ${v.why}. Nothing was changed.` } };

  const roster = playersIn(fresh);
  const who: Lookup = (id) => roster(id) ?? (id === fa.player.id ? fa.player : undefined);
  return { candidate: { player: fa.player, moves: action.moves, add: { to: tx.add.to, room } }, who };
}

/** Changes a pending action, or says why it cannot: someone answered it first. */
async function fromPending(store: Store, id: string, patch: Parameters<Store["updateAction"]>[1]): Promise<DecisionResult | undefined> {
  if (await store.updateAction(id, patch, "pending")) return undefined;
  const now = await store.getAction(id);
  return no("not_pending", notPending(now?.status ?? "superseded"));
}

export async function decideAction(deps: Deps, userId: string, actionId: string, decision: "approve" | "decline"): Promise<DecisionResult> {
  const { store } = deps;
  const now = deps.now();
  const action = await store.getAction(actionId);
  // Someone else's action is answered exactly like a missing one.
  if (!action || action.userId !== userId) return no("not_found", "That suggestion isn't there any more.");
  if (action.status !== "pending") return no("not_pending", notPending(action.status));

  if (decision === "decline") {
    const lost = await fromPending(store, action.id, { status: "declined", decidedAt: now.toISOString() });
    return lost ?? { ok: true, status: "declined", message: "Okay. I'll leave your lineup as it is." };
  }

  const approvable = (action.kind === "propose" || action.kind === "advise") && (action.moves.length > 0 || !!action.transaction);
  if (!approvable) return no("not_approvable", "There's no change to approve here.");
  if (action.deadline !== null && Date.parse(action.deadline) <= now.getTime()) {
    await store.updateAction(action.id, { status: "expired" }, "pending");
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
    const fresh = await readTeamPatiently(deps, espn, conn);
    who = playersIn(fresh);
    const at = deps.now();
    const settings = await settingsFor(deps, conn);
    let candidate: Candidate | undefined;
    let refused: Refusal | undefined;
    if (action.transaction) {
      const r = await outsideCandidateFor(deps, espn, conn, action, fresh, at, settings);
      if ("refused" in r) refused = r.refused;
      else {
        candidate = r.candidate;
        who = r.who;
      }
    } else {
      refused = invalid(action.moves, fresh, at) ?? (await stillNeeded(store, action, fresh, at, settings));
    }
    if (refused) {
      const lost = await fromPending(store, action.id, { status: refused.status });
      // The lineup moved on since the last check; Home should show it as it is.
      await keepRoster(deps, conn, fresh, at);
      return lost ?? no(refused.error, refused.message);
    }

    // The checker may have acted on this proposal while ESPN was read: only one of us writes.
    const lost = await fromPending(store, action.id, { status: "approved", decidedAt: at.toISOString() });
    if (lost) return lost;
    wrote = true;
    const out = candidate ? await writeOutsideAndVerify(deps, espn, conn, candidate, fresh.period) : await writeAndVerify(deps, espn, conn, action.moves, fresh.period);
    const moves = candidate ? (out as { moves: Move[] }).moves : action.moves;
    const stage = candidate ? (out as { stage: string }).stage : undefined;
    const done = deps.now();
    await keepRoster(deps, conn, out.after, done);
    if (!out.applied) {
      const result = stage ? { ...out.result, stage } : out.result;
      await failed(deps, conn, { ...action, moves: moves.length ? moves : action.moves }, who, out.after, result, done);
      return no("not_applied", failure(action.reason, moves.length ? moves : action.moves, who, out.after, action.deadline, done, action.transaction, stage as "ir" | "add" | "lineup" | "done" | undefined).body);
    }
    // A change ESPN shows is the proof Auto Protect waits for; the first one says so.
    const notice = receipt(action.reason, moves, who, done, conn.writeVerifiedAt ? undefined : PROVED, action.transaction);
    verified = notice.body;
    await noteWrite(deps, conn, done);
    await store.updateAction(action.id, { status: "done", executedAt: done.toISOString(), result: out.result }, "approved");
    await announce(deps, conn, notice, { actionId: action.id, findingKey: action.findingKey, moves, ...(action.transaction ? { transaction: action.transaction } : {}) });
    return { ok: true, status: "done", message: notice.body };
  } catch (e) {
    // ESPN shows the change: it happened, whatever went wrong recording it.
    if (verified !== undefined) return { ok: true, status: "done", message: verified };
    try {
      // Asked ESPN but could not read back: still in flight, and never sent again. The next
      // check reads ESPN and says whether it landed (protect settle()).
      if (wrote) await leaveUnconfirmed(deps, action, e);
      if (isSignedOut(e)) {
        await signedOut(deps, conn, now, e);
        return no("needs_reauth", wrote ? "I asked ESPN for the change but couldn't check it: ESPN signed RosterBots out. Check your lineup in the ESPN app, then sign in again." : SIGN_IN_AGAIN);
      }
    } catch {
      // The store is failing too; the answer below is still true.
    }
    return wrote
      ? no("error", "I asked ESPN for the change but couldn't read your team back to check it. I'll look again on the next check and tell you whether it went through.")
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
    const roster = await readTeamPatiently(deps, espn, conn);
    who = playersIn(roster);
    const now = deps.now();
    const a = roster.entries.find((e) => e.player.id === playerIdA);
    const b = roster.entries.find((e) => e.player.id === playerIdB);
    if (!a || !b) return no("not_on_team", "Both players have to be on your team.");
    for (const e of [a, b]) {
      if (started(e.player, now)) return no("locked", `${shortName(e.player.name)}'s game has started, so ESPN won't let him move.`);
    }
    if (a.slot === b.slot) return no("same_slot", "Those two are in the same slot, so swapping them changes nothing.");
    // IR moves are not part of the test swap.
    if (a.slot === IR || b.slot === IR) return no("ir", "IR moves aren't part of the test swap. Pick two players who aren't on IR.");
    for (const [x, y] of [[a, b], [b, a]] as const) {
      if (!x.player.eligibleSlots.includes(y.slot)) return no("not_eligible", `${shortName(x.player.name)} can't play ${slotName(y.slot)}.`);
    }

    moves = [
      { playerId: a.player.id, from: a.slot, to: b.slot },
      { playerId: b.player.id, from: b.slot, to: a.slot },
    ];
    const out = await writeAndVerify(deps, espn, conn, moves, roster.period);
    const done = deps.now();
    await keepRoster(deps, conn, out.after, done);
    if (!out.applied) {
      // ESPN's write did not work here, so automatic moves wait for one that does.
      await noteWrite(deps, conn, null);
      const notice = failure(null, moves, who, out.after, null, done);
      await announce(deps, conn, notice, { moves, result: out.result });
      return no("not_applied", notice.body);
    }
    // The proof automatic moves wait for before the first one here; the first one says so.
    const notice = receipt(null, moves, who, done, conn.writeVerifiedAt ? undefined : PROVED);
    verified = { ok: true, message: notice.body, after: summarizeRead(out.after, done) };
    await noteWrite(deps, conn, done);
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
      return no("needs_reauth", wrote ? "I asked ESPN for the swap but couldn't check it: ESPN signed RosterBots out. Check your lineup in the ESPN app, then sign in again." : SIGN_IN_AGAIN);
    }
    return wrote
      ? no("error", "I asked ESPN for the swap but couldn't read your team back to check it. Check your lineup in the ESPN app.")
      : no("error", "I couldn't read your team from ESPN just now. Nothing was changed. Try again in a minute.");
  }
}
