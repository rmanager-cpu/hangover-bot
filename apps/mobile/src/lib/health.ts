// Is a league actually being read? A check that fails still stamps last_checked_at but keeps
// the last good roster and its time (service protect.ts); a good check stamps both alike. So
// "checked 2 min ago" says nothing about ESPN: the last read does (owner, Nov 6, on a phone
// that showed Week 7's team two weeks later under "Last checked 2 min ago").

import type { ActivityItem, Connection } from "./data";

const READ_GRACE_MS = 10 * 60_000;

/** Checks run, but none has read ESPN since the last good read: the team shown is old. */
export function readFailing(conn: Connection): boolean {
  if (!conn.lastCheckedAt || !conn.lastRosterAt) return false;
  return Date.parse(conn.lastCheckedAt) - Date.parse(conn.lastRosterAt) > READ_GRACE_MS;
}

/** Waiting for a sign-in because the one RosterBots has is a different ESPN account (the checker's "wrong_team"). */
export function wrongAccount(conn: Connection, activity: ActivityItem[]): boolean {
  if (conn.status !== "needs_reauth") return false;
  const last = activity.find((a) => a.connectionId === conn.id && a.title === "Sign in to ESPN again");
  return last?.data?.reason === "wrong_team";
}

/** The team on screen is not this week's live read: signed out, wrong account, or reads failing. */
export const staleRead = (conn: Connection): boolean => conn.status === "needs_reauth" || readFailing(conn);
