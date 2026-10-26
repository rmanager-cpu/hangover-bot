// In-memory stand-ins for everything outside the service: the database, ESPN, Expo
// and the clock. Nothing here reaches a network.

import { AuthError, ProviderError, type AddDrop, type FantasyConnector, type TransactionResult } from "@rosterbots/connectors";
import { BETA_AUTOMATION, type Advice, type AdviceInput, type AiChoice, type Authority, type FreeAgent, type JudgeInput, type Move, type Player, type Roster, type RosterEntry, type Slot } from "@rosterbots/core";
import { protectConnection } from "../src/index.ts";
import type { ActionRow, ActivityEntry, AiDeps, ConnectionRow, ConnectionStatus, Deps, NewAction, Push, Store } from "../src/index.ts";

export const MIN = 60_000;
export const KICKOFF = "2026-10-04T17:00:00.000Z"; // Sunday 1:00 PM ET
export const LATE = "2026-10-04T20:25:00.000Z"; // Sunday 4:25 PM ET
export const T = Date.parse(KICKOFF);
export const SUNDAY_8AM = "2026-10-04T12:00:00.000Z";
/** When the owner's Saturday test swap went through. */
export const TEST_SWAP_DONE = "2026-10-03T18:05:00.000Z";

export const HURTS = "4040715";
export const ACHANE = "4429160";
export const BIJAN = "4430807";
export const JEFFERSON = "4262921";
export const ST_BROWN = "4374302";
export const WALKER = "4567048";
export const VIKINGS = "-16016"; // a D/ST: negative and real
export const WRIGHT = "4877706";
export const SHAHEED = "4597500";
export const DELL = "4366031";

const RB: Slot[] = ["RB", "RB/WR", "FLEX", "BENCH", "IR"];
const WR: Slot[] = ["WR", "RB/WR", "WR/TE", "FLEX", "BENCH", "IR"];

function p(id: string, name: string, position: string, proTeam: string, eligibleSlots: Slot[], over: Partial<Player> = {}): Player {
  return { id, name, position, proTeam, status: "active", eligibleSlots, projection: 10, game: { kickoff: KICKOFF }, locked: false, ...over };
}

/** Team #2 in week 5, everyone healthy. A new object every call. */
export function team(): Roster {
  const at = (slot: Slot, player: Player): RosterEntry => ({ slot, player });
  return {
    teamId: "2",
    teamName: "Trust The Process",
    period: 5,
    starterSlots: ["QB", "RB", "RB", "WR", "WR", "FLEX", "DST"],
    entries: [
      at("QB", p(HURTS, "Jalen Hurts", "QB", "PHI", ["QB", "SUPERFLEX", "BENCH", "IR"], { projection: 21 })),
      at("RB", p(ACHANE, "De'Von Achane", "RB", "MIA", RB, { projection: 15 })),
      at("RB", p(BIJAN, "Bijan Robinson", "RB", "ATL", RB, { projection: 17 })),
      at("WR", p(JEFFERSON, "Justin Jefferson", "WR", "MIN", WR, { projection: 16, game: { kickoff: LATE } })),
      at("WR", p(ST_BROWN, "Amon-Ra St. Brown", "WR", "DET", WR, { projection: 15 })),
      at("FLEX", p(WALKER, "Kenneth Walker III", "RB", "SEA", RB, { projection: 12, game: { kickoff: LATE } })),
      at("DST", p(VIKINGS, "Vikings D/ST", "D/ST", "MIN", ["DST", "BENCH"], { projection: 7, game: { kickoff: LATE } })),
      at("BENCH", p(WRIGHT, "Jaylen Wright", "RB", "MIA", RB, { projection: 8.1 })),
      at("BENCH", p(SHAHEED, "Rashid Shaheed", "WR", "NO", WR, { projection: 7.4 })),
      at("IR", p(DELL, "Tank Dell", "WR", "HOU", WR, { status: "ir", projection: 0 })),
    ],
  };
}

export const entry = (r: Roster, id: string): RosterEntry => r.entries.find((e) => e.player.id === id)!;

/** Achane ruled OUT, Wright the only RB on the bench. */
export function achaneOut(): Roster {
  const r = team();
  entry(r, ACHANE).player.status = "out";
  return r;
}

