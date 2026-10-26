// One connection, one check: read ESPN, ask the engine, act within the guardrails,
// tell the user once. docs/BETA.md "Service" is the contract, in its order:
// credentials, connector, read, sanity, settings, evaluate, plan, guard, then each step;
// then AI Native's T-15 step (outside.ts) and the T-3 all-clear (docs/AI-NATIVE.md).

import {
  afterAi,
  effectiveAuthority,
  evaluate,
  guard,
  isHole,
  isStarting,
  plan,
  rosterLooksSane,
  type Finding,
  type Roster,
  type Step,
} from "@rosterbots/core";
import { MIN, action, announced, automatic, connectionHold, history, policyFor, propose, reasonOf, supersede, tickOf, userHold, type Check } from "./check.ts";
import {
  IncompleteReadError,
  addLanded,
  announce,
  connect,
  declinedHoles,
  errorText,
  failed,
  isSignedOut,
  landed,
  leaveUnconfirmed,
  noteWrite,
  readTeamPatiently,
  retryAt,
  settingsFor,
  signature,
  signedOut,
  unconfirmed,
  utcDayStart,
  writeAndVerify,
  writeUnproven,
} from "./ops.ts";
import { fillKeys, judgeInputFor, outside } from "./outside.ts";
import { inMinutes, minuteWindow, nextCheckAt, scheduleMissing } from "./read.ts";
import type { ActionRow, CheckSummary, ConnectionRow, Deps } from "./types.ts";
import { HELD_JUDGMENT, allClear, changeOf, incompleteRead, inform, playersIn, problemOf, receipt, withdrawn } from "./words.ts";

/**
 * A write still 'approved' after this long belongs to a run that died mid-write: a check
 * or an approval lasts at most 150 s, the Edge Function wall clock.
 */
const INTERRUPTED_MS = 3 * MIN;

/** The all-clear goes out this many minutes before a kickoff (docs/AI-NATIVE.md: T-3). */
const ALL_CLEAR_MINUTES = 3;

type Execute = Extract<Step, { do: "execute" }>;
type Inform = Extract<Step, { do: "notify" | "wait" | "ask_user" }>;

/** Why this read is not one to judge a lineup by, if it is not. */
function incompleteness(roster: Roster): string | undefined {
  if (!rosterLooksSane(roster)) return "the roster did not look right";
  if (scheduleMissing(roster)) return "no kickoff times came through";
  return undefined;
}

/** How many incomplete reads in a row before the user hears about it: one is ESPN's half payload. */
const INCOMPLETE_READS_BEFORE_TELLING = 3;

const incompleteKey = (period: number): string => `${period}:incomplete_read`;

/**
 * Counts an incomplete read, as a row of a finding of its own, and on the third in a row
 * tells the user, once a period: nothing is judged or automatic until a read looks right.
 */
async function unreadable(deps: Deps, conn: ConnectionRow, period: number, why: string): Promise<boolean> {
  const key = incompleteKey(period);
  const told = signature("notify", key, []);
  const rows = await deps.store.actionsFor(conn.id, key, period);
  if (rows.some((a) => a.signature === told)) return false;
  // Rows a whole read superseded were an earlier run; the ones still 'done' are this one.
  const run = rows.filter((a) => a.status === "done").length + 1;
  const sig = run < INCOMPLETE_READS_BEFORE_TELLING ? `${told}|#${run}` : told;
  const row = await deps.store.insertAction({
    connectionId: conn.id, userId: conn.userId, findingKey: key, period, kind: "notify", status: "done", moves: [],
    summary: "ESPN's data looked incomplete", reason: why, deadline: null, autoAt: null, signature: sig,
  });
  if (sig !== told) return false;
  await announce(deps, conn, incompleteRead(), { actionId: row.id, findingKey: key });
  return true;
}

