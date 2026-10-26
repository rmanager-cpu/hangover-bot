// Copied from packages/core/src/outside.ts by scripts/build-functions.ts. Edit the original.
// Outside the roster: free agents as the fix for a hole, under the No-Cray Rules
// (docs/AI-NATIVE.md). Pure, like the engine. The code builds every option and throws out
// anything that breaks a rule; the AI only ever picks from what is left, and a rule that
// fails for want of data, or for the Droppable switch, becomes a question for the user.

import { isHole } from "./engine.ts";
import { BENCH, IR, isStarting, type Candidate, type FreeAgent, type Move, type Player, type Room, type Roster, type Settings, type Slot } from "./types.ts";

export const NO_CRAY = Object.freeze({
  /** Rule 5: never drop anyone rostered in more than this percent of ESPN leagues. */
  rosteredLine: 65,
  /** Rule 7: the add must be projected this many points more this week than the slot gets without him. */
  upgradeMargin: 2,
  /** Rule 10: at most this many adds a week. */
  addsPerWeek: 2,
  /** Rule 10: never drop a player added in the last this many days. */
  keepAddedDays: 7,
});

/** AI Native's own window: it goes outside the roster from T-15, and stops trying at T-8. */
export const AI_WINDOW = Object.freeze({ fromMinutes: 15, lastTryMinutes: 8 });

/** What RosterBots has already added and dropped, for rule 10. */
export interface OutsideHistory {
  /** Adds in this period so far, in flight included. */
  addsThisWeek: number;
  /** When RosterBots added each player still on the roster: player id to ISO. */
  addedAt: ReadonlyMap<string, string>;
  /** Players RosterBots dropped this season. */
  dropped: ReadonlySet<string>;
}

export interface Transaction {
  add: Player;
  room: Room;
}

export interface NoCrayContext {
  roster: Roster;
  settings: Settings;
  now: Date;
  history: OutsideHistory;
  /** The slot the add fills. BENCH for advice, which fills nothing in particular. */
  slot: Slot;
  /** What the slot gets without going outside: the bench fill's projection, or 0. */
  baseline: number;
  /** Who is in the slot now: the hole, or RosterBots' own fill. Absent for an empty slot. */
  occupant?: Player;
  /** A hole at kickoff (the automatic case, rule 1), or advice for the weeks ahead. */
  purpose: "hole" | "advice";
}

/**
 * ok, or the rule that fails and why. `waivable` is a failure the user's tap may overrule:
 * the Droppable switch (rule 2), or data ESPN did not send (rules 5, 6 and 7). Everything
 * else stands whoever asks.
 */
export type Verdict = { ok: true } | { ok: false; rule: number; why: string; waivable: boolean };

const OK: Verdict = { ok: true };
const no = (rule: number, why: string): Verdict => ({ ok: false, rule, why, waivable: false });
const ask = (rule: number, why: string): Verdict => ({ ok: false, rule, why, waivable: true });

const DAY = 86_400_000;

const started = (p: Player, now: number): boolean => p.locked || (p.game ? Date.parse(p.game.kickoff) <= now : false);

/** ESPN's position for a defense is DST; hand-built rosters say D/ST. */
const positionOf = (p: Player): string => (p.position === "D/ST" ? "DST" : p.position);

/** Rest-of-season value, for ranking drops: lowest goes first. Unknown ranks last. */
const worth = (p: Player): number => p.seasonProjection ?? Infinity;

/** Rule 8: would dropping him leave fewer players at his position than the lineup starts? */
function leavesShort(roster: Roster, drop: Player, add: Player): boolean {
  const pos = positionOf(drop);
  const needed = roster.starterSlots.filter((s) => s === pos).length;
  if (!needed) return false;
  const kept = roster.entries.filter((e) => e.slot !== IR && e.player.id !== drop.id && positionOf(e.player) === pos).length;
  return kept + (positionOf(add) === pos ? 1 : 0) < needed;
}

/** Rules 2, 3, 4, 5, 6, 8 and 10 on the player who would go. */
function dropVerdict(d: Player, from: Slot, ctx: NoCrayContext, add: Player): Verdict {
  const name = d.name;
  // The provider's own word that his season is over; for advice, the AI's, from a web report,
  // which only ever makes a suggestion the user taps (AI-NATIVE.md, rule 4).
  const over = d.outForSeason === true;
  if (isStarting(from) && !isHole(d) && !over) return no(3, `${name} is a starter who is playing this week`);
  if (d.status === "unknown") return no(4, `${name}'s status could not be read`);
  if (!over && d.status !== "active") return no(4, `${name} will be back`);
  const addedAt = ctx.history.addedAt.get(d.id);
  if (addedAt !== undefined && Date.parse(addedAt) > ctx.now.getTime() - NO_CRAY.keepAddedDays * DAY) {
    return no(10, `${name} was added in the last ${NO_CRAY.keepAddedDays} days`);
  }
  if (leavesShort(ctx.roster, d, add)) return no(8, `${name} is the only ${positionOf(d)} your lineup can start`);
  if (!over && d.percentRostered !== undefined && d.percentRostered > NO_CRAY.rosteredLine) {
    return no(5, `${name} is rostered in ${Math.round(d.percentRostered)}% of ESPN leagues`);
  }
  if (!over && d.percentRostered === undefined) return ask(5, `ESPN did not say how many leagues roster ${name}`);
  if (!over && d.seasonProjection === undefined) return ask(6, `ESPN sent no rest-of-season projection for ${name}`);
  if (!ctx.settings.droppable.includes(d.id)) return ask(2, `${name} is not marked Droppable`);
  return OK;
}