export class FakeEspn implements FantasyConnector {
  readonly provider = "espn" as const;
  roster: Roster;
  reads = 0;
  writes: { moves: Move[]; period: number }[] = [];
  write: "apply" | "ignore" | "partial" | "throw" | "auth" = "apply";
  read: "ok" | "auth" | "error" = "ok";
  /** Runs before every read with its number: the user or ESPN changing things between reads. */
  onRead?: (n: number, roster: Roster) => void;

  constructor(roster: Roster) {
    this.roster = roster;
  }
  /** What the connector declares about its write. The service's proof gate is per connection and never reads it. */
  unverified: ("WRITE_LINEUP" | "READ_ROSTER")[] = ["WRITE_LINEUP"];
  capabilities() {
    return { supported: ["READ_ROSTER" as const, "WRITE_LINEUP" as const], unverified: this.unverified };
  }
  async getLeagues() {
    return [];
  }
  async getMyTeam() {
    return { teamId: this.roster.teamId, teamName: this.roster.teamName, leagueName: "Live free or die hard RR4L" };
  }
  async getRoster(_leagueId: string): Promise<Roster> {
    this.reads++;
    this.onRead?.(this.reads, this.roster);
    if (this.read === "auth") throw new AuthError(401);
    if (this.read === "error") throw new ProviderError("roster", 503);
    return structuredClone(this.roster);
  }
  async setLineup(_leagueId: string, moves: Move[], period: number): Promise<TransactionResult> {
    this.writes.push({ moves: structuredClone(moves), period });
    if (this.write === "throw") throw new ProviderError("transaction", 500);
    if (this.write === "auth") throw new AuthError(403);
    const apply = this.write === "apply" ? moves : this.write === "partial" ? moves.slice(0, 1) : [];
    for (const m of apply) entry(this.roster, m.playerId).slot = m.to;
    return { httpStatus: this.write === "ignore" ? 409 : 200, detail: "" };
  }

  /** The league's free agents, as ESPN would list them. */
  freeAgents: FreeAgent[] = [];
  freeAgentReads: { period: number; slots?: Slot[] }[] = [];
  freeAgentRead: "ok" | "error" = "ok";
  addDrops: { tx: AddDrop; period: number }[] = [];
  /** apply: the add lands where asked and the drop leaves; bench: ESPN puts him on the bench whatever was asked; ignore: nothing changes. */
  addDropMode: "apply" | "bench" | "ignore" | "throw" = "apply";
  async getFreeAgents(_leagueId: string, period: number, opts: { slots?: Slot[]; limit?: number } = {}): Promise<FreeAgent[]> {
    this.freeAgentReads.push({ period, ...(opts.slots ? { slots: opts.slots } : {}) });
    if (this.freeAgentRead === "error") throw new ProviderError("free agents", 503);
    const slots = opts.slots;
    return structuredClone(this.freeAgents.filter((f) => !slots || f.player.eligibleSlots.some((s) => slots.includes(s))));
  }
  async addDrop(_leagueId: string, tx: AddDrop, period: number): Promise<TransactionResult> {
    this.addDrops.push({ tx: structuredClone(tx), period });
    if (this.addDropMode === "throw") throw new ProviderError("transaction", 500);
    if (this.addDropMode === "ignore") return { httpStatus: 409, detail: "" };
    const fa = this.freeAgents.find((f) => f.player.id === tx.add.playerId);
    if (!fa) return { httpStatus: 409, detail: "not a free agent" };
    if (tx.drop) this.roster.entries = this.roster.entries.filter((e) => e.player.id !== tx.drop!.playerId);
    this.freeAgents = this.freeAgents.filter((f) => f.player.id !== fa.player.id);
    this.roster.entries.push({ player: structuredClone(fa.player), slot: this.addDropMode === "bench" ? "BENCH" : tx.add.toSlot });
    return { httpStatus: 200, detail: "EXECUTED FREEAGENT" };
  }
}

/** A scripted Judge and Advisor. By default the judge picks the first option, sure of it, and the advisor has nothing to say. */
export class FakeAi implements AiDeps {
  picks: JudgeInput[] = [];
  asked: AdviceInput[] = [];
  choose: (input: JudgeInput) => AiChoice | undefined = (input) => (input.candidates[0] ? { playerId: input.candidates[0].id, confidence: 0.9, reason: `${input.candidates[0].name} is the best option` } : undefined);
  suggest: (input: AdviceInput) => Advice[] = () => [];
  judge = { pick: async (input: JudgeInput) => {
    this.picks.push(input);
    return this.choose(input);
  } };
  advisor = { advise: async (input: AdviceInput) => {
    this.asked.push(input);
    return this.suggest(input);
  } };
}

