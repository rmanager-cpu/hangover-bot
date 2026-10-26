// Words and times as the user reads them. Times are the phone's own time zone, the way
// the ESPN app shows kickoffs, so the two screens can be compared line by line.

import type { Authority } from "@rosterbots/core";
import type { ActivityType } from "@rosterbots/service";

const DAY_TIME = new Intl.DateTimeFormat(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });
const TIME = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const DATE = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });

const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** "Sun 10:00 AM": a kickoff, always with its day. */
export function kickoffText(iso: string): string {
  return DAY_TIME.format(new Date(iso));
}

/** "4:12 PM" today, "Sat 4:12 PM" this week, "Sep 28" before that. */
export function whenText(iso: string, now = new Date()): string {
  const at = new Date(iso);
  if (sameDay(at, now)) return TIME.format(at);
  if (Math.abs(now.getTime() - at.getTime()) < 6 * 86_400_000) return DAY_TIME.format(at);
  return DATE.format(at);
}

/** "just now", "12 min ago", "3 h ago", or a date. */
export function agoText(iso: string, now = new Date()): string {
  const min = Math.round((now.getTime() - Date.parse(iso)) / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  if (min < 24 * 60) return `${Math.floor(min / 60)} h ago`;
  return whenText(iso, now);
}

/** "in 25 min", "in 3 h 10 min", or the clock time when it's further off. */
export function untilText(iso: string, now = new Date()): string {
  const min = Math.round((Date.parse(iso) - now.getTime()) / 60_000);
  if (min <= 0) return "now";
  if (min < 60) return `in ${min} min`;
  if (min < 12 * 60) return `in ${Math.floor(min / 60)} h ${min % 60} min`;
  return kickoffText(iso);
}

/** Slot names as the ESPN app prints them. */
export function slotLabel(slot: string): string {
  if (slot === "BENCH") return "Bench";
  if (slot === "DST") return "D/ST";
  if (slot === "SUPERFLEX") return "OP";
  return slot;
}

/** ESPN's injury tag ("O", "Q", ...) and the word for it. Active has no tag, as on ESPN. */
export function statusTag(status: string): { tag: string; word: string; tone: "warn" | "out" } | null {
  switch (status) {
    case "active":
      return null;
    case "questionable":
      return { tag: "Q", word: "Questionable", tone: "warn" };
    case "doubtful":
      return { tag: "D", word: "Doubtful", tone: "warn" };
    case "out":
      return { tag: "O", word: "Out", tone: "out" };
    case "ir":
      return { tag: "IR", word: "Injured reserve", tone: "out" };
    case "suspended":
      return { tag: "SSPD", word: "Suspended", tone: "out" };
    default:
      return { tag: "?", word: "Status not recognized", tone: "warn" };
  }
}

/** The status chip beside a watched starter: green Healthy, amber Questionable, red Out. */
export function statusPill(status: string, bye: boolean): { text: string; tone: "healthy" | "warn" | "out" | "plain" } {
  if (bye) return { text: "Bye", tone: "plain" };
  const tag = statusTag(status);
  if (!tag) return { text: "Healthy", tone: "healthy" };
  if (status === "ir") return { text: "IR", tone: "out" };
  if (status === "unknown") return { text: "Check status", tone: "warn" };
  return { text: tag.word, tone: tag.tone };
}

/**
 * The three levels (docs/AI-NATIVE.md): their names, the line the Protection screen shows
 * under each, and what each promises. A stored `alerts` is Alert Me too: one option (owner, Oct 25).
 */
export const AUTHORITY: Record<Authority, { name: string; ask: string; askDetail: string; short: string }> = {
  alerts: { name: "Alert Me", ask: "Alert Me", askDetail: "A push, and a one-tap fix", short: "I find the fix and send it to you. One tap makes it." },
  ask_me: { name: "Alert Me", ask: "Alert Me", askDetail: "A push, and a one-tap fix", short: "I find the fix and send it to you. One tap makes it." },
  bench_protection: { name: "Auto Protect", ask: "Auto Protect", askDetail: "Fixes a hole from your bench, automatically", short: "I fix lineup holes myself, from your bench." },
  ai_rescue: { name: "AI Native", ask: "AI Native", askDetail: "Auto Protect, plus free agents and Roster Advice", short: "I fix holes from your bench, then from free agency, and advise on the week ahead." },
};

/** The level as the app treats it: a stored alerts is Alert Me. */
export const levelOf = (authority: Authority): Exclude<Authority, "alerts"> => (authority === "alerts" ? "ask_me" : authority);

/** Home's one line under the headline: "Protection: Auto Protect · Bench only". */
export function protectionLine(authority: Authority, claimed: boolean, status: string): string {
  if (status === "paused") return "Protection: PAUSED";
  const level = levelOf(authority);
  if (level === "ask_me") return "Protection: Alert Me · Bench only";
  if (!claimed) return "Protection: Alert Me until you sign in with Google";
  return level === "ai_rescue" ? "Protection: AI Native · Bench + free agents" : "Protection: Auto Protect · Bench only";
}

export const ACTIVITY_LABEL: Record<ActivityType, string> = {
  STATUS_CHANGED: "Update",
  ACTION_REQUIRED: "Needs you",
  ACTION_RECOMMENDED: "Suggested move",
  ACTION_COMPLETED: "Done",
  ACTION_FAILED: "Didn't go through",
  PREGAME_WARNING: "Before kickoff",
  ALL_CLEAR: "Kickoff check",
  ADVICE: "Roster Advice",
};

export const isWarning = (t: ActivityType) => t === "ACTION_REQUIRED" || t === "ACTION_FAILED" || t === "PREGAME_WARNING";
