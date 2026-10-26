// AI Native's T-15 step (docs/AI-NATIVE.md): for a hole the bench could not fill, or one
// RosterBots filled from the bench at T-90, look outside the roster. The code builds the
// options under the No-Cray Rules (core.outsideCandidates), the AI picks one, and the add
// goes through the same proof, re-read, write and verify as every other move. Anything a
// rule stops becomes a question for the user; an AI that does not answer in time is tried
// again next minute, and from T-8 the best option is offered for a tap.

import {
  AI_WINDOW,
  BENCH,
  afterAi,
  effectiveAuthority,
  evaluate,
  guard,
  isStarting,
  outsideCandidates,
  type Candidate,
  type Finding,
  type FreeAgent,
  type JudgeInput,
  type Player,
  type Roster,
  type Slot,
  type Step,
} from "@rosterbots/core";
import { MIN, action, announced, automatic, connectionHold, history, propose, reasonOf, supersede, tickOf, userHold, type Check } from "./check.ts";
import { announce, failed, isSignedOut, leaveUnconfirmed, outsideHistory, readTeamPatiently, signature, storedTransaction, writeUnproven, writeOutsideAndVerify } from "./ops.ts";
import type { ActionRow } from "./types.ts";
import { HELD_ASK, changeOf, howText, nothingOutside, playersIn, receipt, type Lookup } from "./words.ts";

type Execute = Extract<Step, { do: "execute" }>;

/** A slot AI Native may fill from outside: a hole with no bench fix, or RosterBots' own fill. */
interface Target {
  kind: "unfilled" | "fill";
  finding: Finding;
  slot: Slot;
  /** Who is in the slot: the hole's starter, or the fill. Absent for an empty slot. */
  occupant?: Player;
  /** What the slot gets without going outside. */
  baseline: number;
  /** When the slot locks. */
  deadline: string;
}

const kickoffOf = (p: Player | undefined): string | undefined => p?.game?.kickoff;

/** The earliest kickoff still ahead among the starters: an empty slot locks with them. */
function nextLock(roster: Roster, now: Date): string | undefined {
  let best: string | undefined;
  for (const e of roster.entries) {
    const k = kickoffOf(e.player);
    if (!isStarting(e.slot) || !k || Date.parse(k) <= now.getTime()) continue;
    if (!best || Date.parse(k) < Date.parse(best)) best = k;
  }
  return best;
}

/** The move that put a bench player into the lineup: the fill. */
export const fillOf = (a: ActionRow) => a.moves.find((m) => m.from === BENCH && isStarting(m.to));

/** The holes whose fill RosterBots made this period still stands: an add proposal for one of them is still a live question. */
export async function fillKeys(c: Check, period: number, now: Date): Promise<Set<string>> {
  const out = new Set<string>();
  for (const a of await c.deps.store.doneExecutes(c.conn.id, period)) {
    const m = fillOf(a);
    const e = m && c.latest.entries.find((x) => x.player.id === m.playerId);
    const k = e && kickoffOf(e.player);
    if (e && m && e.slot === m.to && !e.player.locked && k && Date.parse(k) > now.getTime()) out.add(a.findingKey);
  }
  return out;
}

async function targetsFor(c: Check, period: number, now: Date): Promise<Target[]> {
  const out: Target[] = [];
  const roster = c.latest;
  // Holes on the newest read: the bench fixes made earlier in this check are in it.
  for (const f of evaluate(roster, now, c.settings, c.release)) {
    if (!f.hard || f.resolution.type === "deterministic") continue;
    const cands = f.resolution.type === "judgment" ? f.resolution.candidates : [];
    const baseline = Math.max(0, ...cands.map((x) => x.player.projection ?? 0));
    const deadline = f.deadline ?? kickoffOf(f.starter) ?? nextLock(roster, now);
    if (!deadline) continue;
    // A hole with no fix has no deadline of its own; the guard needs one to judge the window by.
    out.push({ kind: "unfilled", finding: { ...f, deadline }, slot: f.slot, ...(f.starter ? { occupant: f.starter } : {}), baseline, deadline });
  }
  // RosterBots' own fills this week, still where they were put and not yet kicked off.
  for (const a of await c.deps.store.doneExecutes(c.conn.id, period)) {
    const m = fillOf(a);
    if (!m) continue;
    const e = roster.entries.find((x) => x.player.id === m.playerId);
    const k = e && kickoffOf(e.player);
    if (!e || e.slot !== m.to || e.player.locked || !k || Date.parse(k) <= now.getTime() || e.player.projection === undefined) continue;
    if (out.some((t) => t.finding.key === a.findingKey)) continue;
    const finding: Finding = { key: a.findingKey, kind: "starter_out", hard: true, slot: m.to, starter: e.player, resolution: { type: "none", why: "filled from the bench" }, deadline: k };
    c.reasons.set(a.findingKey, a.reason);
    out.push({ kind: "fill", finding, slot: m.to, occupant: e.player, baseline: e.player.projection, deadline: k });
  }
  return out;
}

