// Copied from packages/service/src/protect.ts by scripts/build-functions.ts. Edit the original.
// One connection, one check: read ESPN, ask the engine, act within the guardrails,
// tell the user once. docs/BETA.md "Service" is the contract, in its order:
// credentials, connector, read, sanity, settings, evaluate, plan, guard, then each step.

import {
  applied,
  evaluate,
  guard,
  plan,
  rosterLooksSane,
  type AutomationPolicy,
  type Finding,
  type Roster,
  type Settings,
  type Step,
} from "@rosterbots/core";
import type { FantasyConnector } from "@rosterbots/connectors";
import {
  announce,
  connect,
  errorText,
  failed,
  isSignedOut,
  readTeamPatiently,
  settingsFor,
  signature,
  signedOut,
  utcDayStart,
  writeAndVerify,
  writeUnproven,
} from "./ops.ts";
import { nextCheckAt } from "./read.ts";
import type { ActionRow, CheckSummary, ConnectionRow, Deps, NewAction } from "./types.ts";
import {
  HELD_APPROVED,
  HELD_DECLINED,
  HELD_FAILED,
  HELD_FAILED_NOW,
  HELD_FAILED_WEEK,
  HELD_TRIED,
  HELD_UNPROVEN,
  changeOf,
  inform,
  playersIn,
  problemOf,
  proposal,
  receipt,
  withdrawn,
} from "./words.ts";

const MIN = 60_000;

/**
 * A write still 'approved' after this long belongs to a run that died mid-write: a check
 * or an approval lasts at most 150 s, the Edge Function wall clock.
 */
const INTERRUPTED_MS = 3 * MIN;

type Execute = Extract<Step, { do: "execute" }>;
type Propose = Extract<Step, { do: "propose" }>;
type Inform = Extract<Step, { do: "notify" | "wait" | "ask_user" }>;

interface Check {
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
  /** No change the user made through HangoverBot has been seen landing in this league yet. */
  unproven: boolean;
  tally: { executed: number; proposed: number; notified: number };
}

/** The shared policy with this connection's own daily limit. A copy: the shared one is frozen. */
function policyFor(deps: Deps, conn: ConnectionRow): AutomationPolicy {
  const max = Number.isFinite(conn.maxAutoMovesPerDay) ? conn.maxAutoMovesPerDay : deps.policy.maxAutoMovesPerDay;
  return { ...deps.policy, maxAutoMovesPerDay: max };
}

