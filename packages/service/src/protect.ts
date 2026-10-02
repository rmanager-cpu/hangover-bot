// One connection, one check: read ESPN, ask the engine, act within the guardrails,
// tell the user once. docs/BETA.md "Service" is the contract, in its order:
// credentials, connector, read, sanity, settings, evaluate, plan, guard, then each step.

import {
  DEFAULT_SETTINGS,
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
  readTeam,
  signature,
  signedOut,
  utcDayStart,
  writeAndVerify,
} from "./ops.ts";
import { nextCheckAt } from "./read.ts";
import type { ActionRow, CheckSummary, ConnectionRow, Deps, NewAction } from "./types.ts";
import {
  HELD_DECLINED,
  HELD_FAILED,
  HELD_FAILED_NOW,
  HELD_TRIED,
  changeOf,
  inform,
  playersIn,
  problemOf,
  proposal,
  receipt,
} from "./words.ts";

const MIN = 60_000;

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
  /** A write failed earlier in this check: no more automatic ones in it. */
  writeFailed: boolean;
  tally: { executed: number; proposed: number; notified: number };
}

/** The connection's settings as the engine reads them. */
async function settingsFor(deps: Deps, conn: ConnectionRow): Promise<Settings> {
  return {
    ...DEFAULT_SETTINGS,
    // AI Rescue is not offered in the beta: it gets Bench Protection's automation and no AI.
    authority: conn.authority === "ai_rescue" ? "bench_protection" : conn.authority,
    accountClaimed: await deps.store.accountClaimed(conn.userId),
    permissions: { ...DEFAULT_SETTINGS.permissions, benchSwaps: conn.benchSwaps },
    replacementOrder: conn.replacementOrder ?? [],
  };
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
      if (await signedOut(deps, conn, now, null)) tally.notified++;
      return summary("needs_reauth", new Date(now.getTime() + 60 * MIN));
    }
    first = await readTeam(espn, conn);
    const sane = rosterLooksSane(first);
    const settings = await settingsFor(deps, conn);
    check = {
      deps, conn, espn, settings,
      policy: policyFor(deps, conn),
      latest: first,
      autoToday: await deps.store.autoMovesSince(conn.id, utcDayStart(now)),
      writeFailed: false,
      tally,
    };

    const found = evaluate(first, now, settings);
    findings = found.length;
    for (const f of found) {
      const step = guard(plan(f, settings, now), { now, autoMovesToday: check.autoToday, readLooksSane: sane, policy: check.policy });
      await act(check, step, first.period, now);
    }

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
        if (await signedOut(deps, conn, now, e)) tally.notified++;
        return summary("needs_reauth", new Date(now.getTime() + 60 * MIN));
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
      await c.deps.store.updateAction(a.id, { status: "expired" });
      out.push({ ...a, status: "expired" });
    } else out.push(a);
  }
  return out;
}

async function supersede(c: Check, rows: ActionRow[]): Promise<void> {
  for (const a of rows) if (a.status === "pending") await c.deps.store.updateAction(a.id, { status: "superseded" });
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

async function propose(c: Check, step: Propose, period: number, now: Date): Promise<void> {
  const f = step.finding;
  const moves = step.candidate.moves;
  const sig = signature("propose", f.key, moves);
  const autoAt = step.held?.autoAt ?? null;
  const rows = await history(c, f, period, now);
  const same = announced(rows, sig);
  if (same) {
    // Already said. Except when it promised "automatically at 11:30", 11:30 has
    // come, and it is still only a proposal: the user must hear that it will not happen.
    const broken = same.status === "pending" && same.autoAt !== null && Date.parse(same.autoAt) <= now.getTime() && autoAt === null;
    if (!broken) return;
  }
  // Includes a pending proposal for the same finding with different moves.
  await supersede(c, rows);
  const notice = proposal(f, step.candidate, step.held, now, aside(c));
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

async function execute(c: Check, step: Execute, period: number, now: Date): Promise<void> {
  const f = step.finding;
  const moves = step.candidate.moves;
  const sig = signature("execute", f.key, moves);
  const rows = await history(c, f, period, now);

  // Never twice: the same move made, failed or in flight is not made again.
  if (rows.some((a) => a.signature === sig)) return;
  // One automatic attempt per finding a week, and a decline stands. Anything after is the user's to approve.
  const executes = rows.filter((a) => a.kind === "execute");
  const hold = executes.some((a) => a.status === "failed")
    ? HELD_FAILED
    : executes.length
      ? HELD_TRIED
      : rows.some((a) => a.status === "declined")
        ? HELD_DECLINED
        : c.writeFailed
          ? HELD_FAILED_NOW
          : undefined;
  if (hold) return propose(c, { do: "propose", finding: f, candidate: step.candidate, source: step.source, held: { reason: hold } }, period, now);

  // Re-validate immediately before the write. If the fresh read no longer gives these
  // exact moves as an execute, write nothing: the next check decides from scratch.
  const fresh = await readTeam(c.espn, c.conn);
  c.latest = fresh;
  const at = c.deps.now();
  const again = replan(c, fresh, f.key, at);
  if (again?.do !== "execute" || signature("execute", f.key, again.candidate.moves) !== sig) return;

  await supersede(c, rows);
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
    c.writeFailed = true;
    await failed(c.deps, c.conn, row, who, undefined, { error: errorText(e) }, c.deps.now());
    c.tally.notified++;
    if (isSignedOut(e)) throw e;
    return;
  }
  c.latest = out.after;
  const done = c.deps.now();
  if (!out.applied) {
    c.writeFailed = true;
    await failed(c.deps, c.conn, row, who, out.after, out.result, done);
    c.tally.notified++;
    return;
  }
  await c.deps.store.updateAction(row.id, { status: "done", executedAt: done.toISOString(), result: out.result });
  await announce(c.deps, c.conn, receipt(row.reason, moves, who, done), { actionId: row.id, findingKey: f.key, moves });
  c.tally.executed++;
}