/** Why a free agent cannot start in the slot at kickoff, if he cannot. */
function cannotStart(p: Player, ctx: NoCrayContext): string | undefined {
  const name = p.name;
  if (!p.eligibleSlots.includes(ctx.slot)) return `${name} can't play ${ctx.slot}`;
  if (started(p, ctx.now.getTime())) return `${name}'s game has started`;
  if (p.game === null) return `${name} is on bye`;
  if (p.game === undefined) return `${name}'s kickoff could not be read`;
  if (p.status === "unknown") return `${name}'s status could not be read`;
  if (p.status !== "active" && p.status !== "questionable") return `${name} is ${p.status}`;
  if (p.projection === undefined || p.projection <= 0) return `${name} is not projected to score`;
  return undefined;
}

const qualifiesForIr = (p: Player): boolean => p.eligibleSlots.includes(IR) && (p.status === "ir" || p.status === "out");

/**
 * Making room, in the owner's order: an open roster spot needs nothing; else an open IR slot
 * and a player who qualifies for it, the slot's own starter first; only then a drop, the
 * out-for-the-season droppable player if there is one, else the lowest rest-of-season value.
 * A drop every rule allows comes first; failing that, one only the user's tap could allow.
 */
function roomFor(add: Player, ctx: NoCrayContext): { room: Room } | { room?: undefined; verdict: Verdict } {
  const r = ctx.roster;
  const active = r.entries.filter((e) => e.slot !== IR);
  if (r.benchSlots !== undefined && r.starterSlots.length + r.benchSlots > active.length) return { room: { how: "open" } };

  // Room is made from the bench, or with the hole's own starter: another starter's slot is
  // never emptied for this one, unless his season is over and he is dead weight wherever he sits.
  const spare = active.filter((e) => e.slot === BENCH || e.player.id === ctx.occupant?.id || e.player.outForSeason === true);

  if (r.irSlots !== undefined && r.irSlots > r.entries.length - active.length) {
    const pick =
      spare.find((e) => e.player.id === ctx.occupant?.id && qualifiesForIr(e.player)) ??
      spare.find((e) => e.player.status === "ir" && qualifiesForIr(e.player)) ??
      spare.find((e) => qualifiesForIr(e.player));
    if (pick) return { room: { how: "ir", player: pick.player, from: pick.slot } };
  }

  const ranked = spare
    .filter((e) => e.player.id !== add.id)
    .map((e) => ({ e, verdict: dropVerdict(e.player, e.slot, ctx, add) }))
    .sort(
      (a, b) =>
        Number(b.e.player.outForSeason === true) - Number(a.e.player.outForSeason === true) ||
        worth(a.e.player) - worth(b.e.player) ||
        a.e.player.name.localeCompare(b.e.player.name),
    );
  const pick = ranked.find((x) => x.verdict.ok) ?? ranked.find((x) => !x.verdict.ok && x.verdict.waivable);
  if (pick) return { room: { how: "drop", player: pick.e.player, from: pick.e.slot } };
  const first = ranked[0];
  return { verdict: first && !first.verdict.ok ? first.verdict : no(2, "nobody on the roster can be dropped") };
}

/**
 * The No-Cray Rules on one transaction: the add, and the room made for him. Run when the
 * option is built, and again on a fresh read before anything is written or approved.
 */
