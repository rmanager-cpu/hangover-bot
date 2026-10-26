// Copied from packages/service/src/check.ts by scripts/build-functions.ts. Edit the original.
// What one check carries from step to step, and the pieces every step shares: the holds
// that turn an automatic move into a proposal, the dedupe against earlier rows, and the
// proposal itself. protect.ts runs the check; outside.ts is AI Native's T-15 step on it.

import { type AiChoice, type AutomationPolicy, type Finding, type Roster, type Settings, type Step } from "@rosterbots/core";
import type { FantasyConnector } from "@rosterbots/connectors";
import { announce, signature, storedTransaction } from "./ops.ts";
import type { ActionRow, ConnectionRow, Deps, NewAction } from "./types.ts";
import { HELD_APPROVED, HELD_DECLINED, HELD_FAILED, HELD_FAILED_NOW, HELD_FAILED_WEEK, HELD_UNPROVEN, changeOf, problemOf, proposal } from "./words.ts";

export const MIN = 60_000;

/**
 * The cron tick this check belongs to. Checks run on the minute and read the clock a few
 * hundred ms later; the automatic window is judged at the tick, so the T-4 check acts
 * (owner, Oct 3: the window runs to T-4) rather than missing it by the function's lag.
 */
export const tickOf = (now: Date): Date => new Date(Math.floor(now.getTime() / MIN) * MIN);

export type Propose = Extract<Step, { do: "propose" }>;

export interface Check {
  deps: Deps;
  conn: ConnectionRow;
  espn: FantasyConnector;
  settings: Settings;
  policy: AutomationPolicy;
  /** The newest read: it changes after every write. */
  latest: Roster;
  autoToday: number;
  /** A write failed in this check, or earlier this period: nothing more is automatic this week. */
  failedNow: boolean;
  failedEarlier: boolean;
  /** No change the user made through RosterBots has been seen landing in this league yet. */
  unproven: boolean;
  /** Holes the user declined this period: their fixes do not claim bench players (core evaluate). */
  release: ReadonlySet<string>;
  /** The AI's answer for a finding this check, so the re-read before a write judges it the same way. */
  aiChoices: Map<string, AiChoice>;
  /** Why a finding is acted on, when it is not the finding's own problem: the hole a fill was made for. */
  reasons: Map<string, string>;
  tally: { executed: number; proposed: number; notified: number };
}

/** The shared policy with this connection's own daily limit. A copy: the shared one is frozen. */
export function policyFor(deps: Deps, conn: ConnectionRow): AutomationPolicy {
  const max = Number.isFinite(conn.maxAutoMovesPerDay) ? conn.maxAutoMovesPerDay : deps.policy.maxAutoMovesPerDay;
  return { ...deps.policy, maxAutoMovesPerDay: max };
}

/** The action's `reason` for a finding: its own problem, or the hole an earlier fill was made for. */
export const reasonOf = (c: Check, f: Finding): string => c.reasons.get(f.key) ?? problemOf(f);

/** This finding's actions so far, with any proposal past its deadline marked expired. */
export async function history(c: Check, f: Finding, period: number, now: Date): Promise<ActionRow[]> {
  const rows = await c.deps.store.actionsFor(c.conn.id, f.key, period);
  const out: ActionRow[] = [];
  for (const a of rows) {
    if (a.status === "pending" && a.deadline !== null && Date.parse(a.deadline) <= now.getTime()) {
      await c.deps.store.updateAction(a.id, { status: "expired" }, "pending");
      out.push({ ...a, status: "expired" });
    } else out.push(a);
  }
  return out;
}

/**
 * Withdraw the finding's waiting proposals. Only while they are still waiting: if the user
 * answered one first, their answer stands and this returns false.
 */
export async function supersede(c: Check, rows: ActionRow[]): Promise<boolean> {
  for (const a of rows) {
    if (a.status === "pending" && !(await c.deps.store.updateAction(a.id, { status: "superseded" }, "pending"))) return false;
  }
  return true;
}

export function action(c: Check, f: Finding, period: number, fields: Omit<NewAction, "connectionId" | "userId" | "findingKey" | "period" | "deadline">): NewAction {
  return { connectionId: c.conn.id, userId: c.conn.userId, findingKey: f.key, period, deadline: f.deadline ?? null, ...fields };
}

// A step counts as announced while its row stands. A superseded one was withdrawn,
// so the same step coming back is news again.
export const announced = (rows: ActionRow[], sig: string) => rows.find((a) => a.signature === sig && a.status !== "superseded");

