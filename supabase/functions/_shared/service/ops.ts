// Copied from packages/service/src/ops.ts by scripts/build-functions.ts. Edit the original.
// What protectConnection, decideAction and manualSwap share: reaching ESPN for one
// connection, writing and verifying, and telling the user.
//
// Never log a request to ESPN, its headers or a credential. Nothing here logs at
// all; errors carry HTTP statuses and connection ids, never cookies.

import { applied, DEFAULT_SETTINGS, type Move, type Roster, type Settings } from "@rosterbots/core";
import { AuthError, ProviderError, type FantasyConnector } from "@rosterbots/connectors";
import type { ActionKind, ActionRow, ActivityType, ConnectionRow, Deps } from "./types.ts";
import { failure, signIn, type Lookup } from "./words.ts";

const MIN = 60_000;

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

/** Only the user can fix these: sign in to ESPN again. */
export const isSignedOut = (e: unknown): boolean => e instanceof AuthError || e instanceof WrongTeamError;

export const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

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
    await (deps.pause ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms))))(RETRY_PAUSE_MS);
    return readTeam(espn, conn);
  }
}

/** The connection's settings as the engine reads them. */
export async function settingsFor(deps: Deps, conn: ConnectionRow): Promise<Settings> {
  return {
    ...DEFAULT_SETTINGS,
    // AI Rescue is not offered in the beta: it gets Bench Protection's automation and no AI.
    authority: conn.authority === "ai_rescue" ? "bench_protection" : conn.authority,
    accountClaimed: await deps.store.accountClaimed(conn.userId),
    permissions: { ...DEFAULT_SETTINGS.permissions, benchSwaps: conn.benchSwaps },
    replacementOrder: conn.replacementOrder ?? [],
  };
}

/**
 * ESPN's lineup write is built from what the ESPN site sends and declared unverified by the
 * connector. Until this league has seen one HangoverBot change land, nothing is automatic.
 */
export const writeUnproven = (espn: FantasyConnector, conn: ConnectionRow): boolean =>
  espn.capabilities().unverified.includes("WRITE_LINEUP") && !conn.writeVerifiedAt;

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
 * the fresh read says whether it happened. Throws only if that read fails.
 */
export async function writeAndVerify(espn: FantasyConnector, conn: ConnectionRow, moves: Move[], period: number) {
  let result: WriteResult;
  try {
    const tx = await espn.setLineup(conn.leagueId, moves, period);
    result = { httpStatus: tx.httpStatus, detail: tx.detail };
  } catch (e) {
    const httpStatus = e instanceof AuthError || e instanceof ProviderError ? e.httpStatus : null;
    result = { httpStatus, detail: "", error: errorText(e) };
  }
  const after = await readTeam(espn, conn);
  return { applied: applied(moves, after), after, result };
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

export function signature(kind: ActionKind, findingKey: string, moves: Move[]): string {
  return [kind, findingKey, ...moves.map((m) => `${m.playerId}:${m.from}>${m.to}`)].join("|");
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
 * Mark the connection needs_reauth and say so, once: a connection already marked is
 * retried every few minutes, silently, and a good read makes it active again.
 */
export async function signedOut(deps: Deps, conn: ConnectionRow, now: Date, cause: unknown): Promise<{ told: boolean; nextCheckAt: string }> {
  const nextCheckAt = new Date(now.getTime() + REAUTH_RETRY_MIN * MIN).toISOString();
  await deps.store.saveCheck(conn.id, { status: "needs_reauth", lastCheckedAt: now.toISOString(), nextCheckAt });
  if (conn.status === "needs_reauth") return { told: false, nextCheckAt };
  await announce(deps, conn, signIn(conn.teamName, cause instanceof WrongTeamError), { reason: cause instanceof WrongTeamError ? "wrong_team" : "signed_out" });
  return { told: true, nextCheckAt };
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
  const notice = failure(action.reason, action.moves, who, after, action.deadline, now);
  await announce(deps, conn, notice, { actionId: action.id, findingKey: action.findingKey, moves: action.moves });
  return true;
}
