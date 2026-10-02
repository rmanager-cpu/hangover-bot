// NFL facts that are true whatever fantasy platform a league is on, and the seam
// where a dedicated game-day data provider will plug in (see OPEN-DECISIONS).

export const NFL_TEAMS = [
  "ARI", "ATL", "BAL", "BUF", "CAR", "CHI", "CIN", "CLE", "DAL", "DEN", "DET", "GB", "HOU", "IND", "JAX", "KC",
  "LAC", "LAR", "LV", "MIA", "MIN", "NE", "NO", "NYG", "NYJ", "PHI", "PIT", "SEA", "SF", "TB", "TEN", "WSH",
] as const;
export type NflTeam = (typeof NFL_TEAMS)[number];

/** Positions a standard fantasy league can roster. */
export const FANTASY_POSITIONS = ["QB", "RB", "WR", "TE", "K", "DST"] as const;

/** A player's game-day news from a provider other than the fantasy platform. */
export interface GameDayStatus {
  /** The fantasy platform's player id, already matched by the provider adapter. */
  playerId: string;
  /** Confirmed inactive on the official list, 90 minutes before kickoff. */
  inactive?: boolean;
  status?: "active" | "questionable" | "doubtful" | "out";
  /** ISO time the provider last changed this. */
  updatedAt: string;
}

/**
 * A provider of inactives and injury news. Nothing implements it yet: until the
 * data-provider decision is made, the fantasy platform's own status is all we have.
 */
export interface GameDayFeed {
  statuses(playerIds: string[], since?: string): Promise<GameDayStatus[]>;
}