/** A whole read ends a run of incomplete ones: the count starts again; the once-a-period notice stands. */
async function readable(deps: Deps, conn: ConnectionRow, period: number): Promise<void> {
  const key = incompleteKey(period);
  const told = signature("notify", key, []);
  for (const a of await deps.store.actionsFor(conn.id, key, period)) {
    if (a.status === "done" && a.signature !== told) await deps.store.updateAction(a.id, { status: "superseded" }, "done");
  }
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
    // Half a payload, or no kickoff times: not a lineup to judge, and not kept as the last
    // roster. A failed read instead, tried again within five minutes, said once if it goes on.
    const incomplete = incompleteness(first);
    if (incomplete) {
      if (await unreadable(deps, conn, first.period, incomplete)) tally.notified++;
      throw new IncompleteReadError(incomplete);
    }
    await readable(deps, conn, first.period);
    const settings = await settingsFor(deps, conn);
    check = {
      deps, conn, espn, settings,
      policy: policyFor(deps, conn),
      latest: first,
      autoToday: 0,
      failedNow: false,
      failedEarlier: false,
      unproven: writeUnproven(conn),
      release: new Set(),
      aiChoices: new Map(),
      reasons: new Map(),
      tally,
    };
    // Settled first, so the week's failures and the day's count below include them.
    await settle(check, first, now);
    check.failedEarlier = (await deps.store.failedWrites(conn.id, first.period)) > 0;
    check.autoToday = await deps.store.autoMovesSince(conn.id, utcDayStart(now));

    let found = evaluate(first, now, settings);
    check.release = await declinedHoles(deps.store, conn.id, found, first.period);
    if (check.release.size) found = evaluate(first, now, settings, check.release);
    findings = found.length;
    for (const f of found) {
      const step = guard(plan(f, settings, now), { now: tickOf(now), autoMovesToday: check.autoToday, readLooksSane: true, policy: check.policy });
      await act(check, step, first.period, now);
    }
    // This read is whole (an incomplete one never gets here), so a problem it no longer shows is gone.
    await withdraw(check, new Set(found.map((f) => f.key)), first.period, now);
    // AI Native, from T-15: a hole the bench could not fill, or a fill a free agent clearly beats.
    await outside(check, first.period, now);
    await allClearAt(check, first.period, now);

    const next = nextCheckAt(check.latest, now, minuteWindow(conn)).toISOString();
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
      // Try again soon, but not every minute: within 5 minutes, sooner if a kickoff is close,
      // judged by this read if it got that far and by the last one saved if not.
      const latest = check?.latest ?? first ?? null;
      const next = await retryAt(deps, conn, now, latest);
      // An incomplete read is not kept: Home judges the lineup by the last roster saved.
      const keep = latest && !(e instanceof IncompleteReadError) ? { lastRoster: latest } : {};
      await deps.store.saveCheck(conn.id, { lastCheckedAt: now.toISOString(), nextCheckAt: next, ...keep });
      return summary("error", next, errorText(e));
    } catch (inner) {
      return summary("error", inMinutes(now, 5), errorText(e) + "; then " + errorText(inner));
    }
  }
}

/**
 * Writes left 'approved': a run died mid-write, or ESPN could not be read back after it
 * (marked unconfirmed, and settled on the next read, without waiting). This check's read came
 * after them, so it says how they ended: a receipt if ESPN shows the change, ACTION_FAILED if not.
 */
async function settle(c: Check, roster: Roster, now: Date): Promise<void> {
  for (const a of await c.deps.store.openActions(c.conn.id)) {
    if (a.status !== "approved") continue;
    if (!unconfirmed(a) && now.getTime() - Date.parse(a.decidedAt ?? a.createdAt) < INTERRUPTED_MS) continue;
    const at = now.toISOString();
    if (a.period !== roster.period) {
      // Another week's: there is nothing left to check it against, or to tell.
      await c.deps.store.updateAction(a.id, { status: "failed", executedAt: at, result: { error: "interrupted" } }, "approved");
      continue;
    }
    const who = playersIn(roster);
    if (landed(a, roster)) {
      if (await c.deps.store.updateAction(a.id, { status: "done", executedAt: at, result: { interrupted: true } }, "approved")) {
        // An approval ESPN shows is the user's own change landing: the proof automation waits for.
        if (a.kind === "propose" || a.kind === "advise") await noteWrite(c.deps, c.conn, now);
        await announce(c.deps, c.conn, receipt(a.reason, a.moves, who, now, undefined, a.transaction), { actionId: a.id, findingKey: a.findingKey, moves: a.moves });
        c.tally.notified++;
      }
    } else {
      // An add that landed before the run died is still an add (the no-churn rule) and the receipt says so.
      const result = a.transaction && addLanded(a.transaction, roster) ? { error: "interrupted", stage: "lineup" } : { error: "interrupted" };
      if (await failed(c.deps, c.conn, a, who, roster, result, now)) c.tally.notified++;
    }
  }
}

