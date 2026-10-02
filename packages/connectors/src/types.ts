import type { Move, Roster } from "@rosterbots/core";

/** What a fantasy platform must do for HangoverBot. One instance per league connection. */
export interface Connector {
  readonly platform: "espn";
  /** Whose credentials are these, and which team do they manage? Used on connect. */
  identify(): Promise<{ memberId: string; teamId: string; teamName: string; leagueName: string }>;
  /** The managed team's roster for the current scoring period. */
  getRoster(): Promise<Roster>;
  /**
   * Ask the platform to apply these moves. Resolving is NOT success: the caller
   * re-reads the roster and checks (core.applied). This only reports what the
   * platform said.
   */
  submitMoves(moves: Move[], period: number): Promise<{ httpStatus: number; detail: string }>;
}

/** The credentials are no longer accepted. The user must reconnect. */
export class AuthError extends Error {
  readonly httpStatus: number;
  constructor(httpStatus: number) {
    super("credentials rejected (HTTP " + httpStatus + ")");
    this.httpStatus = httpStatus;
  }
}

/** The platform said no for a reason other than credentials. */
export class PlatformError extends Error {
  readonly httpStatus: number;
  constructor(what: string, httpStatus: number) {
    super(what + " HTTP " + httpStatus);
    this.httpStatus = httpStatus;
  }
}
