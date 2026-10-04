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
  type Move,
  type Player,
  type Roster,
  type RosterEntry,
  type Settings,
  type Slot,
  type Step,
} from "./types.ts";

const HARD: readonly FindingKind[] = ["empty_slot", "starter_on_bye", "starter_out", "starter_zero"];

/** How many starters may shift to fill one hole. A bound, not a target. */
const MAX_SHIFTS = 3;

/** How long before a soft finding's kickoff we start deciding it: the inactives window plus margin. */
export const JUDGMENT_LEAD_MINUTES = 100;

const kickoffMs = (p: Player): number | undefined => (p.game ? Date.parse(p.game.kickoff) : undefined);

/**
 * Could this player start right now, if moved? Active or questionable. For a hole (`hole`)
 * a doubtful player ESPN still projects for points too, as the last resort: owner, Oct 4,
 * "never a situation in which an injured player with a 0 projection is in your starting
 * lineup", and the projection is the source of truth for movement (Oct 3).
 */
function viable(p: Player, now: number, hole: boolean): boolean {
  if (p.locked) return false;
  const doubtfulButProjected = hole && p.status === "doubtful" && p.projection !== undefined && p.projection > 0;
  if (p.status !== "active" && p.status !== "questionable" && !doubtfulButProjected) return false;
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

/** How much there is to doubt about an option: clean, then questionable, then doubtful. */
const doubt = (p: Player): number => (clean(p) ? 0 : p.status === "doubtful" ? 2 : 1);

/**
 * Good enough to fill a hole without asking: clean, or doubted but with a known kickoff and
 * a projection above zero. Anything beats a starter certain to score nothing (owner, Oct 4).
 */
const fillsHole = (p: Player): boolean => clean(p) || (p.game != null && p.projection !== undefined && p.projection > 0);

/** A known kickoff that has come: ESPN may not have flagged him locked yet, but he cannot move. */
const started = (p: Player, now: number): boolean => {
  const k = kickoffMs(p);
  return k !== undefined && k <= now;
};

/**
 * A starter who could take another starting slot right now. He is already in, so the
 * question is only whether ESPN would let him move: a pivot is playing (owner, Oct 3: a
 * projection is the source of truth, so a questionable or doubtful starter ESPN still
 * projects is playing), with a known kickoff still ahead, never a hole of his own, on bye,
 * or on a team ESPN's schedule did not send. Moving him keeps him in the lineup either way.
 */
function shiftable(p: Player, now: number): boolean {
  if (p.locked) return false;
  const projected = p.projection !== undefined && p.projection > 0;
  if (p.status !== "active" && p.status !== "questionable" && !(p.status === "doubtful" && projected)) return false;
  if (p.game == null) return false; // on bye, or no schedule for his team
  if (p.projection !== undefined && p.projection <= 0) return false; // a hole of his own
  const k = kickoffMs(p);
  if (k !== undefined && k <= now) return false;
  return true;
}

function classify(p: Player): FindingKind | undefined {
  if (p.game === null) return "starter_on_bye";
  if (p.status === "out" || p.status === "ir" || p.status === "suspended") return "starter_out";
  // Owner, Oct 3: ESPN's zero projection is the source of truth for movement. A starter
  // projected for nothing is a hole whatever his status says; one projected for something
  // is playing, and is never taken out of the lineup on his own. Exactly zero: a D/ST can
  // be projected below zero and still be playing.
  if (p.projection === 0) return "starter_zero";
  if (p.status === "doubtful") return "starter_doubtful";
  if (p.status === "questionable") return "starter_questionable";
  if (p.status === "unknown") return "starter_status_unknown";
  return undefined;
}

/**
 * Handoff section 9, in order: legal slot, not locked or started, then the user's
 * replacement order, then the highest projection. A player with anything to doubt
 * (questionable, schedule unknown) ranks after every clean one, and a doubtful one, an
 * option only for a hole, after those.
 */
function candidatesFor(
  slot: Slot,
  starter: Player | undefined,
  bench: RosterEntry[],
  starters: RosterEntry[],
  now: number,
  order: string[],
  shifted: Set<string>,
  hole: boolean,
): Candidate[] {
  const rank = (p: Player) => {
    const i = order.indexOf(p.id);
    return i === -1 ? Infinity : i;
  };
  const benchStarter: Move[] = starter ? [{ playerId: starter.id, from: slot, to: BENCH }] : [];
  const out = new Map<string, Candidate>();

  // Owner, Oct 3: a hole is filled by reshuffling. One bench player comes in, and any
  // starters between his slot and the hole each shift one slot along; nobody who is
  // playing leaves the lineup. Breadth first over the slots a shift could vacate, so the
  // first route found for a bench player is his shortest, and a straight move beats a shift.
  type Route = { need: Slot; shifts: { player: Player; from: Slot; to: Slot }[]; seen: Set<Slot> };
  // The earliest kickoff among a route's shifted starters. The later it is, the longer the
  // window to make the move, so of two routes of the same length the later one is kept.
  const viaKickoff = (vias: Player[] | undefined): number => Math.min(...(vias ?? []).map((p) => kickoffMs(p) ?? Infinity));
  const queue: Route[] = [{ need: slot, shifts: [], seen: new Set([slot]) }];
  while (queue.length) {
    const r = queue.shift()!;
    for (const e of bench) {
      if (!e.player.eligibleSlots.includes(r.need) || !viable(e.player, now, hole)) continue;
      const vias = r.shifts.map((x) => x.player);
      const have = out.get(e.player.id);
      if (have && (have.moves.length < benchStarter.length + r.shifts.length + 1 || viaKickoff(have.via) >= viaKickoff(vias))) continue;
      out.set(e.player.id, {
        player: e.player,
        ...(vias.length ? { via: vias } : {}),
        moves: [...benchStarter, ...r.shifts.map((x) => ({ playerId: x.player.id, from: x.from, to: x.to })), { playerId: e.player.id, from: BENCH, to: r.need }],
      });
    }
    if (r.shifts.length >= MAX_SHIFTS) continue;
    for (const e of starters) {
      if (r.seen.has(e.slot) || !isStarting(e.slot) || shifted.has(e.player.id) || e.player.id === starter?.id) continue;
      if (!e.player.eligibleSlots.includes(r.need) || !shiftable(e.player, now)) continue;
      queue.push({ need: e.slot, shifts: [...r.shifts, { player: e.player, from: e.slot, to: r.need }], seen: new Set([...r.seen, e.slot]) });
    }
  }
  return [...out.values()].sort(
    (a, b) =>
      doubt(a.player) - doubt(b.player) ||
      rank(a.player) - rank(b.player) ||
      (b.player.projection ?? -Infinity) - (a.player.projection ?? -Infinity),
  );
}

/** The kickoffs a candidate's moves depend on: his own, and the shifted starter's. */
const kickoffsOf = (c: Candidate): (string | undefined)[] => [c.player.game?.kickoff, ...(c.via ?? []).map((p) => p.game?.kickoff)];

function earliest(...isos: (string | undefined)[]): string | undefined {
  const ms = isos.filter((s): s is string => Boolean(s)).map((s) => Date.parse(s));
  return ms.length ? new Date(Math.min(...ms)).toISOString() : undefined;
}

/** Why a hole has no fix: nobody on the bench could ever play the slot. */
export const NOBODY_ELIGIBLE = "nobody on the bench can fill this slot";
/** Why a hole has no fix: some could play the slot, but none is set to play before it locks. */
export const NOBODY_PLAYING = "nobody on the bench who can fill this slot is projected to play before it locks";

/**
 * The rules' answer for a hole, if they have one. Owner, Oct 4: a hole is filled without
 * asking whenever anyone can fill it, so the top option is the answer when it is clean, or
 * doubted but projected with a known kickoff; ranked by being alone, the user's order, the
 * projection, or failing all of those by the fewest changes (the search finds the shortest
 * route first). Only a top option with no projection and something to doubt, or no known
 * kickoff, is left to the user.
 */
function rulesPick(cands: Candidate[], order: string[]): { candidate: Candidate; why: string } | undefined {
  const [top, next] = cands;
  if (!top || !fillsHole(top.player)) return undefined;
  const p = top.player;
  if (!clean(p)) {
    const doubted = `${p.name} is ${p.status}, but ESPN still projects him to score`;
    if (!next || !fillsHole(next.player)) return { candidate: top, why: `${doubted}, and he is the only option on the bench` };
    if (order.includes(p.id)) return { candidate: top, why: `${doubted}, and he is next in your replacement order` };
    return { candidate: top, why: `${doubted}, and he is the highest-projected option` };
  }
  if (!next || !clean(next.player)) return { candidate: top, why: `${p.name} is the only healthy option on the bench` };
  if (order.includes(p.id)) return { candidate: top, why: `${p.name} is next in your replacement order` };
  if (p.projection !== undefined) return { candidate: top, why: `${p.name} is your highest-projected eligible player` };
  return { candidate: top, why: `${p.name} fills it with the fewest changes` };
}

/** Every ordering of a short list. */
function permutations<T>(items: T[]): T[][] {
  if (items.length < 2) return [items];
  return items.flatMap((x, i) => permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [x, ...rest]));
}

