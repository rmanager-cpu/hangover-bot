// What protectConnection, decideAction and manualSwap share: reaching ESPN for one
// connection, writing and verifying, and telling the user.
//
// Never log a request to ESPN, its headers or a credential. Nothing here logs at
// all; errors carry HTTP statuses and connection ids, never cookies.

import { applied, DEFAULT_SETTINGS, IR, type Candidate, type Finding, type Move, type OutsideHistory, type Player, type Roster, type Settings } from "@rosterbots/core";
import { AuthError, ProviderError, type FantasyConnector } from "@rosterbots/connectors";
import { inMinutes, minuteWindow, nextCheckAt } from "./read.ts";
import type { ActionKind, ActionRow, ActivityType, ConnectionRow, Deps, Store, StoredTransaction } from "./types.ts";
import { failure, signIn, type Lookup } from "./words.ts";

/** How long before a second look when ESPN refuses a read: a WAF's passing block clears in seconds. */
export const RETRY_PAUSE_MS = 3_000;

/** How soon a connection waiting for a new sign-in is tried again: a passing refusal costs minutes, not the window. */
export const REAUTH_RETRY_MIN = 5;

/** The signed-in ESPN account manages a different team from the one this connection is for. */
export class WrongTeamError extends Error {
  readonly teamId: string;
  constructor(teamId: string) {
    super("the ESPN account manages team " + teamId + ", not this connection's team");
    this.teamId = teamId;
  }
}

/**
 * A read the checker must not judge a lineup by: half a payload, or one with no kickoff
 * times. Evaluating one says "nobody is starting" once per slot, or asks the user to pick
 * what the rules would have picked. It is a failed read: the next check, within minutes,
 * gets a whole one.
 */
export class IncompleteReadError extends Error {
  constructor(what: string) {
    super("ESPN's read looked incomplete: " + what);
  }
}

/** Only the user can fix these: sign in to ESPN again. */
export const isSignedOut = (e: unknown): boolean => e instanceof AuthError || e instanceof WrongTeamError;

export const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Waits before a second look at ESPN. Tests pass a `pause` that returns at once. */
export const pause = (deps: Deps, ms: number): Promise<void> =>
  (deps.pause ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms))))(ms);

/** Null when the credential is gone, which only signing in again can fix. */
export async function connect(deps: Deps, conn: ConnectionRow): Promise<FantasyConnector | null> {
  const creds = await deps.store.credentials(conn.credentialId);
  return creds ? deps.connector(creds, conn.season) : null;
}

export async function readTeam(espn: FantasyConnector, conn: ConnectionRow): Promise<Roster> {
  const roster = await espn.getRoster(conn.leagueId);
  // ESPN returns whichever team the cookies manage. Never act on one this connection was not set up for.
  if (conn.teamId !== null && roster.teamId !== conn.teamId) throw new WrongTeamError(roster.teamId);
  return roster;
}

/**
 * readTeam, with one more try after a short pause when ESPN refuses it. A single 401 or 403
 * can be a WAF's passing block; treating it as a sign-out would skip the kickoff window.
 */
export async function readTeamPatiently(deps: Deps, espn: FantasyConnector, conn: ConnectionRow): Promise<Roster> {
  try {
    return await readTeam(espn, conn);
  } catch (e) {
    if (!(e instanceof AuthError)) throw e;
    await pause(deps, RETRY_PAUSE_MS);
    return readTeam(espn, conn);
  }
}

/**
 * The read that checks a write. One more try after a pause on any failure: a passing
 * refusal, a timeout or a 5xx here is not news about the write, and calling the write
 * unconfirmed on its account holds every automatic move for the rest of the week. A wrong
 * team is not passing, so it is not tried again.
 */
async function readBack(deps: Deps, espn: FantasyConnector, conn: ConnectionRow): Promise<Roster> {
  try {
    return await readTeam(espn, conn);
  } catch (e) {
    if (e instanceof WrongTeamError) throw e;
    await pause(deps, RETRY_PAUSE_MS);
    return readTeam(espn, conn);
  }
}

/** The connection's settings as the engine reads them. */
export async function settingsFor(deps: Deps, conn: ConnectionRow): Promise<Settings> {
  // Alert Me is one option (owner, Oct 25): a stored alerts reads as ask_me, a push with a tap.
  const authority = conn.authority === "alerts" ? "ask_me" : conn.authority;
  // AI Native may add, drop and use IR, within the No-Cray Rules and the Droppable switches.
  const ai = authority === "ai_rescue";
  return {
    ...DEFAULT_SETTINGS,
    authority,
    accountClaimed: await deps.store.accountClaimed(conn.userId),
    permissions: { ...DEFAULT_SETTINGS.permissions, benchSwaps: conn.benchSwaps, freeAgentAdds: ai, drops: ai, irMoves: ai },
    replacementOrder: conn.replacementOrder ?? [],
    droppable: conn.droppable ?? [],
  };
}

