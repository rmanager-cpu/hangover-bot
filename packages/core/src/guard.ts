// The first-weekend guardrails (docs/BETA.md). plan() says what the user's settings
// allow; guard() decides whether an automatic move may happen right now. Pure, like
// the engine: the service passes the clock, the day's count and the sanity verdict.

import { isStarting, type Roster, type Slot, type Status, type Step } from "./types.ts";

export interface AutomationPolicy {
  /** Automatic moves start this many minutes before the finding's deadline. */
  autoFromMinutes: number;
  /** And stop this many minutes before it. Closer than this, the user decides. */
  autoUntilMinutes: number;
  /** Per connection per UTC day. */
  maxAutoMovesPerDay: number;
}

// Frozen because it is shared: a per-connection limit is a copy, never an edit to this.
// The window ends at T-4 (owner, Oct 3), so a late scratch ESPN shows after T-10 can still be fixed.
export const BETA_AUTOMATION: AutomationPolicy = Object.freeze({ autoFromMinutes: 90, autoUntilMinutes: 4, maxAutoMovesPerDay: 3 });

export interface GuardContext {
  now: Date;
  /** Automatic moves already made for this connection today, failed ones included. */
  autoMovesToday: number;
  /** rosterLooksSane() on the read this step came from. */
  readLooksSane: boolean;
  policy: AutomationPolicy;
}

/** Only ever turns an `execute` into a held `propose`. Every other step passes through unchanged. */
export function guard(step: Step, ctx: GuardContext): Step {
  if (step.do !== "execute") return step;
  const hold = (reason: string, autoAt?: string): Step => ({
    do: "propose",
    finding: step.finding,
    candidate: step.candidate,
    source: step.source,
    held: autoAt ? { reason, autoAt } : { reason },
  });
  const { policy } = ctx;

  if (!ctx.readLooksSane) return hold("ESPN data looked incomplete");
  if (ctx.autoMovesToday >= policy.maxAutoMovesPerDay) return hold("daily limit");

  // An unparseable deadline is as unknown as a missing one.
  const deadline = step.finding.deadline ? Date.parse(step.finding.deadline) : NaN;
  if (Number.isNaN(deadline)) return hold("kickoff unknown");

  // Both edges are inside the window: exactly T-90 and exactly T-4 still act.
  const from = deadline - policy.autoFromMinutes * 60_000;
  const until = deadline - policy.autoUntilMinutes * 60_000;
  const now = ctx.now.getTime();
  if (now < from) return hold("too early for an automatic move", new Date(from).toISOString());
  if (now > until) return hold("too close to kickoff for an automatic move");
  return step;
}

const OUT: readonly Status[] = ["out", "ir", "suspended"];

/** More than this many starters out at once is more likely a bad read than a bad week. */
const MAX_STARTERS_OUT = 3;

/**
 * Non-empty, no duplicate player ids, starting slots known, at most 3 starters OUT/IR/suspended
 * at once among those not yet locked: one who has played (Thursday's game, then IR) is no
 * sign of a bad read, and counting him would stop every fix for the rest of the week.
 */
export function rosterLooksSane(roster: Roster): boolean {
  if (!roster.entries.length) return false;
  if (new Set(roster.entries.map((e) => e.player.id)).size !== roster.entries.length) return false;

  // Known means the league's slots were read and every starter sits in one of them,
  // no more to a slot than the league has. Fewer is fine: that is an empty slot.
  if (!roster.starterSlots.length) return false;
  const room = new Map<Slot, number>();
  for (const s of roster.starterSlots) room.set(s, (room.get(s) ?? 0) + 1);
  const starters = roster.entries.filter((e) => isStarting(e.slot));
  for (const e of starters) {
    const left = room.get(e.slot) ?? 0;
    if (left === 0) return false;
    room.set(e.slot, left - 1);
  }

  // Locked ones are excused only a little: a read that marks the whole lineup OUT late on
  // Sunday, when few are unlocked, is still a bad read.
  const out = starters.filter((e) => OUT.includes(e.player.status));
  return out.filter((e) => !e.player.locked).length <= MAX_STARTERS_OUT && out.length <= MAX_STARTERS_OUT + 2;
}
