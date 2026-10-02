// The domain, in the platform's absence. Connectors translate ESPN (and later
// others) into these shapes; nothing in core knows what an ESPN slot id is.

/** A lineup slot. Starting slots are anything but BENCH and IR. */
export type Slot = "QB" | "RB" | "WR" | "TE" | "FLEX" | "RB/WR" | "WR/TE" | "SUPERFLEX" | "K" | "DST" | "BENCH" | "IR";

export const BENCH: Slot = "BENCH";
export const IR: Slot = "IR";
export const isStarting = (slot: Slot): boolean => slot !== "BENCH" && slot !== "IR";

/**
 * Normalized injury designation. `unknown` is a status the connector could not
 * map, and the engine never acts on it alone.
 */
export type Status = "active" | "questionable" | "doubtful" | "out" | "ir" | "suspended" | "unknown";

/** This week's game. `null` on a player means a bye. */
export interface Game {
  /** ISO 8601, UTC. */
  kickoff: string;
  opponent?: string;
}

export interface Player {
  id: string;
  name: string;
  position: string;
  proTeam: string;
  status: Status;
  eligibleSlots: Slot[];
  /** Projected fantasy points this period, when the platform supplies one. */
  projection?: number;
  /** null = bye week. undefined = we do not know the schedule. */
  game: Game | null | undefined;
  /** The platform will not let this player move (his game has started). */
  locked: boolean;
}

export interface RosterEntry {
  player: Player;
  slot: Slot;
}

export interface Roster {
  teamId: string;
  teamName: string;
  /** The platform's scoring period, a week for NFL leagues. */
  period: number;
  /** Every starting slot the league has, one entry per instance: WR, WR, FLEX... */
  starterSlots: Slot[];
  entries: RosterEntry[];
}

/** One player changing slot. A swap is two moves. */
export interface Move {
  playerId: string;
  from: Slot;
  to: Slot;
}

export type FindingKind =
  | "empty_slot"
  | "starter_on_bye"
  | "starter_out"
  | "starter_doubtful"
  | "starter_questionable"
  | "starter_status_unknown";

export interface Candidate {
  player: Player;
  /** The moves that would put this player in the slot. */
  moves: Move[];
}

export type Resolution =
  | { type: "obvious"; candidate: Candidate; why: string }
  | { type: "judgment"; candidates: Candidate[]; why: string }
  | { type: "none"; why: string };

export interface Finding {
  /** Stable across re-runs of the same problem in the same period. */
  key: string;
  kind: FindingKind;
  hard: boolean;
  slot: Slot;
  /** The starter with the problem. Absent for an empty slot. */
  starter?: Player;
  resolution: Resolution;
  /** ISO. Act before this or not at all. Absent when nothing can be done. */
  deadline?: string;
}

/**
 * How much the user lets HangoverBot do. Working names; see OPEN-DECISIONS.
 *   alert      tell me, do nothing
 *   confirm    propose fixes, act only when I approve
 *   autopilot  make obvious fixes, ask me about judgment calls
 *   full       also act on confident judgment calls
 */
export type Authority = "alert" | "confirm" | "autopilot" | "full";
export const AUTHORITIES: readonly Authority[] = ["alert", "confirm", "autopilot", "full"];

export interface Settings {
  authority: Authority;
  /** Player ids never moved out of a starting slot, whatever happens. */
  pinned: string[];
  /** Projection points by which the best candidate must lead for a fix to be obvious. */
  obviousMargin: number;
  /** Minimum AI confidence for `full` to act without asking. */
  minAiConfidence: number;
}

export const DEFAULT_SETTINGS: Settings = {
  authority: "confirm",
  pinned: [],
  obviousMargin: 3,
  minAiConfidence: 0.7,
};

export type Step =
  | { do: "notify"; finding: Finding }
  /** A soft problem, far enough from kickoff that the news may still change. */
  | { do: "wait"; finding: Finding; until: string }
  | { do: "propose"; finding: Finding; candidate: Candidate; source: "rules" | "ai" }
  | { do: "execute"; finding: Finding; candidate: Candidate; source: "rules" | "ai" }
  | { do: "consult_ai"; finding: Finding; candidates: Candidate[]; then: "propose" | "execute_if_confident" };
