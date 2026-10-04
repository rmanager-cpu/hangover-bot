// The domain, in the provider's absence. Connectors translate ESPN (and later
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

/** This week's game. */
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
  /** Projected fantasy points this period, when the provider supplies one. */
  projection?: number;
  /** null = bye week. undefined = we do not know the schedule. */
  game: Game | null | undefined;
  /** The provider will not let this player move (his game has started). */
  locked: boolean;
}

export interface RosterEntry {
  player: Player;
  slot: Slot;
}

export interface Roster {
  teamId: string;
  teamName: string;
  /** The provider's scoring period, a week for NFL leagues. */
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
  /** ESPN projects him for zero points, whatever his status says (owner, Oct 3). */
  | "starter_zero"
  | "starter_doubtful"
  | "starter_questionable"
  | "starter_status_unknown";

export interface Candidate {
  player: Player;
  /** The moves that would put this player in the slot. */
  moves: Move[];
  /**
   * Owner, Oct 3: the starters who shift to make room, nearest the broken slot first: the
   * first moves into it, each next one into the slot the previous vacated, and this player
   * takes the last one's. Absent when he goes straight from the bench.
   */
  via?: Player[];
}

export type Resolution =
  /** The rules have an answer. No AI. */
  | { type: "deterministic"; candidate: Candidate; why: string }
  /** Real judgment is needed: a starter who may play, or no data to rank by. */
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
 * Handoff section 4. Stored as these ids; the consumer labels live in packages/ui
 * because "AI Rescue" is still a working name.
 *   alerts            watch and notify; never modifies the roster
 *   ask_me            propose a move; act only on approval
 *   bench_protection  repair lineup slots automatically from the roster, no AI
 *   ai_rescue         also use AI where judgment is needed, within permissions
 */
export type Authority = "alerts" | "ask_me" | "bench_protection" | "ai_rescue";
export const AUTHORITIES: readonly Authority[] = ["alerts", "ask_me", "bench_protection", "ai_rescue"];

/** Handoff section 8. Each is off unless the user turns it on, except bench swaps. */
export interface Permissions {
  benchSwaps: boolean;
  irMoves: boolean;
  freeAgentAdds: boolean;
  drops: boolean;
}

export interface Settings {
  authority: Authority;
  /**
   * Has this user claimed their account (Apple, Google, email)? Anonymous users
   * get nothing unattended: the engine treats them as ask_me at most.
   */
  accountClaimed: boolean;
  permissions: Permissions;
  /** The user's explicit replacement order, player ids, best first. Beats projections. */
  replacementOrder: string[];
  /** Minimum AI confidence for ai_rescue to act without asking. Open decision; configurable. */
  minAiConfidence: number;
}

export const DEFAULT_SETTINGS: Settings = {
  authority: "ask_me",
  accountClaimed: false,
  permissions: { benchSwaps: true, irMoves: false, freeAgentAdds: false, drops: false },
  replacementOrder: [],
  minAiConfidence: 0.8,
};

export type Step =
  | { do: "notify"; finding: Finding }
  /** A soft problem, far enough from kickoff that the news may still change. */
  | { do: "wait"; finding: Finding; until: string }
  /**
   * A specific move for the user to approve. `held` means it would have been automatic
   * but a guardrail stopped it; `autoAt` is when it will be, if nothing changes.
   */
  | { do: "propose"; finding: Finding; candidate: Candidate; source: "rules" | "ai"; held?: { reason: string; autoAt?: string } }
  /** A judgment call the user makes, with the options laid out. No AI below ai_rescue. */
  | { do: "ask_user"; finding: Finding; candidates: Candidate[] }
  | { do: "execute"; finding: Finding; candidate: Candidate; source: "rules" | "ai" }
  | { do: "consult_ai"; finding: Finding; candidates: Candidate[] };