/** A candidate's add and room, as the action row stores them. Null for a bench move. */
export function storedTransaction(c: Candidate): StoredTransaction | null {
  if (!c.add) return null;
  const r = c.add.room;
  return {
    add: { playerId: c.player.id, name: c.player.name, position: c.player.position, to: c.add.to },
    room:
      r.how === "open"
        ? { how: "open" }
        : { how: r.how, playerId: r.player.id, name: r.player.name, from: r.from, ...(r.how === "drop" && r.player.outForSeason ? { outForSeason: true } : {}) },
  };
}

/** The add itself landed: the player is on the roster, the drop is gone, the IR move was made. */
export function addLanded(tx: StoredTransaction, after: Roster): boolean {
  const at = (id: string) => after.entries.find((e) => e.player.id === id)?.slot;
  if (at(tx.add.playerId) === undefined) return false;
  if (tx.room.how === "drop" && at(tx.room.playerId) !== undefined) return false;
  if (tx.room.how === "ir" && at(tx.room.playerId) !== IR) return false;
  return true;
}

/** Did the write land, transaction included: the add on the roster, the drop gone, the IR move made, and the moves. */
export function landed(a: Pick<ActionRow, "moves" | "transaction">, after: Roster): boolean {
  if (a.transaction && !addLanded(a.transaction, after)) return false;
  return applied(a.moves, after);
}

/** A failed row whose add still went through: the lineup stage was the one that did not. */
const addStood = (a: ActionRow): boolean =>
  a.status !== "failed" || (typeof a.result === "object" && a.result !== null && (a.result as { stage?: string }).stage === "lineup");

/** What RosterBots has added and dropped here, for the No-Cray Rules' no-churn rule. A failed write whose add landed counts. */
export async function outsideHistory(store: Store, connectionId: string, period: number): Promise<OutsideHistory> {
  const rows = await store.transactions(connectionId);
  const addedAt = new Map<string, string>();
  const dropped = new Set<string>();
  let addsThisWeek = 0;
  for (const a of rows) {
    const tx = a.transaction;
    if (!tx || !addStood(a)) continue;
    if (a.period === period) addsThisWeek++;
    addedAt.set(tx.add.playerId, a.executedAt ?? a.createdAt);
    if (tx.room.how === "drop") dropped.add(tx.room.playerId);
  }
  return { addsThisWeek, addedAt, dropped };
}

/**
 * The first automatic move in a league waits for one change the user made through
 * RosterBots (the test swap, or an approval) to show on a fresh read (owner, Oct 3). Per
 * connection and for good, whatever the connector declares about its write: a league the
 * Saturday test swap never touched gets proposals, not moves.
 */
export const writeUnproven = (conn: ConnectionRow): boolean => !conn.writeVerifiedAt;

/** Record whether the user's own change landed. Never throws: the user's answer does not depend on it. */
export async function noteWrite(deps: Deps, conn: ConnectionRow, at: Date | null): Promise<void> {
  try {
    await deps.store.setWriteVerified(conn.id, at ? at.toISOString() : null);
  } catch {
    // The store is failing. Unrecorded proof only keeps automation held, which is the safe side.
  }
}

export interface WriteResult {
  httpStatus: number | null;
  detail: string;
  error?: string;
}

/**
 * Ask ESPN for the moves, then read the team back. Whatever ESPN answered, only
 * the fresh read says whether it happened. Throws only if that read fails twice.
 * The write itself is never sent twice.
 */
export async function writeAndVerify(deps: Deps, espn: FantasyConnector, conn: ConnectionRow, moves: Move[], period: number) {
  let result: WriteResult;
  try {
    const tx = await espn.setLineup(conn.leagueId, moves, period);
    result = { httpStatus: tx.httpStatus, detail: tx.detail };
  } catch (e) {
    const httpStatus = e instanceof AuthError || e instanceof ProviderError ? e.httpStatus : null;
    result = { httpStatus, detail: "", error: errorText(e) };
  }
  let after = await readBack(deps, espn, conn);
  if (!applied(moves, after)) {
    // ESPN's read host can lag its write host by a moment. A second look before the write
    // is called unconfirmed, since that verdict is never retried and holds the week.
    await pause(deps, RETRY_PAUSE_MS);
    after = await readBack(deps, espn, conn);
  }
  return { applied: applied(moves, after), after, result };
}

export interface OutsideWrite {
  applied: boolean;
  after: Roster;
  /** ESPN's answers, by stage. */
  result: Record<string, unknown>;
  /** The lineup moves made, adjusted to wherever ESPN put the add. */
  moves: Move[];
  /** The stage that did not land, or done. */
  stage: "ir" | "add" | "lineup" | "done";
}

