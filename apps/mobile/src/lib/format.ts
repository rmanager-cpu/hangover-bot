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

/** Each level's name (the contract's), the question the Protection screen asks, and what it promises. */
export const AUTHORITY: Record<Authority, { name: string; ask: string; askDetail: string; short: string }> = {
  alerts: { name: "Alerts", ask: "Tell me", askDetail: "Push alert only", short: "I watch and tell you. I never touch your lineup." },
  ask_me: { name: "Ask Me", ask: "Ask me first", askDetail: "Send a suggested swap for approval", short: "I find the fix and ask you. One tap to approve." },
  bench_protection: { name: "Bench Protection", ask: "Fix it automatically", askDetail: "Make the best legal replacement", short: "I fix lineup holes myself, from your bench." },
  ai_rescue: { name: "AI Rescue", ask: "AI Rescue", askDetail: "Coming soon", short: "Coming soon." },
};

/** Home's one line under the headline: "Protection: ON · Bench only". */
export function protectionLine(authority: Authority, claimed: boolean, status: string): string {
  if (status === "paused") return "Protection: PAUSED";
  const level = authority === "ai_rescue" ? "bench_protection" : authority;
  if (level === "alerts") return "Protection: Alerts only";
  if (level === "ask_me") return "Protection: Ask me first · Bench only";
  return claimed ? "Protection: ON · Bench only" : "Protection: Ask me first until you claim your account";
}

export const ACTIVITY_LABEL: Record<ActivityType, string> = {
  STATUS_CHANGED: "Update",
  ACTION_REQUIRED: "Needs you",
  ACTION_RECOMMENDED: "Suggested move",
  ACTION_COMPLETED: "Done",
  ACTION_FAILED: "Didn't go through",
  PREGAME_WARNING: "Before kickoff",
};

export const isWarning = (t: ActivityType) => t === "ACTION_REQUIRED" || t === "ACTION_FAILED" || t === "PREGAME_WARNING";
