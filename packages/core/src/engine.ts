// The rules engine. Roster in, findings out; finding in, one step out.
//
// Pure: no clock, no network, no randomness. The worker passes `now`. Everything
// HangoverBot does to a user's team starts here, so every rule is a test in
// test/engine.test.ts.

import {
  BENCH,
  isStarting,
  type Authority,
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
  // Owner, Oct 3: a player the provider projects for zero points never goes into the
  // lineup, automatically or as an option. ESPN's zero is its own "not playing" signal
  // and covers statuses the mapping has not seen (Josh Jacobs, day-to-day and suspended,
  // read as unknown on the first live read). A missing projection is not zero.
  if (p.projection !== undefined && p.projection <= 0) return false;
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

/**
 * Handoff section 9, in order: legal slot, not locked or started, then the user's
 * replacement order, then the highest projection. A player with anything to doubt
 * (questionable, schedule unknown) ranks after every clean one.
 */
function candidatesFor(slot: Slot, starter: Player | undefined, bench: RosterEntry[], now: number, order: string[]): Candidate[] {
  const rank = (p: Player) => {
    const i = order.indexOf(p.id);
    return i === -1 ? Infinity : i;
  };
  return bench
    .filter((e) => e.player.eligibleSlots.includes(slot) && viable(e.player, now))
    .map((e) => e.player)
    .sort(
      (a, b) =>
        Number(clean(b)) - Number(clean(a)) ||
        rank(a) - rank(b) ||
        (b.projection ?? -Infinity) - (a.projection ?? -Infinity),
    )
    .map((p) => ({
      player: p,
      moves: [
        ...(starter ? [{ playerId: starter.id, from: slot, to: BENCH }] : []),
        { playerId: p.id, from: BENCH, to: slot },
      ],
    }));
}

function earliest(...isos: (string | undefined)[]): string | undefined {
  const ms = isos.filter((s): s is string => Boolean(s)).map((s) => Date.parse(s));
  return ms.length ? new Date(Math.min(...ms)).toISOString() : undefined;
}

/**
 * The rules' answer, if they have one. They do when the top candidate is clean and
 * is ranked by something real: the user's order, a projection, or being alone.
 */
function rulesPick(cands: Candidate[], order: string[]): { candidate: Candidate; why: string } | undefined {
  const [top, next] = cands;
  if (!top || !clean(top.player)) return undefined;
  const p = top.player;
  if (!next || !clean(next.player)) return { candidate: top, why: `${p.name} is the only healthy option on the bench` };
  if (order.includes(p.id)) return { candidate: top, why: `${p.name} is next in your replacement order` };
  if (p.projection !== undefined) return { candidate: top, why: `${p.name} is your highest-projected eligible player` };
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

    if (p.kind === "starter_status_unknown") {
      findings.push({ ...base, resolution: { type: "none", why: "his status could not be read, so we are not touching him" } });
      continue;
    }

    const cands = candidatesFor(p.slot, p.starter, bench, t, settings.replacementOrder);
    if (!cands.length) {
      const why = hard ? "nobody on the bench can fill this slot" : "nobody healthy on the bench to replace him";
      findings.push({ ...base, resolution: { type: "none", why } });
      continue;
    }

    const pick = hard ? rulesPick(cands, settings.replacementOrder) : undefined;
    if (pick) {
      bench = bench.filter((e) => e.player.id !== pick.candidate.player.id);
      const deadline = earliest(p.starter?.game?.kickoff, pick.candidate.player.game?.kickoff);
      findings.push({ ...base, resolution: { type: "deterministic", ...pick }, ...(deadline ? { deadline } : {}) });
      continue;
    }

    const why = hard ? "no projection or replacement order to rank the options by" : `${p.starter?.name} might play`;
    const deadline = earliest(p.starter?.game?.kickoff, ...cands.map((c) => c.player.game?.kickoff));
    findings.push({ ...base, resolution: { type: "judgment", candidates: cands, why }, ...(deadline ? { deadline } : {}) });
  }
  return findings;
}

/** Anonymous users never get unattended writes (handoff section 18, owner-confirmed). */
export function effectiveAuthority(settings: Settings): Authority {
  if (settings.accountClaimed) return settings.authority;
  return settings.authority === "alerts" ? "alerts" : "ask_me";
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

  const authority = effectiveAuthority(settings);
  if (authority === "alerts") return { do: "notify", finding };

  if (r.type === "deterministic") {
    const auto = authority !== "ask_me" && settings.permissions.benchSwaps;
    return { do: auto ? "execute" : "propose", finding, candidate: r.candidate, source: "rules" };
  }
  // Judgment. AI is an AI Rescue feature; below it, the user makes the call.
  if (authority === "ai_rescue") return { do: "consult_ai", finding, candidates: r.candidates };
  return { do: "ask_user", finding, candidates: r.candidates };
}

export interface AiChoice {
  /** A candidate's player id, or null to leave the lineup alone. */
  playerId: string | null;
  confidence: number;
  reason: string;
}

/**
 * Turn the AI's answer into a step. The AI picks from the list it was given; an
 * answer naming anyone else is discarded and the user decides instead.
 */
export function afterAi(step: Extract<Step, { do: "consult_ai" }>, choice: AiChoice | undefined, settings: Settings): Step {
  const fallback: Step = { do: "ask_user", finding: step.finding, candidates: step.candidates };
  if (!choice) return fallback;
  if (choice.playerId === null) return { do: "notify", finding: step.finding };
  const candidate = step.candidates.find((c) => c.player.id === choice.playerId);
  if (!candidate) return fallback;
  const auto =
    effectiveAuthority(settings) === "ai_rescue" && settings.permissions.benchSwaps && choice.confidence >= settings.minAiConfidence;
  return { do: auto ? "execute" : "propose", finding: step.finding, candidate, source: "ai" };
}

/** Did the platform actually apply these moves? Checked against a fresh read. */
export function applied(moves: { playerId: string; to: Slot }[], after: Roster): boolean {
  return moves.every((m) => after.entries.find((e) => e.player.id === m.playerId)?.slot === m.to);
}
