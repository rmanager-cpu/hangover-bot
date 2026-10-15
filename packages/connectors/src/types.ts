import type { Move, Roster } from "@rosterbots/core";

/** Handoff section 14. Waiver submission is deliberately not a capability in V1. */
export const CAPABILITIES = [
  "READ_LEAGUE",
  "READ_ROSTER",
  "READ_SCORING",
  "READ_FREE_AGENTS",
  "READ_PLAYER_AVAILABILITY",
  "READ_LINEUP_LOCKS",
  "WRITE_LINEUP",
  "ADD_FREE_AGENT",
  "DROP_PLAYER",
  "MOVE_TO_IR",
  "VERIFY_TRANSACTION",
] as const;
export type Capability = (typeof CAPABILITIES)[number];

/**
 * What a connector can do. `unverified` lists capabilities built but never yet
 * proven against the real provider; the worker keeps them behind a feature flag.
 */
export interface ConnectorCapabilities {
  supported: Capability[];
  unverified: Capability[];
}

export interface LeagueSummary {
  leagueId: string;
  leagueName: string;
  season: number;
  /** The team this member manages there, when the provider says. */
  teamId?: string;
  teamName?: string;
}

export interface TransactionResult {
  httpStatus: number;
  detail: string;
}

/**
 * One instance per provider credential. A member's ESPN cookies cover every
 * league they are in, so league ids are arguments, not configuration.
 *
 * Deliberately absent, against the handoff's sketch:
 *   connect()            the provider sign-in happens in the extension, not here
 *   refreshConnection()  ESPN sessions cannot be refreshed by us; an AuthError
 *                        means the user must sign in again (MEGACAST-AUDIT.md)
 * Free agents, drops and IR arrive with the phases that need them.
 */
export interface FantasyConnector {
  readonly provider: ProviderId;
  capabilities(): ConnectorCapabilities;
  /** The fantasy football leagues this member belongs to this season. */
  getLeagues(): Promise<LeagueSummary[]>;
  /** The member's own team in a league, found by membership, never by counting. */
  getMyTeam(leagueId: string): Promise<{ teamId: string; teamName: string; leagueName: string }>;
  getRoster(leagueId: string): Promise<Roster>;
  /**
   * Ask the provider to apply these moves. Resolving is NOT success: the caller
   * re-reads the roster and checks core.applied().
   */
  setLineup(leagueId: string, moves: Move[], period: number): Promise<TransactionResult>;
}

/** The credentials are no longer accepted. The user must sign in again. */
export class AuthError extends Error {
  readonly httpStatus: number;
  constructor(httpStatus: number) {
    super("credentials rejected (HTTP " + httpStatus + ")");
    this.httpStatus = httpStatus;
  }
}

/** The provider said no for a reason other than credentials. */
export class ProviderError extends Error {
  readonly httpStatus: number;
  constructor(what: string, httpStatus: number) {
    super(what + " (HTTP " + httpStatus + ")");
    this.httpStatus = httpStatus;
  }
}

/** Every host the picker shows. Only ESPN is built; the rest say "coming soon". */
export type ProviderId = "espn" | "sleeper" | "yahoo" | "cbs" | "nfl";
export const PROVIDERS: readonly { id: ProviderId; name: string; status: "available" | "coming_soon" }[] = [
  { id: "espn", name: "ESPN", status: "available" },
  { id: "sleeper", name: "Sleeper", status: "coming_soon" },
  { id: "yahoo", name: "Yahoo", status: "coming_soon" },
  { id: "cbs", name: "CBS", status: "coming_soon" },
  { id: "nfl", name: "NFL Fantasy", status: "coming_soon" },
];
