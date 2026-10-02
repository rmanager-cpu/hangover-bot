// Small readings of the last roster the checker saved, for Home. The rules engine runs on
// the server; nothing here decides a move. It only shows what the last read said.

import type { Player, Roster, RosterEntry } from "@rosterbots/core";
import type { Proposal } from "./data";

const starting = (slot: string) => slot !== "BENCH" && slot !== "IR";

export const started = (p: Pick<Player, "locked" | "game">, now: Date): boolean =>
  p.locked || (p.game ? Date.parse(p.game.kickoff) <= now.getTime() : false);

/** Starters in the league's slot order, the way ESPN lists them. */
export function starters(roster: Roster): RosterEntry[] {
  const rank = (slot: string) => {
    const i = roster.starterSlots.indexOf(slot as Roster["starterSlots"][number]);
    return i === -1 ? 999 : i;
  };
  return roster.entries.filter((e) => starting(e.slot)).sort((a, b) => rank(a.slot) - rank(b.slot));
}

/** The next kickoff among the starters, and who plays in it. */
export function nextKickoff(roster: Roster, now: Date): { at: string; names: string[] } | null {
  let at: string | null = null;
  for (const e of starters(roster)) {
    const k = e.player.game?.kickoff;
    if (k && Date.parse(k) > now.getTime() && (!at || Date.parse(k) < Date.parse(at))) at = k;
  }
  if (!at) return null;
  const names = starters(roster)
    .filter((e) => e.player.game?.kickoff === at)
    .map((e) => e.player.name);
  return { at, names };
}

export interface Problem {
  /** Matches the end of the engine's finding key, to pair it with a proposal. */
  keyEnd: string;
  text: string;
}

/** Starters who can't play and haven't kicked off yet, and empty starting slots. */
export function problems(roster: Roster, now: Date): Problem[] {
  const out: Problem[] = [];
  for (const e of starters(roster)) {
    const p = e.player;
    if (started(p, now)) continue;
    const name = shortName(p.name);
    if (p.game === null) out.push({ keyEnd: ":" + p.id, text: `${name} is on bye` });
    else if (p.status === "out") out.push({ keyEnd: ":" + p.id, text: `${name} is OUT` });
    else if (p.status === "ir") out.push({ keyEnd: ":" + p.id, text: `${name} is on IR` });
    else if (p.status === "suspended") out.push({ keyEnd: ":" + p.id, text: `${name} is suspended` });
  }
  const filled = new Map<string, number>();
  for (const e of roster.entries) if (starting(e.slot)) filled.set(e.slot, (filled.get(e.slot) ?? 0) + 1);
  for (const slot of roster.starterSlots) {
    const n = filled.get(slot) ?? 0;
    if (n > 0) filled.set(slot, n - 1);
    else out.push({ keyEnd: ":empty_slot:", text: `Nobody is starting at ${slot === "DST" ? "D/ST" : slot}` });
  }
  return out;
}

export function proposalFor(problem: Problem, pending: Proposal[], connectionId: string): Proposal | undefined {
  return pending.find(
    (p) => p.connectionId === connectionId && (problem.keyEnd === ":empty_slot:" ? p.findingKey.includes(problem.keyEnd) : p.findingKey.endsWith(problem.keyEnd)),
  );
}

/** "De'Von Achane" is "Achane". A D/ST keeps its whole name. */
export function shortName(name: string): string {
  const words = name.split(" ").filter(Boolean);
  if (words.length < 2 || name.includes("D/ST")) return name;
  const suffix = ["Jr.", "Jr", "Sr.", "Sr", "II", "III", "IV", "V"];
  while (words.length > 2 && suffix.includes(words[words.length - 1]!)) words.pop();
  return words[words.length - 1]!;
}
