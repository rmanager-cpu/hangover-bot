// Copied from packages/core/src/ai.ts by scripts/build-functions.ts. Edit the original.
// What the AI is asked and what it may answer, as shapes with no provider in them. The
// adapters live in packages/ai; the service only ever sees these. Nothing here carries an
// ESPN cookie or a user's email: a player's name, status, projection and kickoff is all.

import type { Slot, Status } from "./types.ts";

/** The AI's answer to one lineup hole: a candidate's player id, or null to leave it. */
export interface AiChoice {
  playerId: string | null;
  /** 0 to 1. Below the user's `minAiConfidence`, the answer is a proposal, not a move. */
  confidence: number;
  reason: string;
}

/** One option the code built, as the AI sees it. */
export interface JudgeCandidate {
  id: string;
  name: string;
  position: string;
  proTeam: string;
  status: Status;
  projection?: number;
  seasonProjection?: number;
  percentRostered?: number;
  kickoff?: string;
  opponent?: string;
  /** Where he comes from and what it costs: "bench", "free agent, open roster spot", "free agent, drops X". */
  how: string;
  /** A free agent's: who makes room for him. */
  room?: JudgeRoom;
}

/**
 * How a free agent's roster spot is made: an open spot, or a player moved to IR or dropped,
 * with what the code knows of him, so the AI can weigh what the move costs.
 */
export type JudgeRoom =
  | { how: "open" }
  | {
      how: "ir" | "drop";
      name: string;
      position: string;
      status: Status;
      /** This week. */
      projection?: number;
      seasonProjection?: number;
      percentRostered?: number;
      /** No game this week. */
      onBye?: boolean;
      /** On a drop: the user switched him to Droppable. The code offers the AI no other drop. */
      userMarkedDroppable?: boolean;
    };

export interface JudgeInput {
  /** What is wrong, in words: "Achane was ruled OUT at RB". */
  problem: string;
  slot: Slot;
  now: string;
  /** When the slot locks. */
  kickoff?: string;
  /** What the slot gets without going outside the roster, if anything. */
  benchFill?: { name: string; projection?: number };
  candidates: JudgeCandidate[];
}

/** Picks one candidate, or none. Resolves undefined when it could not answer in time. */
export interface Judge {
  pick(input: JudgeInput): Promise<AiChoice | undefined>;
}

/** A player as Roster Advice sees him: on the roster (with a slot) or a free agent. */
export interface AdvicePlayer {
  id: string;
  name: string;
  position: string;
  proTeam: string;
  slot?: Slot;
  status: Status;
  projection?: number;
  seasonProjection?: number;
  percentRostered?: number;
  byeWeek?: number;
  kickoff?: string;
  opponent?: string;
  /** On waivers rather than free: never an add. */
  onWaivers?: boolean;
  /** On the roster, not in IR, and he qualifies for it: worked out by the app. */
  irEligible?: boolean;
}

/**
 * The room on the roster, worked out by the app from the league's own slot counts before the
 * AI sees it (owner, Nov 7: "the model is being asked to compensate for missing application
 * logic"). The AI takes it as given. A size ESPN didn't send stays unknown, never guessed.
 */
export interface AdviceRoom {
  benchSpots?: number;
  benchUsed: number;
  irSpots?: number;
  irUsed: number;
  /** Roster spots free right now: an add that needs nothing moved. */
  openRosterSpots?: number;
  /** Ids of players not in IR who qualify for it: one can move there if an IR spot is free. */
  irEligible: string[];
  /** Ids of players in an IR spot who no longer qualify. ESPN refuses every add and drop until they move out. */
  irIneligibleInIr: string[];
  /** An add needs a drop: no open spot, and no IR move that makes one. Absent when the sizes are unknown. */
  addNeedsDrop?: boolean;
}

export interface AdviceInput {
  teamName: string;
  week: number;
  now: string;
  starterSlots: Slot[];
  roster: AdvicePlayer[];
  freeAgents: AdvicePlayer[];
  /** Ids the user switched to Droppable. */
  droppable: string[];
  /** Worked out by the app; absent only for inputs built before Nov 7. */
  room?: AdviceRoom;
}

export type AdviceKind = "injury" | "rb_backup" | "bye" | "construction" | "fit";

/** One suggestion. The action, if any, is an add and/or a drop the user may make with one tap. */
export interface Advice {
  kind: AdviceKind;
  title: string;
  body: string;
  /** Where it came from: URLs from web search, or "ESPN" for the roster data. */
  sources: string[];
  /**
   * `outForSeason`: a source says the dropped player's season is over, which the provider's
   * data does not show yet. It lets the drop be suggested; the user's tap is what takes it.
   */
  action?: { add?: string; drop?: string; outForSeason?: boolean };
  /** ISO. When the moment passes: kickoff, the waiver run. */
  expiresAt?: string;
}

/** Scans the roster, with limited web search, and suggests. Resolves [] when it cannot answer. */
export interface Advisor {
  advise(input: AdviceInput): Promise<Advice[]>;
}