/**
 * An add from outside the roster, in the owner's order: the IR move that makes room, if
 * that is the room; then the add, with the drop if that is the room; then the lineup moves.
 * Each stage is read back before the next, and the first that ESPN does not show stops it:
 * the receipt says exactly how far it got. Throws only if a read back fails twice.
 */
export async function writeOutsideAndVerify(deps: Deps, espn: FantasyConnector, conn: ConnectionRow, candidate: Candidate, period: number): Promise<OutsideWrite> {
  const add = candidate.add;
  if (!add) throw new Error("writeOutsideAndVerify: not an outside candidate");
  const result: Record<string, unknown> = {};
  const tx = async (what: string, send: () => Promise<{ httpStatus: number; detail: string }>): Promise<void> => {
    try {
      const r = await send();
      result[what] = { httpStatus: r.httpStatus, detail: r.detail };
    } catch (e) {
      const httpStatus = e instanceof AuthError || e instanceof ProviderError ? e.httpStatus : null;
      result[what] = { httpStatus, detail: "", error: errorText(e) };
    }
  };
  // A second look before any stage is called failed: ESPN's read host can lag its write host.
  const confirmed = async (check: (r: Roster) => boolean): Promise<{ ok: boolean; after: Roster }> => {
    let after = await readBack(deps, espn, conn);
    if (check(after)) return { ok: true, after };
    await pause(deps, RETRY_PAUSE_MS);
    after = await readBack(deps, espn, conn);
    return { ok: check(after), after };
  };
  const at = (r: Roster, id: string) => r.entries.find((e) => e.player.id === id)?.slot;
  const room = add.room;
  let after: Roster;

  if (room.how === "ir") {
    await tx("ir", () => espn.setLineup(conn.leagueId, [{ playerId: room.player.id, from: room.from, to: IR }], period));
    const c = await confirmed((r) => at(r, room.player.id) === IR);
    after = c.after;
    if (!c.ok) return { applied: false, after, result, moves: [], stage: "ir" };
  }

  const drop = room.how === "drop" ? { playerId: room.player.id, fromSlot: room.from } : undefined;
  await tx("add", () => espn.addDrop(conn.leagueId, { add: { playerId: candidate.player.id, toSlot: add.to }, ...(drop ? { drop } : {}) }, period));
  const added = await confirmed((r) => at(r, candidate.player.id) !== undefined && (!drop || at(r, drop.playerId) === undefined));
  after = added.after;
  if (!added.ok) return { applied: false, after, result, moves: [], stage: "add" };

  // The moves, from wherever ESPN put him: the slot asked for, or the bench.
  const landedAt = at(after, candidate.player.id)!;
  let moves = candidate.moves.map((m) => (m.playerId === candidate.player.id ? { ...m, from: landedAt } : m));
  if (!moves.length && landedAt !== add.to) moves = [{ playerId: candidate.player.id, from: landedAt, to: add.to }];
  moves = moves.filter((m) => m.from !== m.to);
  if (!moves.length) return { applied: true, after, result, moves, stage: "done" };

  await tx("lineup", () => espn.setLineup(conn.leagueId, moves, period));
  const moved = await confirmed((r) => applied(moves, r));
  return { applied: moved.ok, after: moved.after, result, moves, stage: moved.ok ? "done" : "lineup" };
}

/**
 * Keep what a fresh read showed, so Home is not a check behind after the user's own tap.
 * Never throws: the write and its receipt stand without it, and the next check saves a newer one.
 */
export async function keepRoster(deps: Deps, conn: ConnectionRow, roster: Roster, at: Date): Promise<void> {
  try {
    await deps.store.saveRoster(conn.id, roster, at.toISOString());
  } catch {
    // The store is failing; the answer to the user does not depend on this.
  }
}

export function signature(kind: ActionKind, findingKey: string, moves: Move[], tx?: StoredTransaction | null): string {
  const parts = [kind, findingKey, ...moves.map((m) => `${m.playerId}:${m.from}>${m.to}`)];
  if (tx) parts.push(`add:${tx.add.playerId}>${tx.add.to}`, tx.room.how === "open" ? "room:open" : `room:${tx.room.how}:${tx.room.playerId}<${tx.room.from}`);
  return parts.join("|");
}

export const utcDayStart = (now: Date): string =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();

