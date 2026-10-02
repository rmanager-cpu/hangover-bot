// The rules engine. Roster in, findings out; finding in, one step out.
//
// Pure: no clock, no network, no randomness. The worker passes `now`. Everything
// HangoverBot does to a user's team starts here, so every rule is a test in
// test/engine.test.ts.

import {
  BENCH,
  isStarting,
  type Candidate,
  type Finding,
  type FindingKind,
  type Player,
  type Roster,
  type RosterEntry,
  type Settings,
  type Slot,
  type Step,
} from "./types.ts";

const HARD: readonly FindingKind[] = ["empty_slot", "starter_on_bye", "starter_out"];

/** How long before a soft finding's kickoff we start deciding it: the inactives window plus margin. */
export const JUDGMENT_LEAD_MINUTES = 100;

const kickoffMs = (p: Player): number | undefined => (p.game ? Date.parse(p.game.kickoff) : undefined);

/** Could this player start right now, if moved? */
function viable(p: Player, now: number): boolean {
  if (p.locked) return false;
  if (p.status !== "active" && p.status !== "questionable") return false;
  if (p.game === null) return false; // bye
  const k = kickoffMs(p);
  if (k !== undefined && k <= now) return false;
  return true;
}

/** Viable and nothing about him needs a second opinion. */
const clean = (p: Player): boolean => p.status === "active" && p.game != null;

function classify(p: Player): FindingKind | undefined {
  if (p.game === null) return "starter_on_bye";
  if (p.status === "out" || p.status === "ir" || p.status === "suspended") return "starter_out";
  if (p.status === "doubtful") return "starter_doubtful";
  if (p.status === "questionable") return "starter_questionable";
  if (p.status === "unknown") return "starter_status_unknown";
  return undefined;
}

function candidatesFor(slot: Slot, starter: Player | undefined, bench: RosterEntry[], now: number): Candidate[] {
  return bench
    .filter((e) => e.player.eligibleSlots.includes(slot) && viable(e.player, now))
    .sort((a, b) => (b.player.projection ?? -Infinity) - (a.player.projection ?? -Infinity))
    .map((e) => ({
      player: e.player,
      moves: [
        ...(starter ? [{ playerId: starter.id, from: slot, to: BENCH }] : []),
        { playerId: e.player.id, from: BENCH, to: slot },
      ],
    }));
}

function earliest(...isos: (string | undefined)[]): string | undefined {
  const ms = isos.filter((s): s is string => Boolean(s)).map((s) => Date.parse(s));
  return ms.length ? new Date(Math.min(...ms)).toISOString() : undefined;
}

/** Is the best candidate clearly the right call, with no judgment needed? */
function obviousPick(cands: Candidate[], margin: number): { candidate: Candidate; why: string } | undefined {
  const [top, next] = cands;
  if (!top || !clean(top.player)) return undefined;
  if (!next) return { candidate: top, why: `${top.player.name} is the only healthy option on the bench` };
  const a = top.player.projection;
  const b = next.player.projection;
  if (a === undefined || b === undefined) return undefined;
  if (a - b >= margin) {
    return { candidate: top, why: `${top.player.name} projects ${(a - b).toFixed(1)} points more than the next option` };
  }
  return undefined;
}