/**
 * Proposals for a problem this check no longer sees. Past their deadline, or with a player
 * now locked, they just expire. Otherwise ESPN no longer shows the problem: withdrawn, and
 * said once, so a "Scheduled move" never sits there for a problem that went away. An add
 * proposal (AI Native's) is also for a fill RosterBots made that still stands; advice only
 * ever expires.
 */
async function withdraw(c: Check, keys: Set<string>, period: number, now: Date): Promise<void> {
  let fills: Set<string> | undefined;
  for (const a of await c.deps.store.openActions(c.conn.id)) {
    if (a.status !== "pending" || (a.kind !== "propose" && a.kind !== "advise")) continue;
    if (a.kind === "propose" && a.period === period && keys.has(a.findingKey)) continue;
    if (a.kind === "propose" && a.transaction && a.period === period && (fills ??= await fillKeys(c, period, now)).has(a.findingKey)) continue;
    const locked = a.moves.some((m) => c.latest.entries.find((e) => e.player.id === m.playerId)?.player.locked);
    const late = a.period !== period || locked || (a.deadline !== null && Date.parse(a.deadline) <= now.getTime());
    if (late) {
      await c.deps.store.updateAction(a.id, { status: "expired" }, "pending");
      continue;
    }
    if (a.kind === "advise") continue;
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
    case "consult_ai": {
      // A hole whose bench options all have something to doubt. AI Native asks the AI which
      // one; without an AI, or below AI Native, the user decides.
      const ai = c.deps.ai;
      const asUser: Step = { do: "ask_user", finding: step.finding, candidates: step.candidates };
      if (!ai || effectiveAuthority(c.settings) !== "ai_rescue") return tell(c, asUser, period, now);
      const f = step.finding;
      const choice = await ai.judge.pick(judgeInputFor(reasonOf(c, f), f.slot, f.deadline ?? f.starter?.game?.kickoff, step.candidates, now));
      const next = afterAi(step, choice, c.settings);
      // "Leave it" is no answer for a hole: the user decides.
      if (next.do === "notify" || next.do === "ask_user") return tell(c, asUser, period, now);
      if (next.do === "execute" && choice) c.aiChoices.set(f.key, choice);
      return act(c, guard(next, { now: tickOf(now), autoMovesToday: c.autoToday, readLooksSane: true, policy: c.policy }), period, now);
    }
    default:
      return tell(c, step, period, now);
  }
}