export class MemoryStore implements Store {
  connections = new Map<string, ConnectionRow>();
  creds = new Map<string, { swid: string; espnS2: string }>();
  claimed = new Set<string>();
  actions: ActionRow[] = [];
  activity: ActivityEntry[] = [];
  checks: { connectionId: string; patch: { status?: ConnectionStatus; lastCheckedAt: string; nextCheckAt: string; lastRoster?: Roster } }[] = [];
  rosters: { connectionId: string; roster: Roster; readAt: string }[] = [];
  saved = new Map<string, Roster>();
  failRosters = false;
  tokens = new Map<string, string[]>();
  clock: () => Date;
  private n = 0;

  constructor(clock: () => Date) {
    this.clock = clock;
  }
  async dueConnections(nowIso: string, limit: number) {
    return [...this.connections.values()].filter((c) => c.status === "active" && (c.nextCheckAt ?? "") <= nowIso).slice(0, limit);
  }
  async getConnection(id: string) {
    const c = this.connections.get(id);
    return c ? { ...c } : null;
  }
  async credentials(id: string) {
    return this.creds.get(id) ?? null;
  }
  async accountClaimed(userId: string) {
    return this.claimed.has(userId);
  }
  async saveCheck(connectionId: string, patch: MemoryStore["checks"][number]["patch"]) {
    this.checks.push({ connectionId, patch });
    const c = this.connections.get(connectionId);
    if (!c) return;
    if (patch.status) c.status = patch.status;
    c.lastCheckedAt = patch.lastCheckedAt;
    c.nextCheckAt = patch.nextCheckAt;
    if (patch.lastRoster) this.saved.set(connectionId, structuredClone(patch.lastRoster));
  }
  async saveRoster(connectionId: string, roster: Roster, readAt: string) {
    if (this.failRosters) throw new Error("store: save roster failed");
    this.rosters.push({ connectionId, roster: structuredClone(roster), readAt });
    this.saved.set(connectionId, structuredClone(roster));
  }
  async lastRoster(connectionId: string) {
    const r = this.saved.get(connectionId);
    return r ? structuredClone(r) : null;
  }
  async actionsFor(connectionId: string, findingKey: string, period: number) {
    return this.actions.filter((a) => a.connectionId === connectionId && a.findingKey === findingKey && a.period === period).map((a) => ({ ...a }));
  }
  async getAction(id: string) {
    const a = this.actions.find((x) => x.id === id);
    return a ? { ...a } : null;
  }
  async insertAction(a: NewAction) {
    const row: ActionRow = { ...a, id: `act-${++this.n}`, createdAt: this.clock().toISOString(), decidedAt: null, executedAt: null, result: null };
    this.actions.push(row);
    return { ...row };
  }
  async updateAction(id: string, patch: Parameters<Store["updateAction"]>[1], onlyIf?: Parameters<Store["updateAction"]>[2]) {
    const a = this.actions.find((x) => x.id === id);
    if (!a || (onlyIf !== undefined && a.status !== onlyIf)) return false;
    Object.assign(a, patch);
    return true;
  }
  async autoMovesSince(connectionId: string, sinceIso: string) {
    return this.actions.filter(
      (a) => a.connectionId === connectionId && a.kind === "execute" && ["approved", "done", "failed"].includes(a.status) && a.createdAt >= sinceIso,
    ).length;
  }
  async openActions(connectionId: string) {
    return this.actions.filter((a) => a.connectionId === connectionId && (a.status === "pending" || a.status === "approved")).map((a) => ({ ...a }));
  }
  async failedWrites(connectionId: string, period: number) {
    return this.actions.filter((a) => a.connectionId === connectionId && a.period === period && a.status === "failed" && (a.kind === "execute" || a.kind === "propose")).length;
  }
  verified: { connectionId: string; at: string | null }[] = [];
  async setWriteVerified(connectionId: string, at: string | null) {
    this.verified.push({ connectionId, at });
    const c = this.connections.get(connectionId);
    if (c) c.writeVerifiedAt = at;
  }
  async transactions(connectionId: string) {
    return this.actions.filter((a) => a.connectionId === connectionId && a.transaction && ["approved", "done", "failed"].includes(a.status)).map((a) => ({ ...a }));
  }
  async doneExecutes(connectionId: string, period: number) {
    return this.actions.filter((a) => a.connectionId === connectionId && a.period === period && a.kind === "execute" && a.status === "done").map((a) => ({ ...a }));
  }
  advised: { connectionId: string; at: string }[] = [];
  async setAdvised(connectionId: string, at: string) {
    this.advised.push({ connectionId, at });
    const c = this.connections.get(connectionId);
    if (c) c.advisedAt = at;
  }
  async addActivity(e: ActivityEntry) {
    this.activity.push(e);
  }
  async pushTokens(userId: string) {
    return this.tokens.get(userId) ?? [];
  }