const inWindow = (t: Target, now: Date, untilMinutes: number): boolean => {
  const d = Date.parse(t.deadline);
  return now.getTime() >= d - AI_WINDOW.fromMinutes * MIN && now.getTime() <= d - untilMinutes * MIN;
};
const lastTry = (t: Target, now: Date): boolean => now.getTime() >= Date.parse(t.deadline) - AI_WINDOW.lastTryMinutes * MIN;

/** What the AI is asked about one hole: the problem, the slot, when it locks, and the options the code built. */
export function judgeInputFor(problem: string, slot: Slot, kickoff: string | undefined, options: Candidate[], now: Date, benchFill?: { name: string; projection?: number }): JudgeInput {
  return {
    problem: `${problem} at ${slot}`,
    slot,
    now: now.toISOString(),
    ...(kickoff ? { kickoff } : {}),
    ...(benchFill ? { benchFill } : {}),
    candidates: options.map((o) => ({
      id: o.player.id,
      name: o.player.name,
      position: o.player.position,
      proTeam: o.player.proTeam,
      status: o.player.status,
      ...(o.player.projection !== undefined ? { projection: o.player.projection } : {}),
      ...(o.player.seasonProjection !== undefined ? { seasonProjection: o.player.seasonProjection } : {}),
      ...(o.player.percentRostered !== undefined ? { percentRostered: o.player.percentRostered } : {}),
      ...(o.player.game?.kickoff ? { kickoff: o.player.game.kickoff } : {}),
      ...(o.player.game?.opponent ? { opponent: o.player.game.opponent } : {}),
      how: o.add ? `free agent, ${howText(o.add.room)}` : "bench",
    })),
  };
}

function judgeInput(c: Check, t: Target, options: Candidate[], now: Date): JudgeInput {
  const fill = t.kind === "fill" && t.occupant ? { name: t.occupant.name, ...(t.occupant.projection !== undefined ? { projection: t.occupant.projection } : {}) } : undefined;
  return judgeInputFor(reasonOf(c, t.finding), t.slot, t.deadline, options, now, fill);
}

const askFor = (t: Target, candidate: Candidate, why: string): Extract<Step, { do: "propose" }> => ({
  do: "propose",
  finding: t.finding,
  candidate,
  source: "rules",
  held: { reason: HELD_ASK + why },
});

/** Said once per finding: nothing outside the roster fits either. */
async function noteNothing(c: Check, t: Target, period: number, now: Date, why: string | undefined): Promise<void> {
  const key = t.finding.key;
  const sig = signature("notify", key, []) + "|outside";
  const rows = await history(c, t.finding, period, now);
  if (announced(rows, sig)) return;
  const notice = nothingOutside(t.slot, why);
  const row = await c.deps.store.insertAction(action(c, t.finding, period, { kind: "notify", status: "done", moves: [], summary: notice.title, reason: reasonOf(c, t.finding), autoAt: null, signature: sig }));
  await announce(c.deps, c.conn, notice, { actionId: row.id, findingKey: key });
  c.tally.notified++;
}

/** The T-15 step. Throws only for a sign-out, which the check handles. */
export async function outside(c: Check, period: number, now: Date): Promise<void> {
  const ai = c.deps.ai;
  if (!ai || effectiveAuthority(c.settings) !== "ai_rescue") return;
  const targets = (await targetsFor(c, period, now)).filter((t) => inWindow(t, now, c.policy.autoUntilMinutes));
  if (!targets.length) return;

  let freeAgents: FreeAgent[];
  try {
    freeAgents = await c.espn.getFreeAgents(c.conn.leagueId, period, { slots: [...new Set(targets.map((t) => t.slot))] });
  } catch (e) {
    // ESPN did not answer: next minute's check tries again.
    if (isSignedOut(e)) throw e;
    return;
  }
  const hist = await outsideHistory(c.deps.store, c.conn.id, period);

  for (const t of targets) {
    const out = outsideCandidates(freeAgents, {
      roster: c.latest, settings: c.settings, now, history: hist, slot: t.slot, baseline: t.baseline, purpose: "hole",
      ...(t.occupant ? { occupant: t.occupant } : {}),
    });
    if (out.moves.length) {
      const choice = await ai.judge.pick(judgeInput(c, t, out.moves, now));
      if (!choice) {
        if (lastTry(t, now)) await propose(c, askFor(t, out.moves[0]!, "the AI did not answer in time"), period, now);
        continue;
      }
      const step = afterAi({ do: "consult_ai", finding: t.finding, candidates: out.moves }, choice, c.settings);
      if (step.do === "notify") {
        // The AI says leave it: for an unfilled hole that is news; a fill it leaves alone is silence.
        if (t.kind === "unfilled") await noteNothing(c, t, period, now, choice.reason || undefined);
        continue;
      }
      if (step.do === "ask_user") {
        await propose(c, askFor(t, out.moves[0]!, "the AI's answer named nobody on the list"), period, now);
        continue;
      }
      const guarded = guard(step, { now: tickOf(now), autoMovesToday: c.autoToday, readLooksSane: true, policy: c.policy });
      if (guarded.do === "execute") await executeOutside(c, guarded, t, period, now);
      else if (guarded.do === "propose") await propose(c, guarded, period, now);
    } else if (out.asks.length) {
      const top = out.asks[0]!;
      await propose(c, askFor(t, top.candidate, top.why), period, now);
    } else if (t.kind === "unfilled") {
      await noteNothing(c, t, period, now, out.rejected[0]?.why);
    }
  }
}

