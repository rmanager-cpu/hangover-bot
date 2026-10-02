// The service's shapes, as docs/BETA.md fixes them. Everything outside pure code
// arrives through Deps, so the same code runs under Node in tests and under Deno
// in Supabase Edge Functions. No Supabase, Deno or Node imports here or anywhere
// in this package's src.

import type { Authority, AutomationPolicy, Move, Roster } from "@rosterbots/core";
import type { FantasyConnector } from "@rosterbots/connectors";

export type ConnectionStatus = "active" | "needs_reauth" | "paused";
export interface ConnectionRow {
  id: string;
  userId: string;
  credentialId: string;
  leagueId: string;
  season: number;
  teamId: string | null;
  teamName: string | null;
  leagueName: string | null;
  status: ConnectionStatus;
  authority: Authority;
  benchSwaps: boolean;
  replacementOrder: string[];
  maxAutoMovesPerDay: number;
  lastCheckedAt: string | null;
  nextCheckAt: string | null;
}

export type ActionKind = "notify" | "wait" | "propose" | "ask_user" | "execute";
export type ActionStatus = "pending" | "approved" | "declined" | "expired" | "superseded" | "done" | "failed";
export interface NewAction {
  connectionId: string;
  userId: string;
  findingKey: string;
  period: number;
  kind: ActionKind;
  status: ActionStatus;
  moves: Move[];
  /** One line a person reads: "Start Jaylen Wright at RB instead of De'Von Achane". */
  summary: string;
  /** Why: "Achane was ruled OUT". */
  reason: string;
  deadline: string | null;
  autoAt: string | null;
  /** Kind + finding key + moves, for dedupe. */
  signature: string;
}
export interface ActionRow extends NewAction {
  id: string;
  createdAt: string;
  decidedAt: string | null;
  executedAt: string | null;
  result: unknown;
}

export type ActivityType =
  | "STATUS_CHANGED"
  | "ACTION_REQUIRED"
  | "ACTION_RECOMMENDED"
  | "ACTION_COMPLETED"
  | "ACTION_FAILED"
  | "PREGAME_WARNING";
export interface ActivityEntry {
  userId: string;
  connectionId: string;
  type: ActivityType;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

export interface Store {
  dueConnections(nowIso: string, limit: number): Promise<ConnectionRow[]>;
  getConnection(id: string): Promise<ConnectionRow | null>;
  credentials(credentialId: string): Promise<{ swid: string; espnS2: string } | null>;
  accountClaimed(userId: string): Promise<boolean>;
  saveCheck(
    connectionId: string,
    patch: { status?: ConnectionStatus; lastCheckedAt: string; nextCheckAt: string; lastRoster?: Roster },
  ): Promise<void>;
  actionsFor(connectionId: string, findingKey: string, period: number): Promise<ActionRow[]>;
  getAction(id: string): Promise<ActionRow | null>;
  insertAction(a: NewAction): Promise<ActionRow>;
  updateAction(id: string, patch: { status: ActionStatus; result?: unknown; decidedAt?: string; executedAt?: string }): Promise<void>;
  /** Count of kind 'execute' actions with status 'done' or 'failed' and executedAt >= sinceIso. */
  autoMovesSince(connectionId: string, sinceIso: string): Promise<number>;
  addActivity(e: ActivityEntry): Promise<void>;
  pushTokens(userId: string): Promise<string[]>;
}

export interface Push {
  send(tokens: string[], msg: { title: string; body: string; data?: Record<string, unknown> }): Promise<void>;
}
export type ConnectorFactory = (creds: { swid: string; espnS2: string }, season: number) => FantasyConnector;
export interface Deps {
  store: Store;
  push: Push;
  connector: ConnectorFactory;
  now: () => Date;
  policy: AutomationPolicy;
}

export interface CheckSummary {
  connectionId: string;
  outcome: "ok" | "needs_reauth" | "error" | "skipped";
  findings: number;
  executed: number;
  proposed: number;
  notified: number;
  nextCheckAt: string;
  error?: string;
}

export type DecisionResult = { ok: true; status: ActionStatus; message: string } | { ok: false; error: string; message: string };

export type SwapResult = { ok: true; message: string; after: ReadSummary } | { ok: false; error: string; message: string };

/** What the app's "What we read from ESPN" screen shows. */
export interface ReadSummary {
  teamName: string;
  period: number;
  readAt: string;
  players: {
    id: string;
    name: string;
    position: string;
    proTeam: string;
    slot: string;
    status: string;
    kickoff: string | null;
    bye: boolean;
    locked: boolean;
    projection: number | null;
  }[];
  warnings: string[];
}