export function evaluate(roster: Roster, now: Date, settings: Settings): Finding[] {
  const t = now.getTime();
  let bench = roster.entries.filter((e) => e.slot === BENCH);
  const starters = roster.entries.filter((e) => isStarting(e.slot));

  // A problem is a starter we could still move, or a starting slot nobody fills.
  type Problem = { kind: FindingKind; slot: Slot; starter?: Player; index: number };
  const problems: Problem[] = [];
  for (const e of starters) {
    if (e.player.locked) continue;
    const kind = classify(e.player);
    if (kind) problems.push({ kind, slot: e.slot, starter: e.player, index: 0 });
  }
  const filled = new Map<Slot, number>();
  for (const e of starters) filled.set(e.slot, (filled.get(e.slot) ?? 0) + 1);
  const needed = new Map<Slot, number>();
  for (const s of roster.starterSlots) needed.set(s, (needed.get(s) ?? 0) + 1);
  for (const [slot, n] of needed) {
    for (let i = filled.get(slot) ?? 0; i < n; i++) problems.push({ kind: "empty_slot", slot, index: i });
  }

  // Hard problems claim bench players first, soonest kickoff first.
  const order = (p: Problem) => (HARD.includes(p.kind) ? 0 : 1);
  const soon = (p: Problem) => (p.starter ? kickoffMs(p.starter) ?? Infinity : Infinity);
  problems.sort((a, b) => order(a) - order(b) || soon(a) - soon(b));

  const findings: Finding[] = [];
  for (const p of problems) {
    const hard = HARD.includes(p.kind);
    const key = `${roster.period}:${p.kind}:${p.starter ? p.starter.id : p.slot + "#" + p.index}`;
    const base = { key, kind: p.kind, hard, slot: p.slot, ...(p.starter ? { starter: p.starter } : {}) };

    if (p.starter && settings.pinned.includes(p.starter.id)) {
      findings.push({ ...base, resolution: { type: "none", why: `${p.starter.name} is pinned, so he stays` } });
      continue;
    }
    if (p.kind === "starter_status_unknown") {
      findings.push({ ...base, resolution: { type: "none", why: "his status could not be read, so we are not touching him" } });
      continue;
    }

    const cands = candidatesFor(p.slot, p.starter, bench, t);
    if (!cands.length) {
      const why = hard ? "nobody on the bench can fill this slot" : "nobody healthy on the bench to replace him";
      findings.push({ ...base, resolution: { type: "none", why } });
      continue;
    }

    const pick = hard ? obviousPick(cands, settings.obviousMargin) : undefined;
    if (pick) {
      bench = bench.filter((e) => e.player.id !== pick.candidate.player.id);
      const deadline = earliest(p.starter?.game?.kickoff, pick.candidate.player.game?.kickoff);
      findings.push({ ...base, resolution: { type: "obvious", ...pick }, ...(deadline ? { deadline } : {}) });
      continue;
    }

    const why = hard ? "more than one reasonable replacement" : `${p.starter?.name} might play`;
    const deadline = earliest(p.starter?.game?.kickoff, ...cands.map((c) => c.player.game?.kickoff));
    findings.push({ ...base, resolution: { type: "judgment", candidates: cands, why }, ...(deadline ? { deadline } : {}) });
  }
  return findings;
}

/** What to do about one finding, given what the user allows. */
export function plan(finding: Finding, settings: Settings, now: Date): Step {
  const r = finding.resolution;
  if (r.type === "none") return { do: "notify", finding };

  // A soft problem is decided close to kickoff, when the news is in. Until then, a heads-up.
  const kick = finding.starter?.game?.kickoff;
  if (!finding.hard && kick) {
    const until = new Date(Date.parse(kick) - JUDGMENT_LEAD_MINUTES * 60_000);
    if (now < until) return { do: "wait", finding, until: until.toISOString() };
  }

  if (settings.authority === "alert") return { do: "notify", finding };

  if (r.type === "obvious") {
    const act = settings.authority === "confirm" ? "propose" : "execute";
    return { do: act, finding, candidate: r.candidate, source: "rules" };
  }
  return {
    do: "consult_ai",
    finding,
    candidates: r.candidates,
    then: settings.authority === "full" ? "execute_if_confident" : "propose",
  };
}

export interface AiChoice {
  /** A candidate's player id, or null to leave the lineup alone. */
  playerId: string | null;
  confidence: number;
  reason: string;
}

/**
 * Turn the AI's answer into a step. The AI picks from the list it was given; an
 * answer naming anyone else is discarded and the user is told instead.
 */
export function afterAi(step: Extract<Step, { do: "consult_ai" }>, choice: AiChoice | undefined, settings: Settings): Step {
  if (!choice || choice.playerId === null) return { do: "notify", finding: step.finding };
  const candidate = step.candidates.find((c) => c.player.id === choice.playerId);
  if (!candidate) return { do: "notify", finding: step.finding };
  const confident = choice.confidence >= settings.minAiConfidence;
  const act = step.then === "execute_if_confident" && confident ? "execute" : "propose";
  return { do: act, finding: step.finding, candidate, source: "ai" };
}

/** Did the platform actually apply these moves? Checked against a fresh read. */
export function applied(moves: { playerId: string; to: Slot }[], after: Roster): boolean {
  return moves.every((m) => after.entries.find((e) => e.player.id === m.playerId)?.slot === m.to);
}