/** The occupant is still where the target says, or the slot is still empty. */
function unchanged(t: Target, fresh: Roster): Player | undefined | false {
  if (t.occupant) {
    const e = fresh.entries.find((x) => x.player.id === t.occupant!.id);
    return e && e.slot === t.slot && !e.player.locked ? e.player : false;
  }
  const filled = fresh.entries.filter((e) => e.slot === t.slot).length;
  const room = fresh.starterSlots.filter((s) => s === t.slot).length;
  return filled < room ? undefined : false;
}

async function executeOutside(c: Check, step: Execute, t: Target, period: number, now: Date): Promise<void> {
  const f = step.finding;
  const tx = storedTransaction(step.candidate);
  const sig = signature("execute", f.key, step.candidate.moves, tx);
  const rows = await history(c, f, period, now);
  if (rows.some((a) => a.signature === sig && a.status === "approved")) return;
  const hold = userHold(f, rows) ?? connectionHold(c);
  if (hold) return propose(c, { do: "propose", finding: f, candidate: step.candidate, source: step.source, held: { reason: hold } }, period, now);

  // The same option must come out again on a fresh read of the team and the free agents,
  // under the same rules, before anything is written.
  const readFrom = c.deps.now().getTime();
  const fresh = await readTeamPatiently(c.deps, c.espn, c.conn);
  c.latest = fresh;
  const occupant = unchanged(t, fresh);
  if (occupant === false) return;
  let freeAgents: FreeAgent[];
  try {
    freeAgents = await c.espn.getFreeAgents(c.conn.leagueId, period, { slots: [t.slot] });
  } catch (e) {
    if (isSignedOut(e)) throw e;
    return;
  }
  const hist = await outsideHistory(c.deps.store, c.conn.id, period);
  const at = c.deps.now();
  const again = outsideCandidates(freeAgents, {
    roster: fresh, settings: c.settings, now: at, history: hist, slot: t.slot, baseline: t.baseline, purpose: "hole",
    ...(occupant ? { occupant } : {}),
  }).moves.find((x) => signature("execute", f.key, x.moves, storedTransaction(x)) === sig);
  if (!again) return;
  const guarded = guard({ ...step, candidate: again }, { now: tickOf(at), autoMovesToday: c.autoToday, readLooksSane: true, policy: c.policy });
  if (guarded.do !== "execute") return;

  // The last look before the write, as for a bench move: the user's answer wins, and so does
  // a write of either kind in flight or finished since the fresh read began.
  const latest = await c.deps.store.actionsFor(c.conn.id, f.key, period);
  const recent = (a: ActionRow) => a.status === "approved" || (a.executedAt !== null && Date.parse(a.executedAt) >= readFrom);
  if (userHold(f, latest) || latest.some((a) => (a.kind === "execute" || a.kind === "propose") && recent(a))) return;
  const live = await c.deps.store.getConnection(c.conn.id);
  if (!live || !automatic(live) || live.authority !== "ai_rescue" || writeUnproven(live)) return;
  if (!(await supersede(c, latest))) return;

  const moves = again.moves;
  const row = await c.deps.store.insertAction(
    action(c, f, period, { kind: "execute", status: "approved", moves, summary: changeOf(f, again), reason: reasonOf(c, f), autoAt: null, signature: sig, transaction: tx }),
  );
  c.autoToday++;
  const roster = playersIn(fresh);
  const who: Lookup = (id) => roster(id) ?? freeAgents.find((x) => x.player.id === id)?.player;

  let out: Awaited<ReturnType<typeof writeOutsideAndVerify>>;
  try {
    out = await writeOutsideAndVerify(c.deps, c.espn, c.conn, again, fresh.period);
  } catch (e) {
    await leaveUnconfirmed(c.deps, row, e);
    if (isSignedOut(e)) throw e;
    return;
  }
  c.latest = out.after;
  const done = c.deps.now();
  if (!out.applied) {
    c.failedNow = true;
    if (await failed(c.deps, c.conn, { ...row, moves: out.moves.length ? out.moves : moves }, who, out.after, { ...out.result, stage: out.stage }, done)) c.tally.notified++;
    return;
  }
  if (!(await c.deps.store.updateAction(row.id, { status: "done", executedAt: done.toISOString(), result: out.result }, "approved"))) return;
  await announce(c.deps, c.conn, receipt(row.reason, out.moves, who, done, undefined, tx), { actionId: row.id, findingKey: f.key, moves: out.moves, transaction: tx });
  c.tally.executed++;
}