export async function protectConnection(deps: Deps, conn: ConnectionRow): Promise<CheckSummary> {
  const now = deps.now();
  const tally = { executed: 0, proposed: 0, notified: 0 };
  let findings = 0;
  let check: Check | undefined;
  let first: Roster | undefined;
  const summary = (outcome: CheckSummary["outcome"], next: Date | string, error?: string): CheckSummary => ({
    connectionId: conn.id,
    outcome,
    findings,
    ...tally,
    nextCheckAt: typeof next === "string" ? next : next.toISOString(),
    ...(error !== undefined ? { error } : {}),
  });

  try {
    if (conn.status === "paused") {
      const next = nextCheckAt(null, now).toISOString();
      await deps.store.saveCheck(conn.id, { lastCheckedAt: now.toISOString(), nextCheckAt: next });
      return summary("skipped", next);
    }

    const espn = await connect(deps, conn);
    if (!espn) {
      const out = await signedOut(deps, conn, now, null);
      if (out.told) tally.notified++;
      return summary("needs_reauth", out.nextCheckAt);
    }
    first = await readTeamPatiently(deps, espn, conn);
    const sane = rosterLooksSane(first);
    const settings = await settingsFor(deps, conn);
    check = {
      deps, conn, espn, settings,
      policy: policyFor(deps, conn),
      latest: first,
      autoToday: 0,
      failedNow: false,
      failedEarlier: false,
      unproven: writeUnproven(conn),
      tally,
    };
    // Settled first, so the week's failures and the day's count below include them.
    await settle(check, first, now);
    check.failedEarlier = (await deps.store.failedWrites(conn.id, first.period)) > 0;
    check.autoToday = await deps.store.autoMovesSince(conn.id, utcDayStart(now));

    const found = evaluate(first, now, settings);
    findings = found.length;
    for (const f of found) {
      const step = guard(plan(f, settings, now), { now, autoMovesToday: check.autoToday, readLooksSane: sane, policy: check.policy });
      await act(check, step, first.period, now);
    }
    // A bad read can miss a problem that is still there, so only a sane one withdraws proposals.
    if (sane) await withdraw(check, new Set(found.map((f) => f.key)), first.period, now);

    const next = nextCheckAt(check.latest, now).toISOString();
    await deps.store.saveCheck(conn.id, {
      // A good read is the proof a connection marked needs_reauth works again.
      ...(conn.status === "active" ? {} : { status: "active" as const }),
      lastCheckedAt: now.toISOString(),
      nextCheckAt: next,
      lastRoster: check.latest,
    });
    return summary("ok", next);
  } catch (e) {
    // One bad connection never stops the others: everything is caught here.
    try {
      if (isSignedOut(e)) {
        const out = await signedOut(deps, conn, now, e);
        if (out.told) tally.notified++;
        return summary("needs_reauth", out.nextCheckAt);
      }
      // Try again soon, but not every minute: within 5 minutes, sooner if a kickoff is close.
      const latest = check?.latest ?? first ?? null;
      const soon = new Date(now.getTime() + 5 * MIN);
      const cadence = nextCheckAt(latest, now);
      const next = (cadence < soon ? cadence : soon).toISOString();
      await deps.store.saveCheck(conn.id, { lastCheckedAt: now.toISOString(), nextCheckAt: next, ...(latest ? { lastRoster: latest } : {}) });
      return summary("error", next, errorText(e));
    } catch (inner) {
      return summary("error", new Date(now.getTime() + 5 * MIN), errorText(e) + "; then " + errorText(inner));
    }
  }
}

/**
 * Writes a run left 'approved' because it died mid-write. This check's read came after
 * them, so it says how they ended: a receipt if ESPN shows the change, ACTION_FAILED if not.
 */
async function settle(c: Check, roster: Roster, now: Date): Promise<void> {
  for (const a of await c.deps.store.openActions(c.conn.id)) {
    if (a.status !== "approved" || now.getTime() - Date.parse(a.decidedAt ?? a.createdAt) < INTERRUPTED_MS) continue;
    const at = now.toISOString();
    if (a.period !== roster.period) {
      // Another week's: there is nothing left to check it against, or to tell.
      await c.deps.store.updateAction(a.id, { status: "failed", executedAt: at, result: { error: "interrupted" } }, "approved");
      continue;
    }
    const who = playersIn(roster);
    if (applied(a.moves, roster)) {
      if (await c.deps.store.updateAction(a.id, { status: "done", executedAt: at, result: { interrupted: true } }, "approved")) {
        await announce(c.deps, c.conn, receipt(a.reason, a.moves, who, now), { actionId: a.id, findingKey: a.findingKey, moves: a.moves });
        c.tally.notified++;
      }
    } else if (await failed(c.deps, c.conn, a, who, roster, { error: "interrupted" }, now)) {
      c.tally.notified++;
    }
  }
}

/**
 * Proposals for a problem this check no longer sees. Past their deadline, or with a player
 * now locked, they just expire. Otherwise ESPN no longer shows the problem: withdrawn, and
 * said once, so a "Scheduled move" never sits there for a problem that went away.
 */
async function withdraw(c: Check, keys: Set<string>, period: number, now: Date): Promise<void> {
  for (const a of await c.deps.store.openActions(c.conn.id)) {
    if (a.status !== "pending" || a.kind !== "propose" || (a.period === period && keys.has(a.findingKey))) continue;
    const locked = a.moves.some((m) => c.latest.entries.find((e) => e.player.id === m.playerId)?.player.locked);
    const late = a.period !== period || locked || (a.deadline !== null && Date.parse(a.deadline) <= now.getTime());
    if (late) {
      await c.deps.store.updateAction(a.id, { status: "expired" }, "pending");
      continue;
    }
    if (!(await c.deps.store.updateAction(a.id, { status: "superseded" }, "pending"))) continue;
    await announce(c.deps, c.conn, withdrawn(a.summary), { actionId: a.id, findingKey: a.findingKey });
    c.tally.notified++;
  }
}