/** Above this many holes at once, the first assignment stands: 6 is 720 tries, and more is not a lineup. */
const MAX_JOINT_HOLES = 6;

/**
 * Every problem in the lineup, with what the rules make of it. `release` holds finding keys
 * the service will not act on (holes the user declined): they are still judged, but their
 * fix does not claim its bench player, so another hole may have him.
 */
export function evaluate(roster: Roster, now: Date, settings: Settings, release: ReadonlySet<string> = new Set()): Finding[] {
  const t = now.getTime();
  const starters = roster.entries.filter((e) => isStarting(e.slot));

  // A problem is a starter we could still move, or a starting slot nobody fills. A starter
  // whose game has started is past moving whether or not ESPN has flagged him locked yet.
  type Problem = { kind: FindingKind; slot: Slot; starter?: Player; index: number };
  const problems: Problem[] = [];
  for (const e of starters) {
    if (e.player.locked || started(e.player, t)) continue;
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
  const isHard = (p: Problem) => HARD.includes(p.kind);
  const soon = (p: Problem) => (p.starter ? kickoffMs(p.starter) ?? Infinity : Infinity);
  problems.sort((a, b) => Number(isHard(b)) - Number(isHard(a)) || soon(a) - soon(b));

  // What earlier fixes in this run have taken: bench players, starters shifted along, and
  // where those starters land, so a doubt about one is judged at the slot he will be in.
  type Claims = { bench: RosterEntry[]; shifted: Set<string>; landed: Map<string, Slot> };
  const claims = (): Claims => ({ bench: roster.entries.filter((e) => e.slot === BENCH), shifted: new Set(), landed: new Map() });

  const judge = (p: Problem, c: Claims): Finding => {
    const slot = p.starter && c.landed.has(p.starter.id) ? c.landed.get(p.starter.id)! : p.slot;
    const hard = isHard(p);
    // A hole keeps its key whatever ESPN calls it next (DTD and zero, then OUT), so the
    // user's Decline holds and their Approve still finds it. An empty slot has no starter.
    const what = p.kind === "empty_slot" ? `empty_slot:${slot}#${p.index}` : hard ? `hole:${p.starter!.id}` : `${p.kind}:${p.starter!.id}`;
    const key = `${roster.period}:${what}`;
    const base = { key, kind: p.kind, hard, slot, ...(p.starter ? { starter: p.starter } : {}) };

    if (p.kind === "starter_status_unknown") {
      return { ...base, resolution: { type: "none", why: "his status could not be read, so we are not touching him" } };
    }

    const cands = candidatesFor(slot, p.starter, c.bench, starters, t, settings.replacementOrder, c.shifted, hard);
    if (!cands.length) {
      const anyone = c.bench.some((e) => e.player.eligibleSlots.includes(slot));
      const why = !hard ? "nobody healthy on the bench to replace him" : anyone ? NOBODY_PLAYING : NOBODY_ELIGIBLE;
      return { ...base, resolution: { type: "none", why } };
    }

    // A starter whose kickoff ESPN did not send could lock before any deadline worked out
    // from the others': no deadline, so nothing is automatic and nothing is promised.
    const unknownKickoff = p.starter !== undefined && p.starter.game === undefined;
    const pick = hard ? rulesPick(cands, settings.replacementOrder) : undefined;
    if (pick) {
      if (!release.has(key)) {
        c.bench = c.bench.filter((e) => e.player.id !== pick.candidate.player.id);
        for (const v of pick.candidate.via ?? []) c.shifted.add(v.id);
        for (const m of pick.candidate.moves) if (c.shifted.has(m.playerId)) c.landed.set(m.playerId, m.to);
      }
      const deadline = unknownKickoff ? undefined : earliest(p.starter?.game?.kickoff, ...kickoffsOf(pick.candidate));
      return { ...base, resolution: { type: "deterministic", ...pick }, ...(deadline ? { deadline } : {}) };
    }

    const why = !hard
      ? `${p.starter?.name} might play`
      : fillsHole(cands[0]!.player)
        ? "no projection or replacement order to rank the options by"
        : "every option on the bench has something to doubt and no projection to go by";
    const deadline = unknownKickoff ? undefined : earliest(p.starter?.game?.kickoff, ...cands.flatMap(kickoffsOf));
    return { ...base, resolution: { type: "judgment", candidates: cands, why }, ...(deadline ? { deadline } : {}) };
  };

  // Holes first. One bench player can be the best fix for two holes, and taking him for
  // the first can leave the second with nobody (owner, Oct 4: never a hole left that could
  // be filled). So if an assignment leaves a hole without an automatic fix, every other
  // order is tried, and the one that fills the most holes wins; ties keep kickoff order.
  const holes = problems.filter(isHard);
  const assign = (order: Problem[]) => {
    const c = claims();
    const out = new Map<Problem, Finding>();
    for (const p of order) out.set(p, judge(p, c));
    // A fix with no deadline (a starter's kickoff unread) is not automatic either.
    const unfilled = [...out.values()].filter((f) => f.resolution.type !== "deterministic" || !f.deadline).length;
    return { c, out, unfilled };
  };
  let best = assign(holes);
  if (best.unfilled > 0 && holes.length > 1 && holes.length <= MAX_JOINT_HOLES) {
    for (const order of permutations(holes)) {
      const tried = assign(order);
      if (tried.unfilled < best.unfilled) best = tried;
      if (best.unfilled === 0) break;
    }
  }

  const findings: Finding[] = [];
  for (const p of problems) findings.push(isHard(p) ? best.out.get(p)! : judge(p, best.c));
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
    // Before the earlier of his kickoff and the last option's (the deadline): an ask that
    // lands after every replacement has locked is no ask at all.
    const by = finding.deadline ?? kick;
    const until = new Date(Date.parse(by) - JUDGMENT_LEAD_MINUTES * 60_000);
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