export function noCray(tx: Transaction, ctx: NoCrayContext): Verdict {
  const { add, room } = tx;
  const name = add.name;
  if (ctx.history.dropped.has(add.id)) return no(10, `RosterBots dropped ${name} this season`);
  if (ctx.history.addsThisWeek >= NO_CRAY.addsPerWeek) return no(10, `${NO_CRAY.addsPerWeek} adds already this week`);
  if (ctx.purpose === "hole") {
    const why = cannotStart(add, ctx);
    if (why) return no(7, why);
    if (add.projection === undefined || add.projection < ctx.baseline + NO_CRAY.upgradeMargin) {
      return no(7, `${name} is not projected ${NO_CRAY.upgradeMargin} points more than the lineup gets without him`);
    }
  } else if (add.status === "unknown" || add.status === "suspended") {
    return no(7, `${name} is ${add.status === "unknown" ? "of unknown status" : add.status}`);
  }
  if (room.how === "ir") {
    if (!qualifiesForIr(room.player)) return no(4, `${room.player.name} does not qualify for IR`);
    const r = ctx.roster;
    if (r.irSlots === undefined || r.irSlots <= r.entries.filter((e) => e.slot === IR).length) return no(4, "no IR slot is open");
  }
  if (room.how === "drop") {
    const d = room.player;
    // His own rules first: a hard one stands whatever the values say, and a question about
    // him (no data, or the Droppable switch) is the question to ask.
    const v = dropVerdict(d, room.from, ctx, add);
    if (!v.ok && !v.waivable) return v;
    if (!d.outForSeason) {
      if (add.seasonProjection === undefined || d.seasonProjection === undefined) return v.ok ? ask(7, `no rest-of-season projection to compare ${name} with ${d.name}`) : v;
      if (add.seasonProjection < d.seasonProjection) return no(7, `${name} is worth less for the rest of the season than ${d.name}`);
    }
    if (!v.ok) return v;
  }
  return OK;
}

/** The add and the moves that follow it, or undefined when there is nowhere to put the slot's own starter. */
function candidateFor(tx: Transaction, ctx: NoCrayContext): Candidate | undefined {
  const { add, room } = tx;
  const r = ctx.roster;
  const removed = room.how === "open" ? undefined : room.player;
  // Bench spots known to be free, plus the one the room frees when a bench player goes.
  const benchCount = r.entries.filter((e) => e.slot === BENCH).length;
  const benchFree = Math.max(0, r.benchSlots === undefined ? 0 : r.benchSlots - benchCount) + (room.how !== "open" && room.from === BENCH ? 1 : 0);
  const moves: Move[] = [];
  let to: Slot;
  if (ctx.occupant && removed?.id !== ctx.occupant.id) {
    if (benchFree < 1) return undefined;
    to = BENCH;
    moves.push({ playerId: ctx.occupant.id, from: ctx.slot, to: BENCH }, { playerId: add.id, from: BENCH, to: ctx.slot });
  } else if (benchFree >= 1) {
    to = BENCH;
    if (ctx.slot !== BENCH) moves.push({ playerId: add.id, from: BENCH, to: ctx.slot });
  } else {
    if (ctx.slot === BENCH) return undefined;
    to = ctx.slot;
  }
  return { player: add, moves, add: { to, room } };
}

export interface Outside {
  /** Options every rule allows, best first. The AI picks from these. */
  moves: Candidate[];
  /** Options one tap could allow: a drop not marked Droppable, or data ESPN did not send. Best first. */
  asks: { candidate: Candidate; why: string }[];
  /** Free agents ruled out, and the rule that did it. */
  rejected: { player: Player; rule: number; why: string }[];
}

const better = (a: Candidate, b: Candidate): number =>
  (b.player.projection ?? -Infinity) - (a.player.projection ?? -Infinity) || (b.player.percentRostered ?? -1) - (a.player.percentRostered ?? -1);

/** Every free agent who could fill the slot, with his room made and the rules applied. */
export function outsideCandidates(freeAgents: FreeAgent[], ctx: NoCrayContext): Outside {
  const out: Outside = { moves: [], asks: [], rejected: [] };
  for (const fa of freeAgents) {
    const add = fa.player;
    if (fa.onWaivers) {
      out.rejected.push({ player: add, rule: 9, why: `${add.name} is on waivers` });
      continue;
    }
    if (ctx.roster.entries.some((e) => e.player.id === add.id)) continue;
    const roomed = roomFor(add, ctx);
    if (!roomed.room) {
      const v = roomed.verdict;
      out.rejected.push({ player: add, rule: v.ok ? 0 : v.rule, why: `no room for ${add.name}: ${v.ok ? "" : v.why}` });
      continue;
    }
    const tx = { add, room: roomed.room };
    const verdict = noCray(tx, ctx);
    if (!verdict.ok && !verdict.waivable) {
      out.rejected.push({ player: add, rule: verdict.rule, why: verdict.why });
      continue;
    }
    const candidate = candidateFor(tx, ctx);
    if (!candidate) {
      out.rejected.push({ player: add, rule: 0, why: `no bench spot to move ${ctx.occupant?.name ?? "the starter"} to` });
      continue;
    }
    if (verdict.ok) out.moves.push(candidate);
    else out.asks.push({ candidate, why: verdict.why });
  }
  out.moves.sort(better);
  out.asks.sort((a, b) => better(a.candidate, b.candidate));
  return out;
}
