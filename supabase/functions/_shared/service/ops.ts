// Copied from packages/service/src/ops.ts by scripts/build-functions.ts. Edit the original.
// What protectConnection, decideAction and manualSwap share: reaching ESPN for one
// connection, writing and verifying, and telling the user.
//
// Never log a request to ESPN, its headers or a credential. Nothing here logs at
// all; errors carry HTTP statuses and connection ids, never cookies.

import { applied, type Move, type Roster } from "@rosterbots/core";
import { AuthError, ProviderError, type FantasyConnector } from "@rosterbots/connectors";
import type { ActionKind, ActionRow, ActivityType, ConnectionRow, Deps } from "./types.ts";
import { failure, signIn, type Lookup } from "./words.ts";

const MIN = 60_000;

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
 * retried hourly and silently. Returns whether the user was told.
 */
export async function signedOut(deps: Deps, conn: ConnectionRow, now: Date, cause: unknown): Promise<boolean> {
  const nextCheckAt = new Date(now.getTime() + 60 * MIN).toISOString();
  await deps.store.saveCheck(conn.id, { status: "needs_reauth", lastCheckedAt: now.toISOString(), nextCheckAt });
  if (conn.status === "needs_reauth") return false;
  await announce(deps, conn, signIn(conn.teamName, cause instanceof WrongTeamError), { reason: cause instanceof WrongTeamError ? "wrong_team" : "signed_out" });
  return true;
}

/** A write that was not confirmed: recorded as failed, never retried, and the user told. */
export async function failed(
  deps: Deps,
  conn: ConnectionRow,
  action: ActionRow,
  who: Lookup,
  after: Roster | undefined,
  result: unknown,
  now: Date,
): Promise<void> {
  await deps.store.updateAction(action.id, { status: "failed", executedAt: now.toISOString(), result });
  const notice = failure(action.reason, action.moves, who, after, action.deadline, now);
  await announce(deps, conn, notice, { actionId: action.id, findingKey: action.findingKey, moves: action.moves });
}