  /** An automatic move made earlier, for the daily cap. */
  seedExecute(connectionId: string, executedAt: string, findingKey = "5:starter_out:somebody") {
    this.actions.push({
      id: `seed-${++this.n}`, connectionId, userId: "user-1", findingKey, period: 5, kind: "execute", status: "done",
      moves: [], summary: "", reason: "", deadline: null, autoAt: null, signature: `seed-${this.n}`,
      createdAt: executedAt, decidedAt: null, executedAt, result: null,
    });
  }
}

export class FakePush implements Push {
  sent: { tokens: string[]; msg: { title: string; body: string; data?: Record<string, unknown> } }[] = [];
  fail = false;
  async send(tokens: string[], msg: { title: string; body: string; data?: Record<string, unknown> }) {
    if (this.fail) throw new Error("expo is down");
    this.sent.push({ tokens, msg });
  }
}

export class Clock {
  t: number;
  constructor(at: number | string) {
    this.t = typeof at === "string" ? Date.parse(at) : at;
  }
  now = () => new Date(this.t);
  set(at: number | string) {
    this.t = typeof at === "string" ? Date.parse(at) : at;
  }
  advance(minutes: number) {
    this.t += minutes * MIN;
  }
}

export interface SetupOptions {
  authority?: Authority;
  claimed?: boolean;
  at?: number | string;
  roster?: Roster;
  conn?: Partial<ConnectionRow>;
  /** true for the default FakeAi, or a scripted one. Absent: no AI, as a deployment without a key. */
  ai?: true | FakeAi;
  freeAgents?: FreeAgent[];
}

/** One user, one connection to team #2 of league 36784699, one phone. Inside the window unless told otherwise. */
export function setup(opts: SetupOptions = {}) {
  const clock = new Clock(opts.at ?? T - 45 * MIN);
  const store = new MemoryStore(clock.now);
  const espn = new FakeEspn(opts.roster ?? team());
  const push = new FakePush();
  const conn: ConnectionRow = {
    id: "conn-1", userId: "user-1", credentialId: "cred-1", leagueId: "36784699", season: 2026,
    teamId: "2", teamName: "Trust The Process", leagueName: "Live free or die hard RR4L",
    status: "active", authority: opts.authority ?? "bench_protection", benchSwaps: true, replacementOrder: [],
    maxAutoMovesPerDay: 3, lastCheckedAt: null, nextCheckAt: null, writeVerifiedAt: TEST_SWAP_DONE, droppable: [], advisedAt: null, ...opts.conn,
  };
  store.connections.set(conn.id, conn);
  store.creds.set(conn.credentialId, { swid: "{TEST-SWID}", espnS2: "test-espn-s2" });
  if (opts.claimed ?? true) store.claimed.add(conn.userId);
  store.tokens.set(conn.userId, ["ExponentPushToken[pixel-8]"]);
  const opened: { creds: { swid: string; espnS2: string }; season: number }[] = [];
  const pauses: number[] = [];
  if (opts.freeAgents) espn.freeAgents = opts.freeAgents;
  const ai = opts.ai === undefined ? undefined : opts.ai === true ? new FakeAi() : opts.ai;
  const deps: Deps = {
    store, push, now: clock.now, policy: BETA_AUTOMATION,
    ...(ai ? { ai } : {}),
    pause: async (ms) => {
      pauses.push(ms);
    },
    connector: (creds, season) => {
      opened.push({ creds, season });
      return espn;
    },
  };
  // The row as the store has it now, the way the cron would hand it over.
  const run = () => protectConnection(deps, { ...store.connections.get(conn.id)! });
  return { clock, store, espn, push, conn, deps, run, opened, pauses, ai };
}
