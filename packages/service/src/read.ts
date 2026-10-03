// What the app shows from a read, and when the next check runs.

import { BENCH, IR, isStarting, rosterLooksSane, type Roster, type Slot } from "@rosterbots/core";
import type { ReadSummary } from "./types.ts";
import { list, shortName, slotName } from "./words.ts";

const MIN = 60_000;

/**
 * Cadence: 1 min if any rostered player kicks off within 10 min (the window now runs to T-4,
 * so a late scratch ESPN shows then still gets a look); 2 min within 100 min; 15 min within
 * 12 h; else 60 min.
 */
export function nextCheckAt(roster: Roster | null, now: Date): Date {
  const t = now.getTime();
  let soonest = Infinity;
  for (const e of roster?.entries ?? []) {
    // A game already under way has nothing left to protect; a bye or an unknown schedule has no kickoff.
    const until = e.player.game ? Date.parse(e.player.game.kickoff) - t : NaN;
    if (until >= 0 && until < soonest) soonest = until;
  }
  const minutes = soonest <= 10 * MIN ? 1 : soonest <= 100 * MIN ? 2 : soonest <= 12 * 60 * MIN ? 15 : 60;
  return new Date(t + minutes * MIN);
}

function emptySlots(roster: Roster): Slot[] {
  const filled = new Map<Slot, number>();
  for (const e of roster.entries) if (isStarting(e.slot)) filled.set(e.slot, (filled.get(e.slot) ?? 0) + 1);
  const empty: Slot[] = [];
  for (const s of roster.starterSlots) {
    const n = filled.get(s) ?? 0;
    if (n > 0) filled.set(s, n - 1);
    else empty.push(s);
  }
  return empty;
}

/** What the app's "What we read from ESPN" screen shows. */
export function summarizeRead(roster: Roster, now: Date): ReadSummary {
  // Starters in the league's slot order, then the bench, then IR, as the ESPN app lists them.
  const rank = (s: Slot) => {
    const i = roster.starterSlots.indexOf(s);
    if (i !== -1) return i;
    return s === BENCH ? 1000 : s === IR ? 1001 : 999;
  };
  const entries = [...roster.entries].sort((a, b) => rank(a.slot) - rank(b.slot));

  const warnings: string[] = [];
  if (!rosterLooksSane(roster)) warnings.push("Something in this read looks off, so I won't make automatic moves until a read looks right.");
  for (const s of emptySlots(roster)) warnings.push(`Nobody is starting at ${slotName(s)}.`);

  const playing = roster.entries.filter((e) => e.slot !== IR);
  const noKickoff = playing.filter((e) => e.player.game === undefined);
  if (noKickoff.length && noKickoff.length === playing.length) {
    warnings.push("ESPN's schedule didn't come through, so I can't see kickoff times and won't move anyone on my own.");
  } else if (noKickoff.length) {
    warnings.push(`No kickoff time came through for ${list(noKickoff.map((e) => e.player.name))}.`);
  }

  const unknown = roster.entries.filter((e) => e.player.status === "unknown");
  if (unknown.length) {
    const them = unknown.length === 1 ? "him" : "them";
    warnings.push(`ESPN sent an injury status I don't recognize for ${list(unknown.map((e) => shortName(e.player.name)))}, so I won't move ${them}.`);
  }

  if (roster.entries.length && roster.entries.every((e) => e.player.projection === undefined)) {
    warnings.push("ESPN sent no projections, so I can only pick a replacement from your replacement order, or when just one player fits.");
  }

  return {
    teamName: roster.teamName,
    period: roster.period,
    readAt: now.toISOString(),
    players: entries.map(({ player: p, slot }) => ({
      id: p.id,
      name: p.name,
      position: p.position,
      proTeam: p.proTeam,
      slot,
      status: p.status,
      kickoff: p.game ? p.game.kickoff : null,
      bye: p.game === null,
      locked: p.locked,
      projection: p.projection ?? null,
    })),
    warnings,
  };
}