/** notify, wait, ask_user: recorded as done, said once. */
async function tell(c: Check, step: Inform, period: number, now: Date): Promise<void> {
  const f = step.finding;
  const sig = signature(step.do, f.key, []);
  // AI Native's add for this hole, if one is waiting, is outside.ts's question, not this one's.
  const rows = (await history(c, f, period, now)).filter((a) => !a.transaction);
  const candidates = step.do === "ask_user" ? step.candidates : f.resolution.type === "judgment" ? f.resolution.candidates : [];
  // A pending proposal whose moves are still among the options is still the right question,
  // and the user has it: a downgrade from one clear move to a choice is no reason to withdraw
  // it, or to ask twice. One whose fix the engine no longer offers is out of date.
  const fixes = new Set(candidates.map((x) => signature("propose", f.key, x.moves)));
  // Except one that promised "automatically at 2:35" when 2:35 has come and this is no
  // automatic move: it is withdrawn and the question asked, so the promise is not left
  // standing until kickoff (Oct 4 review).
  const broken = (a: ActionRow) => a.autoAt !== null && Date.parse(a.autoAt) <= now.getTime();
  const pending = rows.filter((a) => a.kind === "propose" && a.status === "pending");
  if (pending.some((a) => fixes.has(a.signature) && !broken(a))) return;
  // A broken promise whose fix is still one of the options stays one tap away: offered again,
  // approvable, saying it will not happen on its own.
  const kept = pending.find((a) => fixes.has(a.signature));
  const again = kept && candidates.find((x) => signature("propose", f.key, x.moves) === kept.signature);
  if (again) return propose(c, { do: "propose", finding: f, candidate: again, source: "rules", held: { reason: HELD_JUDGMENT } }, period, now);
  if (!(await supersede(c, rows))) return;
  if (!pending.some(broken) && announced(rows, sig)) return;
  const notice = inform(step, now);
  const row = await c.deps.store.insertAction(
    action(c, f, period, { kind: step.do, status: "done", moves: [], summary: notice.title, reason: problemOf(f), autoAt: null, signature: sig }),
  );
  const options = candidates.map((x) => ({ playerId: x.player.id, name: x.player.name, moves: x.moves }));
  await announce(c.deps, c.conn, notice, { actionId: row.id, findingKey: f.key, ...(options.length ? { candidates: options } : {}) });
  c.tally.notified++;
}

/**
 * evaluate, plan and guard again on a fresh read, for the one finding about to be acted on.
 * The AI's answer from this check stands for the re-read: the same option, judged the same way.
 */
function replan(c: Check, roster: Roster, key: string, now: Date): Step | undefined {
  const f = evaluate(roster, now, c.settings, c.release).find((x) => x.key === key);
  if (!f) return undefined;
  let step = plan(f, c.settings, now);
  if (step.do === "consult_ai") {
    const choice = c.aiChoices.get(key);
    if (choice) step = afterAi(step, choice, c.settings);
  }
  return guard(step, { now: tickOf(now), autoMovesToday: c.autoToday, readLooksSane: rosterLooksSane(roster), policy: c.policy });
}

