// Roster Advice's checks in code, independent of the model (owner, Nov 7). Before the AI sees
// the roster, the room on it is worked out here: "the model is being asked to compensate for
// missing application logic". After it answers, every move it suggests is checked here: a
// Kimi run said "drop Joe Milton" while its move carried Chig Okonkwo's id, which is "not
// merely bad fantasy advice. It's a potential transaction-integrity failure."

import type { Advice, AdviceInput, AdvicePlayer, AdviceRoom } from "./ai.ts";
import { qualifiesForIr } from "./outside.ts";
import { BENCH, IR, type Roster } from "./types.ts";

/** What the roster has room for, from the league's own slot counts. Unknown sizes stay unknown. */
export function rosterRoom(r: Roster): AdviceRoom {
  const inIr = r.entries.filter((e) => e.slot === IR);
  const active = r.entries.length - inIr.length;
  const openRosterSpots = r.benchSlots === undefined ? undefined : Math.max(0, r.starterSlots.length + r.benchSlots - active);
  const irOpen = r.irSlots === undefined ? undefined : Math.max(0, r.irSlots - inIr.length);
  const irEligible = r.entries.filter((e) => e.slot !== IR && qualifiesForIr(e.player)).map((e) => e.player.id);
  // Healthy (or merely doubtful) and still in IR. A status we couldn't read is not called either way.
  const irIneligibleInIr = inIr.filter((e) => !["ir", "out", "unknown"].includes(e.player.status)).map((e) => e.player.id);
  return {
    ...(r.benchSlots !== undefined ? { benchSpots: r.benchSlots } : {}),
    benchUsed: r.entries.filter((e) => e.slot === BENCH).length,
    ...(r.irSlots !== undefined ? { irSpots: r.irSlots } : {}),
    irUsed: inIr.length,
    ...(openRosterSpots !== undefined ? { openRosterSpots } : {}),
    irEligible,
    irIneligibleInIr,
    ...(openRosterSpots !== undefined ? { addNeedsDrop: openRosterSpots === 0 && !((irOpen ?? 0) > 0 && irEligible.length > 0) } : {}),
  };
}

/** Why a suggested move can't be trusted: its ids don't agree with the roster, or with its own words. */
export type MoveProblem =
  | "add_unknown" // no such free agent
  | "add_on_roster" // he's already on this team
  | "drop_unknown" // no such player
  | "drop_not_on_roster" // a free agent, not one of this team's
  | "same_player"
  | "add_not_named" // the words never name the player the move adds
  | "drop_not_named"; // the words never name the player the move drops

/**
 * Checks a suggestion's move against the input it was made from, whatever the model says: the
 * add must be a free agent in the list and not on the roster, the drop one of this roster, and
 * the words must name the very players the move names. Undefined when it holds, or there is
 * no move. A suggestion that fails is not advice: neither its words nor its move reach the user.
 */
export function checkAdviceMove(item: Advice, input: AdviceInput): MoveProblem | undefined {
  const add = item.action?.add;
  const drop = item.action?.drop;
  if (add === undefined && drop === undefined) return undefined;
  const mine = new Map(input.roster.map((p) => [p.id, p]));
  const free = new Map(input.freeAgents.map((p) => [p.id, p]));
  if (add !== undefined) {
    if (mine.has(add)) return "add_on_roster";
    if (!free.has(add)) return "add_unknown";
  }
  if (drop !== undefined && !mine.has(drop)) return free.has(drop) ? "drop_not_on_roster" : "drop_unknown";
  if (add !== undefined && add === drop) return "same_player";
  const words = plain(`${item.title} ${item.body}`);
  const everyone = [...input.roster, ...input.freeAgents];
  if (add !== undefined && !named(free.get(add)!, words, everyone)) return "add_not_named";
  if (drop !== undefined && !named(mine.get(drop)!, words, everyone)) return "drop_not_named";
  return undefined;
}

const SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv", "v"]);
const DEFENSE_WORDS = ["d/st", "dst", "d st", "defense", "def"];

/**
 * Lower case, no accents, no possessive ("Mitchell's" is Mitchell: a Kimi item was thrown out
 * for it on the bench), no apostrophes, words split on anything else; padded so phrases match
 * whole words.
 */
const plain = (s: string): string =>
  ` ${s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/['’]s\b/g, "").replace(/['’]/g, "").replace(/[^a-z0-9/]+/g, " ").trim()} `;
const says = (words: string, phrase: string): boolean => phrase !== "" && words.includes(` ${phrase} `);
const isDefense = (p: AdvicePlayer): boolean => p.position === "DST" || p.position === "D/ST" || /\bd\/st$/i.test(p.name);
/** His name's words, a Jr. or III left off. */
const nameWords = (p: AdvicePlayer): string[] => {
  const w = plain(p.name).trim().split(" ").filter(Boolean);
  return w.filter((x, i) => i === 0 || !SUFFIXES.has(x));
};

/**
 * Named in the words: his full name, or his last name when no other listed player shares it;
 * a defense by its team and D/ST or "defense" ("Saints D/ST", "Saints defense").
 */
function named(p: AdvicePlayer, words: string, everyone: AdvicePlayer[]): boolean {
  if (isDefense(p)) {
    const team = nameWords(p)[0] ?? "";
    return says(words, plain(p.name).trim()) || DEFENSE_WORDS.some((d) => says(words, `${team} ${d}`));
  }
  const w = nameWords(p);
  if (says(words, w.join(" "))) return true;
  const last = w[w.length - 1] ?? "";
  const sharing = everyone.filter((q) => {
    const qw = nameWords(q);
    return !isDefense(q) && qw[qw.length - 1] === last;
  }).length;
  return sharing === 1 && says(words, last);
}
