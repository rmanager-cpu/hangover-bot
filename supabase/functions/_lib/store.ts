// The service's Store over Postgres, through supabase-js with a key that bypasses RLS
// (every user check is the caller's job). Rows are snake_case; the service's types are
// camelCase. Timestamps come back as ISO in UTC whatever Postgres's own format is,
// because the service compares them as instants.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Authority, Move, Roster } from "@rosterbots/core";
import type {
  ActionKind,
  ActionRow,
  ActionStatus,
  ActivityEntry,
  ConnectionRow,
  ConnectionStatus,
  NewAction,
  Store,
} from "@rosterbots/service";
import { SERVICE_KEY_NAMES, serviceKey } from "./keys.ts";

let client: SupabaseClient | undefined;

/** Full database rights. Never hand this client, or anything it read, to a caller unchecked. */
export function adminClient(): SupabaseClient {
  if (client) return client;
  const url = Deno.env.get("SUPABASE_URL");
  // A secret key (sb_secret_...) or the legacy service_role JWT, whichever the runtime
  // provides (keys.ts). The name is logged once; the key never is.
  const key = serviceKey((name) => Deno.env.get(name));
  if (!url || !key) throw new Error(`SUPABASE_URL and one of ${SERVICE_KEY_NAMES.join(", ")} must be set`);
  console.log(`store: database key from ${key.from}`);
  client = createClient(url, key.key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  return client;
}

// last_roster is left out: it is large and the service never needs the old one.
const CONNECTION_COLUMNS =
  "id,user_id,credential_id,league_id,season,team_id,team_name,league_name,status,authority,bench_swaps,replacement_order,max_auto_moves_per_day,last_checked_at,next_check_at,write_verified_at";

/**
 * How long a run holds the connections it took. Longer than any one run can last, so
 * the next minute's run cannot take the same connection while this one is still on it.
 * saveCheck replaces it with the real next check; a run that dies leaves it to expire.
 */
const LEASE_MS = 5 * 60_000;

// A paused league is never checked. One waiting for a fresh sign-in still is, every few
// minutes and silently (service ops.signedOut), in case ESPN's refusal was a passing one.
const WATCHED: ConnectionStatus[] = ["active", "needs_reauth"];

interface ConnectionDb {
  id: string;
  user_id: string;
  credential_id: string;
  league_id: string;
  season: number;
  team_id: string | null;
  team_name: string | null;
  league_name: string | null;
  status: ConnectionStatus;
  authority: Authority;
  bench_swaps: boolean;
  replacement_order: string[] | null;
  max_auto_moves_per_day: number;
  last_checked_at: string | null;
  next_check_at: string | null;
  write_verified_at: string | null;
}

interface ActionDb {
  id: string;
  connection_id: string;
  user_id: string;
  finding_key: string;
  period: number;
  kind: ActionKind;
  status: ActionStatus;
  moves: Move[] | null;
  summary: string;
  reason: string;
  deadline: string | null;
  auto_at: string | null;
  signature: string;
  created_at: string;
  decided_at: string | null;
  executed_at: string | null;
  result: unknown;
}

const iso = (t: string | null): string | null => (t ? new Date(t).toISOString() : null);

function toConnection(r: ConnectionDb): ConnectionRow {
  return {
    id: r.id,
    userId: r.user_id,
    credentialId: r.credential_id,
    leagueId: r.league_id,
    season: r.season,
    teamId: r.team_id,
    teamName: r.team_name,
    leagueName: r.league_name,
    status: r.status,
    authority: r.authority,
    benchSwaps: r.bench_swaps,
    replacementOrder: r.replacement_order ?? [],
    maxAutoMovesPerDay: r.max_auto_moves_per_day,
    lastCheckedAt: iso(r.last_checked_at),
    nextCheckAt: iso(r.next_check_at),
    writeVerifiedAt: iso(r.write_verified_at),
  };
}

function toAction(r: ActionDb): ActionRow {
  return {
    id: r.id,
    connectionId: r.connection_id,
    userId: r.user_id,
    findingKey: r.finding_key,
    period: r.period,
    kind: r.kind,
    status: r.status,
    moves: r.moves ?? [],
    summary: r.summary,
    reason: r.reason,
    deadline: iso(r.deadline),
    autoAt: iso(r.auto_at),
    signature: r.signature,
    createdAt: iso(r.created_at) ?? r.created_at,
    decidedAt: iso(r.decided_at),
    executedAt: iso(r.executed_at),
    result: r.result ?? null,
  };
}

// The code says what failed; the message can quote row data, so it stays out.
function must<T>(res: { data: T | null; error: { code?: string } | null }, what: string): T {
  if (res.error) throw new Error(`store: ${what} failed (${res.error.code ?? "no code"})`);
  return res.data as T;
}

function count(res: { count: number | null; error: { code?: string } | null }, what: string): number {
  if (res.error) throw new Error(`store: ${what} failed (${res.error.code ?? "no code"})`);
  return res.count ?? 0;
}

/** What the Edge Functions need beyond the service's Store. */
export interface AppStore extends Store {
  /** The credential's owner, or null if there is no such credential. */
  credentialOwner(credentialId: string): Promise<string | null>;
  /** Vault: create or replace this user's ESPN credential. Returns its id. */
  storeCredential(userId: string, creds: { swid: string; espnS2: string }): Promise<string>;
  /** The leagues this user watches, oldest first: a new sign-in is checked against one of them. */
  watchedLeagues(userId: string): Promise<{ leagueId: string; season: number }[]>;
  /** After a fresh sign-in, leagues that were waiting for one are watched again from now. */
  resumeAfterSignIn(credentialId: string, nowIso: string): Promise<void>;
  upsertConnection(c: {
    userId: string;
    credentialId: string;
    leagueId: string;
    season: number;
    teamId: string;
    teamName: string;
    leagueName: string;
    roster: Roster;
    readAt: string;
    nextCheckAt: string;
  }): Promise<ConnectionRow>;
  /** Hand back connections a run took but did not get to, so the next run takes them. */
  releaseConnections(ids: string[], nowIso: string): Promise<void>;
}

export function createStore(db: SupabaseClient): AppStore {
  return {
    async dueConnections(nowIso, limit) {
      const due = must<{ id: string }[]>(
        await db.from("connections").select("id").in("status", WATCHED).lte("next_check_at", nowIso).order("next_check_at").limit(limit),
        "due connections",
      );
      if (!due.length) return [];
      // Taking only rows still due makes this safe against a run that overlaps:
      // Postgres re-checks the condition on a row another run has just leased.
      const lease = new Date(Date.parse(nowIso) + LEASE_MS).toISOString();
      const taken = must<ConnectionDb[]>(
        await db
          .from("connections")
          .update({ next_check_at: lease })
          .in("id", due.map((r) => r.id))
          .in("status", WATCHED)
          .lte("next_check_at", nowIso)
          .select(CONNECTION_COLUMNS),
        "lease connections",
      );
      const order = new Map(due.map((r, i) => [r.id, i]));
      return taken.map(toConnection).sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
    },

    async getConnection(id) {
      const r = must<ConnectionDb | null>(await db.from("connections").select(CONNECTION_COLUMNS).eq("id", id).maybeSingle(), "get connection");
      return r ? toConnection(r) : null;
    },

    async credentials(credentialId) {
      const r = must<unknown>(await db.rpc("read_credential", { p_credential: credentialId }), "read credential");
      if (!r || typeof r !== "object") return null;
      const { swid, espnS2 } = r as { swid?: unknown; espnS2?: unknown };
      return typeof swid === "string" && typeof espnS2 === "string" ? { swid, espnS2 } : null;
    },

    async accountClaimed(userId) {
      return must<boolean | null>(await db.rpc("account_claimed", { p_user: userId }), "account claimed") === true;
    },

    async saveCheck(connectionId, patch) {
      const row: Record<string, unknown> = { last_checked_at: patch.lastCheckedAt, next_check_at: patch.nextCheckAt };
      if (patch.status) row.status = patch.status;
      if (patch.lastRoster) {
        row.last_roster = patch.lastRoster;
        row.last_roster_at = patch.lastCheckedAt;
      }
      must(await db.from("connections").update(row).eq("id", connectionId), "save check");
    },

    async saveRoster(connectionId, roster, readAt) {
      must(await db.from("connections").update({ last_roster: roster, last_roster_at: readAt }).eq("id", connectionId), "save roster");
    },

    async actionsFor(connectionId, findingKey, period) {
      const rows = must<ActionDb[]>(
        await db
          .from("actions")
          .select("*")
          .eq("connection_id", connectionId)
          .eq("finding_key", findingKey)
          .eq("period", period)
          .order("created_at"),
        "actions for finding",
      );
      return rows.map(toAction);
    },

    async getAction(id) {
      const r = must<ActionDb | null>(await db.from("actions").select("*").eq("id", id).maybeSingle(), "get action");
      return r ? toAction(r) : null;
    },

    async insertAction(a: NewAction) {
      const r = must<ActionDb>(
        await db
          .from("actions")
          .insert({
            connection_id: a.connectionId,
            user_id: a.userId,
            finding_key: a.findingKey,
            period: a.period,
            kind: a.kind,
            status: a.status,
            moves: a.moves,
            summary: a.summary,
            reason: a.reason,
            deadline: a.deadline,
            auto_at: a.autoAt,
            signature: a.signature,
          })
          .select("*")
          .single(),
        "insert action",
      );
      return toAction(r);
    },

    async updateAction(id, patch, onlyIf) {
      const row: Record<string, unknown> = { status: patch.status };
      if (patch.result !== undefined) row.result = patch.result;
      if (patch.decidedAt !== undefined) row.decided_at = patch.decidedAt;
      if (patch.executedAt !== undefined) row.executed_at = patch.executedAt;
      // One UPDATE ... WHERE id AND status = onlyIf, so two sides racing for a row (the
      // user's decline, the checker's supersede) cannot both win it.
      let q = db.from("actions").update(row).eq("id", id);
      if (onlyIf !== undefined) q = q.eq("status", onlyIf);
      const changed = must<{ id: string }[]>(await q.select("id"), "update action");
      return changed.length > 0;
    },

    async autoMovesSince(connectionId, sinceIso) {
      // 'approved' is a write in flight: it counts, or a run that dies mid-write would not.
      return count(
        await db
          .from("actions")
          .select("id", { count: "exact", head: true })
          .eq("connection_id", connectionId)
          .eq("kind", "execute")
          .in("status", ["approved", "done", "failed"])
          .gte("created_at", sinceIso),
        "auto moves",
      );
    },

    async openActions(connectionId) {
      const rows = must<ActionDb[]>(
        await db.from("actions").select("*").eq("connection_id", connectionId).in("status", ["pending", "approved"]).order("created_at"),
        "open actions",
      );
      return rows.map(toAction);
    },

    async failedWrites(connectionId, period) {
      return count(
        await db
          .from("actions")
          .select("id", { count: "exact", head: true })
          .eq("connection_id", connectionId)
          .eq("period", period)
          .eq("status", "failed")
          .in("kind", ["execute", "propose"]),
        "failed writes",
      );
    },

    async setWriteVerified(connectionId, at) {
      must(await db.from("connections").update({ write_verified_at: at }).eq("id", connectionId), "set write verified");
    },

    async addActivity(e: ActivityEntry) {
      must(
        await db.from("activity").insert({
          user_id: e.userId,
          connection_id: e.connectionId,
          type: e.type,
          title: e.title,
          body: e.body,
          data: e.data ?? null,
        }),
        "add activity",
      );
    },

    async pushTokens(userId) {
      const rows = must<{ expo_push_token: string }[]>(
        await db.from("devices").select("expo_push_token").eq("user_id", userId),
        "push tokens",
      );
      return rows.map((r) => r.expo_push_token);
    },

    async credentialOwner(credentialId) {
      const r = must<{ user_id: string } | null>(
        await db.from("credentials").select("user_id").eq("id", credentialId).maybeSingle(),
        "credential owner",
      );
      return r?.user_id ?? null;
    },

    async storeCredential(userId, creds) {
      const id = must<unknown>(
        await db.rpc("store_credential", { p_user: userId, p_provider: "espn", p_secret: { swid: creds.swid, espnS2: creds.espnS2 } }),
        "store credential",
      );
      if (typeof id !== "string" || !id) throw new Error("store: store credential returned no id");
      return id;
    },

    async watchedLeagues(userId) {
      const rows = must<{ league_id: string; season: number }[]>(
        await db.from("connections").select("league_id,season").eq("user_id", userId).order("created_at"),
        "watched leagues",
      );
      return rows.map((r) => ({ leagueId: r.league_id, season: r.season }));
    },

    async resumeAfterSignIn(credentialId, nowIso) {
      must(
        await db
          .from("connections")
          .update({ status: "active", next_check_at: nowIso })
          .eq("credential_id", credentialId)
          .eq("status", "needs_reauth"),
        "resume connections",
      );
    },

    async upsertConnection(c) {
      // Only what ESPN told us. The user's settings on an existing connection are kept, its
      // status among them: a pause is the user's off switch and setting the league up again
      // must not flip it. Only a league waiting for a sign-in resumes, since this read is one.
      const r = must<ConnectionDb>(
        await db
          .from("connections")
          .upsert(
            {
              user_id: c.userId,
              credential_id: c.credentialId,
              provider: "espn",
              league_id: c.leagueId,
              season: c.season,
              team_id: c.teamId,
              team_name: c.teamName,
              league_name: c.leagueName,
              last_roster: c.roster,
              last_roster_at: c.readAt,
              next_check_at: c.nextCheckAt,
            },
            { onConflict: "user_id,league_id,season" },
          )
          .select(CONNECTION_COLUMNS)
          .single(),
        "upsert connection",
      );
      const row = toConnection(r);
      if (row.status === "needs_reauth") {
        const resumed = must<{ id: string }[]>(
          await db.from("connections").update({ status: "active" }).eq("id", row.id).eq("status", "needs_reauth").select("id"),
          "resume connection",
        );
        if (resumed.length) row.status = "active";
      }
      return row;
    },

    async releaseConnections(ids, nowIso) {
      if (!ids.length) return;
      must(await db.from("connections").update({ next_check_at: nowIso }).in("id", ids), "release connections");
    },
  };
}
