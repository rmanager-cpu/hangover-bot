// ESPN's numbers, translated. Ported from rr-draft-megacast (server/players.mjs,
// server/league.mjs), where each of these was read off the live API.

import type { Slot, Status } from "@rosterbots/core";

/** ESPN lineup slot ids we understand. IDP and other exotic slots are not mapped. */
export const SLOT_BY_ID: Record<number, Slot> = {
  0: "QB", 2: "RB", 3: "RB/WR", 4: "WR", 5: "WR/TE", 6: "TE", 7: "SUPERFLEX",
  16: "DST", 17: "K", 20: "BENCH", 21: "IR", 23: "FLEX",
};
export const ID_BY_SLOT = Object.fromEntries(Object.entries(SLOT_BY_ID).map(([id, s]) => [s, Number(id)])) as Record<Slot, number>;

export const slotOf = (id: number): Slot | undefined => SLOT_BY_ID[id];

// Ids 7 and 9-15 are punters, defensive positions, head coaches and ESPN's
// team-QB aggregate rows. They exist in the player table; leaving them unmapped
// put "?" on a television in Megacast.
const POSITION: Record<number, string> = {
  [-1]: "OL", 0: "OL", 1: "QB", 2: "RB", 3: "WR", 4: "TE", 5: "K", 7: "P",
  9: "DT", 10: "DE", 11: "LB", 12: "CB", 13: "S", 14: "HC", 15: "TQB", 16: "DST",
  17: "DE", 18: "OL",
};
export const positionOf = (id: number | undefined): string => (id === undefined ? "?" : POSITION[id] ?? "?");

const PRO_TEAM: Record<number, string> = {
  0: "FA", 1: "ATL", 2: "BUF", 3: "CHI", 4: "CIN", 5: "CLE", 6: "DAL", 7: "DEN", 8: "DET",
  9: "GB", 10: "TEN", 11: "IND", 12: "KC", 13: "LV", 14: "LAR", 15: "MIA", 16: "MIN",
  17: "NE", 18: "NO", 19: "NYG", 20: "NYJ", 21: "PHI", 22: "ARI", 23: "PIT", 24: "LAC",
  25: "SF", 26: "SEA", 27: "TB", 28: "WSH", 29: "CAR", 30: "JAX", 33: "BAL", 34: "HOU",
};
export const proTeamOf = (id: number | undefined): string => (id === undefined ? "" : PRO_TEAM[id] ?? String(id));

/**
 * ESPN's injuryStatus. Anything not listed maps to `unknown`, which the engine
 * reports but never acts on: a new ESPN string must not move a player.
 */
export function statusOf(injuryStatus: string | undefined, injured: boolean | undefined): Status {
  switch (injuryStatus) {
    case undefined:
      return injured ? "unknown" : "active";
    case "ACTIVE":
    case "NORMAL":
    case "PROBABLE":
      return "active";
    case "QUESTIONABLE":
      return "questionable";
    case "DOUBTFUL":
      return "doubtful";
    case "OUT":
      return "out";
    case "INJURY_RESERVE":
      return "ir";
    case "SUSPENSION":
      return "suspended";
    default:
      return "unknown";
  }
}