async function act(c: Check, step: Step, period: number, now: Date): Promise<void> {
  switch (step.do) {
    case "execute":
      return execute(c, step, period, now);
    case "propose":
      return propose(c, step, period, now);
    case "consult_ai":
      // No AI in the beta, and settingsFor never asks for it. A judgment call is the user's.
      return tell(c, { do: "ask_user", finding: step.finding, candidates: step.candidates }, period, now);
    default:
      return tell(c, step, period, now);
  }
}

/** This finding's actions so far, with any proposal past its deadline marked expired. */
async function history(c: Check, f: Finding, period: number, now: Date): Promise<ActionRow[]> {
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
async function supersede(c: Check, rows: ActionRow[]): Promise<boolean> {
  for (const a of rows) {
    if (a.status === "pending" && !(await c.deps.store.updateAction(a.id, { status: "superseded" }, "pending"))) return false;
  }
  return true;
}

function action(c: Check, f: Finding, period: number, fields: Omit<NewAction, "connectionId" | "userId" | "findingKey" | "period" | "deadline">): NewAction {
  return { connectionId: c.conn.id, userId: c.conn.userId, findingKey: f.key, period, deadline: f.deadline ?? null, ...fields };
}

// A step counts as announced while its row stands. A superseded one was withdrawn,
// so the same step coming back is news again.
const announced = (rows: ActionRow[], sig: string) => rows.find((a) => a.signature === sig && a.status !== "superseded");

/** notify, wait, ask_user: recorded as done, said once. */
async function tell(c: Check, step: Inform, period: number, now: Date): Promise<void> {
  const f = step.finding;
  const sig = signature(step.do, f.key, []);
  const rows = await history(c, f, period, now);
  // The engine no longer has one clear move for this, so a proposal for it is out of date.
  if (!(await supersede(c, rows))) return;
  if (announced(rows, sig)) return;
  const notice = inform(step, now);
  const row = await c.deps.store.insertAction(
    action(c, f, period, { kind: step.do, status: "done", moves: [], summary: notice.title, reason: problemOf(f), autoAt: null, signature: sig }),
  );
  const candidates = step.do === "ask_user" ? step.candidates : f.resolution.type === "judgment" ? f.resolution.candidates : [];
  const options = candidates.map((x) => ({ playerId: x.player.id, name: x.player.name, moves: x.moves }));
  await announce(c.deps, c.conn, notice, { actionId: row.id, findingKey: f.key, ...(options.length ? { candidates: options } : {}) });
  c.tally.notified++;
}

/** Why a Bench Protection user is being asked rather than told, when no guardrail says. */
function aside(c: Check): string | undefined {
  if (c.settings.authority !== "bench_protection") return undefined;
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

/** Why every automatic move on this connection waits for a tap. */
function connectionHold(c: Check): string | undefined {
  if (c.failedNow) return HELD_FAILED_NOW;
  if (c.failedEarlier) return HELD_FAILED_WEEK;
  if (c.unproven) return HELD_UNPROVEN;
  return undefined;
}

async function propose(c: Check, step: Propose, period: number, now: Date): Promise<void> {
  const f = step.finding;
  const moves = step.candidate.moves;
  const sig = signature("propose", f.key, moves);
  // Never promise an automatic move that a hold on the whole connection would stop.
  const wide = step.held?.autoAt ? connectionHold(c) : undefined;
  const held = wide ? { reason: wide } : step.held;
  const autoAt = held?.autoAt ?? null;
  const rows = await history(c, f, period, now);
  const same = announced(rows, sig);
  if (same) {
    // Already said. Except when it promised "automatically at 11:30", 11:30 has
    // come, and it is still only a proposal: the user must hear that it will not happen.
    const broken = same.status === "pending" && same.autoAt !== null && Date.parse(same.autoAt) <= now.getTime() && autoAt === null;
    if (!broken) return;
  }
  // Includes a pending proposal for the same finding with different moves.
  if (!(await supersede(c, rows))) return;
  const notice = proposal(f, step.candidate, held, now, aside(c));
  const row = await c.deps.store.insertAction(
    action(c, f, period, { kind: "propose", status: "pending", moves, summary: changeOf(f, step.candidate), reason: problemOf(f), autoAt, signature: sig }),
  );
  await announce(c.deps, c.conn, notice, { actionId: row.id, findingKey: f.key, moves, autoAt });
  c.tally.proposed++;
}

/** evaluate, plan and guard again on a fresh read, for the one finding about to be acted on. */
function replan(c: Check, roster: Roster, key: string, now: Date): Step | undefined {
  const f = evaluate(roster, now, c.settings).find((x) => x.key === key);
  if (!f) return undefined;
  return guard(plan(f, c.settings, now), { now, autoMovesToday: c.autoToday, readLooksSane: rosterLooksSane(roster), policy: c.policy });
}

/** Does the connection as it stands now still allow an automatic move? */
const automatic = (live: ConnectionRow): boolean =>
  live.status !== "paused" && (live.authority === "bench_protection" || live.authority === "ai_rescue") && live.benchSwaps;

async function execute(c: Check, step: Execute, period: number, now: Date): Promise<void> {
  const f = step.finding;
  const moves = step.candidate.moves;
  const sig = signature("execute", f.key, moves);
  const rows = await history(c, f, period, now);

  // Never twice: the same move made, failed or in flight is not made again.
  if (rows.some((a) => a.signature === sig)) return;
  // One automatic attempt per finding a week, a decline stands, and a write that did not
  // land, or a league where no change of the user's has landed yet, stops automatic moves.
  const hold = findingHold(rows) ?? connectionHold(c);
  if (hold) return propose(c, { do: "propose", finding: f, candidate: step.candidate, source: step.source, held: { reason: hold } }, period, now);

  // Re-validate immediately before the write. If the fresh read no longer gives these
  // exact moves as an execute, write nothing: the next check decides from scratch.
  const fresh = await readTeamPatiently(c.deps, c.espn, c.conn);
  c.latest = fresh;
  const at = c.deps.now();
  const again = replan(c, fresh, f.key, at);
  if (again?.do !== "execute" || signature("execute", f.key, again.candidate.moves) !== sig) return;

  // The last look before the write: while ESPN was read, the user may have declined or
  // approved, paused the league or lowered its protection. Their answer wins.
  const latest = await c.deps.store.actionsFor(c.conn.id, f.key, period);
  if (findingHold(latest) || latest.some((a) => a.signature === sig)) return;
  const live = await c.deps.store.getConnection(c.conn.id);
  if (!live || !automatic(live) || writeUnproven(live)) return;
  if (!(await supersede(c, latest))) return;

  // Recorded before the write, so a crash mid-write cannot lead to a second one.
  const row = await c.deps.store.insertAction(
    action(c, f, period, { kind: "execute", status: "approved", moves, summary: changeOf(f, step.candidate), reason: problemOf(f), autoAt: null, signature: sig }),
  );
  c.autoToday++;
  const who = playersIn(fresh);

  let out: Awaited<ReturnType<typeof writeAndVerify>>;
  try {
    out = await writeAndVerify(c.espn, c.conn, moves, fresh.period);
  } catch (e) {
    // The read back failed, so nothing is confirmed.
    c.failedNow = true;
    if (await failed(c.deps, c.conn, row, who, undefined, { error: errorText(e) }, c.deps.now())) c.tally.notified++;
    if (isSignedOut(e)) throw e;
    return;
  }
  c.latest = out.after;
  const done = c.deps.now();
  if (!out.applied) {
    c.failedNow = true;
    if (await failed(c.deps, c.conn, row, who, out.after, out.result, done)) c.tally.notified++;
    return;
  }
  if (!(await c.deps.store.updateAction(row.id, { status: "done", executedAt: done.toISOString(), result: out.result }, "approved"))) return;
  await announce(c.deps, c.conn, receipt(row.reason, moves, who, done), { actionId: row.id, findingKey: f.key, moves });
  c.tally.executed++;
}
