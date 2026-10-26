// Copied from packages/service/src/types.ts by scripts/build-functions.ts. Edit the original.
// The service's shapes, as docs/BETA.md fixes them. Everything outside pure code
// arrives through Deps, so the same code runs under Node in tests and under Deno
// in Supabase Edge Functions. No Supabase, Deno or Node imports here or anywhere
// in this package's src.

import type { Advisor, Authority, AutomationPolicy, Judge, Move, Roster, Slot } from "@rosterbots/core";
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
  /**
   * When a change the user made through RosterBots in this league (the test swap, or an
   * approval) was last seen on a fresh read. Null until then, and again after a test swap
   * ESPN did not apply. The first automatic move in a league waits for it (owner, Oct 3).
   */
  writeVerifiedAt: string | null;
  /** Players the user switched to Droppable, by id (AI Native). Nobody else is dropped on its own. */
  droppable: string[];
  /** When Roster Advice last ran for this league; null until it has. */
  advisedAt: string | null;
}

/** notify/wait/ask_user say something; propose waits for a tap; execute is a write; advise is Roster Advice. */
export type ActionKind = "notify" | "wait" | "propose" | "ask_user" | "execute" | "advise";

/** A free agent coming in and the room made for him, as stored with an action: ids and names, JSON-safe. */
export interface StoredTransaction {
  add: { playerId: string; name: string; position: string; to: Slot };
  /** `outForSeason` on a drop: the AI's word from a web report (advice only), which the user's tap takes. */
  room: { how: "open" } | { how: "ir" | "drop"; playerId: string; name: string; from: Slot; outForSeason?: boolean };
}
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
  /** Kind + finding key + moves (+ the transaction), for dedupe. */
  signature: string;
  /** The add and drop that come before the moves (AI Native, advice). Absent for a bench move. */
  transaction?: StoredTransaction | null;
  /** Where a piece of advice came from. */
  sources?: string[] | null;
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
  | "PREGAME_WARNING"
  /** T-3: the lineup is set for this kickoff, or what is still wrong. */
  | "ALL_CLEAR"
  /** Roster Advice has suggestions waiting. */
  | "ADVICE";
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
  /**
   * A read made outside a check (an approval, a test swap, the app's Read again). Keeps the
   * roster, which the app's Home shows, and leaves the check schedule to the checker.
   */
  saveRoster(connectionId: string, roster: Roster, readAt: string): Promise<void>;
  /** The roster last saved by saveCheck or saveRoster, for when ESPN cannot be read now. */
  lastRoster(connectionId: string): Promise<Roster | null>;
  actionsFor(connectionId: string, findingKey: string, period: number): Promise<ActionRow[]>;
  getAction(id: string): Promise<ActionRow | null>;
  insertAction(a: NewAction): Promise<ActionRow>;
  /**
   * With `onlyIf`, changes the row only while its status is still that one, so a user's
   * decline and the checker's supersede cannot overwrite each other. Returns whether it changed.
   */
  updateAction(
    id: string,
    patch: { status: ActionStatus; result?: unknown; decidedAt?: string; executedAt?: string },
    onlyIf?: ActionStatus,
  ): Promise<boolean>;
  /** Count of kind 'execute' actions with status 'approved', 'done' or 'failed' created at or after sinceIso: in flight counts too. */
  autoMovesSince(connectionId: string, sinceIso: string): Promise<number>;
  /** This connection's actions still open, any period: proposals 'pending' and writes in flight ('approved'). Oldest first. */
  openActions(connectionId: string): Promise<ActionRow[]>;
  /** Writes in this period a fresh read did not confirm: kind 'execute' or 'propose' with status 'failed'. */
  failedWrites(connectionId: string, period: number): Promise<number>;
  /** A lineup change was seen on a fresh read (`at`), or a test swap was not (null). */
  setWriteVerified(connectionId: string, at: string | null): Promise<void>;
  /** Actions with a transaction, any period, status 'approved', 'done' or 'failed': RosterBots' adds and drops, a failed one included since its add may have landed. */
  transactions(connectionId: string): Promise<ActionRow[]>;
  /** Automatic moves that landed this period: kind 'execute', status 'done'. */
  doneExecutes(connectionId: string, period: number): Promise<ActionRow[]>;
  /** Roster Advice ran for this league at `at`. */
  setAdvised(connectionId: string, at: string): Promise<void>;
  addActivity(e: ActivityEntry): Promise<void>;
  pushTokens(userId: string): Promise<string[]>;
}

export interface Push {
  send(tokens: string[], msg: { title: string; body: string; data?: Record<string, unknown> }): Promise<void>;
}
export type ConnectorFactory = (creds: { swid: string; espnS2: string }, season: number) => FantasyConnector;
/** The AI, when the deployment has a key. Without it AI Native still runs as Auto Protect plus proposals. */
export interface AiDeps {
  judge: Judge;
  advisor?: Advisor;
}
export interface Deps {
  store: Store;
  push: Push;
  connector: ConnectorFactory;
  now: () => Date;
  policy: AutomationPolicy;
  ai?: AiDeps;
  /** Waits before a second look at ESPN. Defaults to a timer; tests pass one that returns at once. */
  pause?: (ms: number) => Promise<void>;
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