/** Why an Auto Protect or AI Native user is being asked rather than told, when no guardrail says. */
export function aside(c: Check): string | undefined {
  if (c.settings.authority !== "bench_protection" && c.settings.authority !== "ai_rescue") return undefined;
  if (!c.settings.accountClaimed) return "Claim your account in Settings and I can make moves like this on my own.";
  if (!c.settings.permissions.benchSwaps) return "Bench swaps are off in your settings, so I won't make it on my own.";
  return undefined;
}

/** Why this finding's automatic move waits for a tap, from what already happened to it this week. */
function findingHold(rows: ActionRow[]): string | undefined {
  // Writes made for it: automatic ones, and proposals the user approved.
  const writes = rows.filter((a) => a.kind === "execute" || (a.kind === "propose" && (a.status === "approved" || a.status === "done" || a.status === "failed")));
  if (writes.some((a) => a.status === "failed")) return HELD_FAILED;
  if (writes.some((a) => a.kind === "execute")) return HELD_TRIED;
  if (writes.length) return HELD_APPROVED;
  if (rows.some((a) => a.status === "declined")) return HELD_DECLINED;
  return undefined;
}

export const HELD_TRIED = "already tried automatically";

/**
 * Why this finding's automatic move waits for a tap. A hole (a starter projected for zero,
 * OUT, IR, suspended or on bye, or an empty slot) is filled whatever happened to it before
 * this week, a change made and then undone in the ESPN app included (owner, Oct 4: "never a
 * situation in which an injured player with a 0 projection is in your starting lineup. I
 * don't want to have to approve it or not"). The user's own Decline in the app is the one
 * thing that stops it; a failed write still holds the week, through connectionHold.
 */
export function userHold(f: Finding, rows: ActionRow[]): string | undefined {
  if (!f.hard) return findingHold(rows);
  if (rows.some((a) => a.status === "approved")) return HELD_APPROVED; // a write for it is under way
  if (rows.some((a) => a.status === "failed")) return HELD_FAILED;
  if (rows.some((a) => a.status === "declined")) return HELD_DECLINED;
  return undefined;
}

/** Why every automatic move on this connection waits for a tap. */
export function connectionHold(c: Check): string | undefined {
  if (c.failedNow) return HELD_FAILED_NOW;
  if (c.failedEarlier) return HELD_FAILED_WEEK;
  if (c.unproven) return HELD_UNPROVEN;
  return undefined;
}

/** Does the connection as it stands now still allow an automatic move? */
export const automatic = (live: ConnectionRow): boolean =>
  live.status !== "paused" && (live.authority === "bench_protection" || live.authority === "ai_rescue") && live.benchSwaps;

export async function propose(c: Check, step: Propose, period: number, now: Date): Promise<void> {
  const f = step.finding;
  const moves = step.candidate.moves;
  const tx = storedTransaction(step.candidate);
  const sig = signature("propose", f.key, moves, tx);
  const rows = await history(c, f, period, now);
  // Never promise an automatic move that a hold on this finding or the whole connection would stop.
  const wide = step.held?.autoAt ? userHold(f, rows) ?? connectionHold(c) : undefined;
  const held = wide ? { reason: wide } : step.held;
  const autoAt = held?.autoAt ?? null;
  // A bench move and AI Native's add for the same hole are two questions, each kept or
  // replaced by its own kind: otherwise each check would withdraw the other's and ask again.
  const own = rows.filter((a) => Boolean(a.transaction) === Boolean(tx));
  // A proposal the user approved and that ESPN showed is done. The same problem back again
  // means it was undone in the ESPN app (Oct 4: Jefferson back at WR after the approved
  // swap): that is news, never silence until kickoff.
  const same = announced(own.filter((a) => !(a.kind === "propose" && a.status === "done")), sig);
  if (same) {
    // Already said. Except when it promised "automatically at 11:30", 11:30 has
    // come, and it is still only a proposal: the user must hear that it will not happen.
    const broken = same.status === "pending" && same.autoAt !== null && Date.parse(same.autoAt) <= now.getTime() && autoAt === null;
    if (!broken) return;
  }
  // Includes a pending proposal of the same kind for the same finding with different moves.
  if (!(await supersede(c, own))) return;
  const notice = proposal(f, step.candidate, held, now, aside(c), reasonOf(c, f));
  const row = await c.deps.store.insertAction(
    action(c, f, period, { kind: "propose", status: "pending", moves, summary: changeOf(f, step.candidate), reason: reasonOf(c, f), autoAt, signature: sig, transaction: tx }),
  );
  await announce(c.deps, c.conn, notice, { actionId: row.id, findingKey: f.key, moves, autoAt, ...(tx ? { transaction: tx } : {}) });
  c.tally.proposed++;
}