async function execute(c: Check, first: Execute, period: number, now: Date): Promise<void> {
  const rows = await history(c, first.finding, period, now);
  let step = first;
  let f = step.finding;
  let moves = step.candidate.moves;
  let sig = signature("execute", f.key, moves);

  // Never twice at once: a write for it still in flight is the next check's to settle.
  if (rows.some((a) => a.signature === sig && a.status === "approved")) return;
  // A hole is filled again if it comes back (userHold); anything else gets one automatic
  // attempt a week. A decline stands, and a write that did not land, or a league where no
  // change of the user's has landed yet, stops automatic moves.
  const hold = userHold(f, rows) ?? connectionHold(c);
  if (hold) return propose(c, { do: "propose", finding: f, candidate: step.candidate, source: step.source, held: { reason: hold } }, period, now);

  // Re-validate immediately before the write. If the fresh read no longer gives this hole
  // an automatic fix, write nothing: the next check decides from scratch. If it gives a
  // different one (an earlier write in this check moved a player its route used), that one
  // was judged and guarded on the fresh read, so it is the one made: waiting a check for it
  // can lose the window's last minute (Oct 4 review).
  const readFrom = c.deps.now().getTime();
  const fresh = await readTeamPatiently(c.deps, c.espn, c.conn);
  c.latest = fresh;
  const at = c.deps.now();
  const again = replan(c, fresh, f.key, at);
  if (again?.do !== "execute") return;
  if (signature("execute", f.key, again.candidate.moves) !== sig) {
    step = again;
    f = step.finding;
    moves = step.candidate.moves;
    sig = signature("execute", f.key, moves);
  }

  // The last look before the write: while ESPN was read, the user may have declined or
  // approved, paused the league or lowered its protection. Their answer wins. A write of
  // these moves in flight, or one that finished after our fresh read began (that read cannot
  // show it), stops this one. One that finished before it, with the hole back on the read,
  // was undone in the ESPN app, and the hole is filled again (owner, Oct 4).
  const latest = await c.deps.store.actionsFor(c.conn.id, f.key, period);
  const recent = (a: ActionRow) => a.status === "approved" || (a.executedAt !== null && Date.parse(a.executedAt) >= readFrom);
  // Of either kind: an approval that finished while ESPN was read stops this one too.
  if (userHold(f, latest) || latest.some((a) => (a.kind === "execute" || a.kind === "propose") && recent(a))) return;
  const live = await c.deps.store.getConnection(c.conn.id);
  if (!live || !automatic(live) || writeUnproven(live)) return;
  if (!(await supersede(c, latest))) return;

  // Recorded before the write, so a crash mid-write cannot lead to a second one.
  const row = await c.deps.store.insertAction(
    action(c, f, period, { kind: "execute", status: "approved", moves, summary: changeOf(f, step.candidate), reason: reasonOf(c, f), autoAt: null, signature: sig }),
  );
  c.autoToday++;
  const who = playersIn(fresh);

  let out: Awaited<ReturnType<typeof writeAndVerify>>;
  try {
    out = await writeAndVerify(c.deps, c.espn, c.conn, moves, fresh.period);
  } catch (e) {
    // The read back failed, so nothing is confirmed either way: the next check's read settles
    // this one (settle) as done or failed. Not a failed write, so another hole in this check
    // still gets its own fresh read and its fill (Oct 4 review).
    await leaveUnconfirmed(c.deps, row, e);
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

/**
 * T-3 before each kickoff with a starter in it: the lineup is set for it, or what is still
 * wrong, once per kickoff per period. Every level, since every level can act in the app.
 */
async function allClearAt(c: Check, period: number, now: Date): Promise<void> {
  const roster = c.latest;
  const soon = new Set<string>();
  for (const e of roster.entries) {
    const k = e.player.game?.kickoff;
    if (!isStarting(e.slot) || !k) continue;
    const until = Date.parse(k) - now.getTime();
    if (until > 0 && until <= ALL_CLEAR_MINUTES * MIN) soon.add(k);
  }
  if (!soon.size) return;
  const found = evaluate(roster, now, c.settings, c.release);
  const open = await c.deps.store.openActions(c.conn.id);
  const waiting = open.filter((a) => a.status === "pending" && a.kind === "propose" && a.period === period && a.autoAt === null && (a.deadline === null || Date.parse(a.deadline) > now.getTime())).length;
  // A hole ESPN has already locked is past fixing, and still wrong: the engine skips it, this does not.
  const lockedHoles = (k: string): string[] =>
    roster.entries
      .filter((e) => isStarting(e.slot) && e.player.locked && e.player.game?.kickoff === k && isHole(e.player))
      .map((e) => {
        const p = e.player;
        const kind = p.game === null ? "starter_on_bye" : p.status === "out" || p.status === "ir" || p.status === "suspended" ? "starter_out" : "starter_zero";
        return problemOf({ key: "", kind, hard: true, slot: e.slot, starter: p, resolution: { type: "none", why: "locked" } });
      });
  for (const k of [...soon].sort()) {
    const key = `${period}:all_clear:${k}`;
    const sig = signature("notify", key, []);
    if ((await c.deps.store.actionsFor(c.conn.id, key, period)).some((a) => a.signature === sig)) continue;
    const wrong = [...found.filter((f) => f.hard && (f.kind === "empty_slot" || f.starter?.game?.kickoff === k)).map(problemOf), ...lockedHoles(k)];
    const notice = allClear(k, wrong, waiting, now);
    const row = await c.deps.store.insertAction({
      connectionId: c.conn.id, userId: c.conn.userId, findingKey: key, period, kind: "notify", status: "done", moves: [],
      summary: notice.title, reason: notice.body, deadline: k, autoAt: null, signature: sig,
    });
    await announce(c.deps, c.conn, notice, { actionId: row.id, findingKey: key, kickoff: k });
    c.tally.notified++;
  }
}