/** An activity row, then a push. The row is the record; a push that fails does not fail the check. */
export async function announce(
  deps: Deps,
  conn: ConnectionRow,
  notice: { type: ActivityType; title: string; body: string },
  data: Record<string, unknown>,
): Promise<void> {
  await deps.store.addActivity({ userId: conn.userId, connectionId: conn.id, type: notice.type, title: notice.title, body: notice.body, data });
  try {
    const tokens = await deps.store.pushTokens(conn.userId);
    if (tokens.length) {
      const push = { type: notice.type, connectionId: conn.id, ...(typeof data.actionId === "string" ? { actionId: data.actionId } : {}) };
      await deps.push.send(tokens, { title: notice.title, body: notice.body, data: push });
    }
  } catch {
    // Expo or the token lookup failed. The activity row stands; the next notice tries again.
  }
}

/**
 * When to look again after ESPN could not be read: within REAUTH_RETRY_MIN minutes, and
 * sooner on the kickoff cadence of the last whole read (every minute inside T-10). A late
 * scratch with one failed read in the last minutes must not wait five and miss T-4.
 */
export async function retryAt(deps: Deps, conn: ConnectionRow, now: Date, latest: Roster | null = null): Promise<string> {
  let saved: Roster | null = null;
  try {
    saved = await deps.store.lastRoster(conn.id);
  } catch {
    // The store is failing; five minutes it is.
  }
  let next = inMinutes(now, REAUTH_RETRY_MIN);
  for (const r of [latest, saved]) {
    if (!r) continue;
    const cadence = nextCheckAt(r, now, minuteWindow(conn));
    if (cadence < next) next = cadence;
  }
  return next.toISOString();
}

/**
 * Mark the connection needs_reauth and say so, once: a connection already marked is
 * retried every few minutes (every minute close to a kickoff), silently, and a good read
 * makes it active again.
 */
export async function signedOut(deps: Deps, conn: ConnectionRow, now: Date, cause: unknown): Promise<{ told: boolean; nextCheckAt: string }> {
  const next = await retryAt(deps, conn, now);
  // A league the user paused stays paused: the sign-in is asked for, but nothing resumes on its own.
  await deps.store.saveCheck(conn.id, { ...(conn.status === "paused" ? {} : { status: "needs_reauth" as const }), lastCheckedAt: now.toISOString(), nextCheckAt: next });
  if (conn.status === "needs_reauth") return { told: false, nextCheckAt: next };
  await announce(deps, conn, signIn(conn.teamName, cause instanceof WrongTeamError), { reason: cause instanceof WrongTeamError ? "wrong_team" : "signed_out" });
  return { told: true, nextCheckAt: next };
}

/**
 * Holes the user declined this period. Their fix stands as a fix, but it does not claim its
 * bench player in evaluate, so a hole the user did not decline may have him (owner, Oct 4).
 */
export async function declinedHoles(store: Store, connectionId: string, found: Finding[], period: number): Promise<Set<string>> {
  const out = new Set<string>();
  for (const f of found) {
    if (!f.hard) continue;
    if ((await store.actionsFor(connectionId, f.key, period)).some((a) => a.status === "declined")) out.add(f.key);
  }
  return out;
}

/** A write ESPN was asked for, then could not be read back on: in flight until a whole read says how it ended. */
export const UNCONFIRMED = "unconfirmed";
export const unconfirmed = (a: ActionRow): boolean =>
  a.status === "approved" && typeof a.result === "object" && a.result !== null && (a.result as Record<string, unknown>)[UNCONFIRMED] === true;

/**
 * The read back after a write failed twice: ESPN may well have made the change, so it is
 * neither done nor failed. The row stays in flight, marked, and the next check's settle()
 * reads ESPN and says which. Calling it failed would hold every automatic move for the week
 * on a read that failed, not a write (Oct 4 review).
 */
export async function leaveUnconfirmed(deps: Deps, action: ActionRow, e: unknown): Promise<void> {
  try {
    await deps.store.updateAction(action.id, { status: "approved", result: { [UNCONFIRMED]: true, error: errorText(e) } }, "approved");
  } catch {
    // The store is failing; the row is 'approved' either way, and settle() takes it after INTERRUPTED_MS.
  }
}

/**
 * A write that was not confirmed: recorded as failed, never retried, and the user told.
 * Only a write still in flight is settled here; one something else settled is left alone.
 */
export async function failed(
  deps: Deps,
  conn: ConnectionRow,
  action: ActionRow,
  who: Lookup,
  after: Roster | undefined,
  result: unknown,
  now: Date,
): Promise<boolean> {
  if (!(await deps.store.updateAction(action.id, { status: "failed", executedAt: now.toISOString(), result }, "approved"))) return false;
  const stage = result && typeof result === "object" ? (result as { stage?: "ir" | "add" | "lineup" | "done" }).stage : undefined;
  const notice = failure(action.reason, action.moves, who, after, action.deadline, now, action.transaction, stage);
  await announce(deps, conn, notice, { actionId: action.id, findingKey: action.findingKey, moves: action.moves });
  return true;
}
