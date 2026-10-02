// The user's own rows, read straight from Supabase under RLS: their league connections,
// proposals waiting for an answer, and the activity log. Writes are limited to what the
// database grants a client: protection, bench swaps, replacement order, pause/resume.

import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Authority, Move, Roster } from "@rosterbots/core";
import type { ActionKind, ActionStatus, ActivityType, ConnectionStatus } from "@rosterbots/service";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useSession } from "./session";
import { supabase } from "./supabase";

export interface Connection {
  id: string;
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
  /** The last roster read from ESPN, in core's shape. */
  lastRoster: Roster | null;
  lastRosterAt: string | null;
}

export interface Proposal {
  id: string;
  connectionId: string;
  findingKey: string;
  period: number;
  kind: ActionKind;
  status: ActionStatus;
  moves: Move[];
  summary: string;
  reason: string;
  deadline: string | null;
  autoAt: string | null;
  createdAt: string;
}

export interface ActivityItem {
  id: string;
  connectionId: string;
  type: ActivityType;
  title: string;
  body: string;
  data: Record<string, unknown> | null;
  createdAt: string;
}

export type ConnectionPatch = Partial<Pick<Connection, "authority" | "benchSwaps" | "replacementOrder">> & { status?: "active" | "paused" };

const CONNECTION_COLUMNS =
  "id,league_id,season,team_id,team_name,league_name,status,authority,bench_swaps,replacement_order,max_auto_moves_per_day,last_checked_at,next_check_at,last_roster,last_roster_at";
const ACTION_COLUMNS = "id,connection_id,finding_key,period,kind,status,moves,summary,reason,deadline,auto_at,created_at";
const ACTIVITY_COLUMNS = "id,connection_id,type,title,body,data,created_at";

// Remembers which league Home shows on this phone. A convenience only.
const SELECTED_KEY = "hangoverbot.selectedConnection";

type Raw = Record<string, unknown>;
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

function toConnection(r: Raw): Connection {
  return {
    id: String(r.id),
    leagueId: String(r.league_id),
    season: Number(r.season),
    teamId: str(r.team_id),
    teamName: str(r.team_name),
    leagueName: str(r.league_name),
    status: r.status as ConnectionStatus,
    authority: r.authority as Authority,
    benchSwaps: r.bench_swaps !== false,
    replacementOrder: Array.isArray(r.replacement_order) ? (r.replacement_order as string[]) : [],
    maxAutoMovesPerDay: typeof r.max_auto_moves_per_day === "number" ? r.max_auto_moves_per_day : 3,
    lastCheckedAt: str(r.last_checked_at),
    nextCheckAt: str(r.next_check_at),
    lastRoster: r.last_roster && typeof r.last_roster === "object" ? (r.last_roster as Roster) : null,
    lastRosterAt: str(r.last_roster_at),
  };
}

function toProposal(r: Raw): Proposal {
  return {
    id: String(r.id),
    connectionId: String(r.connection_id),
    findingKey: String(r.finding_key),
    period: Number(r.period),
    kind: r.kind as ActionKind,
    status: r.status as ActionStatus,
    moves: Array.isArray(r.moves) ? (r.moves as Move[]) : [],
    summary: String(r.summary ?? ""),
    reason: String(r.reason ?? ""),
    deadline: str(r.deadline),
    autoAt: str(r.auto_at),
    createdAt: String(r.created_at),
  };
}

function toActivity(r: Raw): ActivityItem {
  return {
    id: String(r.id),
    connectionId: String(r.connection_id),
    type: r.type as ActivityType,
    title: String(r.title ?? ""),
    body: String(r.body ?? ""),
    data: r.data && typeof r.data === "object" ? (r.data as Record<string, unknown>) : null,
    createdAt: String(r.created_at),
  };
}

/** Postgres and the network, in words a person can act on. */
export function dbMessage(error: { message?: string } | null | undefined): string {
  const m = error?.message ?? "";
  if (!m || /network|fetch|timed? ?out/i.test(m)) return "Can't reach HangoverBot. Check your connection and try again.";
  return m.charAt(0).toUpperCase() + m.slice(1) + (m.endsWith(".") ? "" : ".");
}

interface Data {
  loading: boolean;
  /** Set when the last refresh failed; the previous rows stay on screen. */
  error: string | null;
  connections: Connection[];
  /** The league Home shows. */
  connection: Connection | null;
  /** Proposals still waiting for an answer, newest first, for every league. */
  pending: Proposal[];
  activity: ActivityItem[];
  refresh: () => Promise<void>;
  select: (connectionId: string) => void;
  updateConnection: (connectionId: string, patch: ConnectionPatch) => Promise<void>;
}

const DataContext = createContext<Data | null>(null);

export function DataProvider(props: { children: ReactNode }) {
  const { user } = useSession();
  const userId = user?.id ?? null;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [pending, setPending] = useState<Proposal[]>([]);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const run = useRef(0);

  useEffect(() => {
    AsyncStorage.getItem(SELECTED_KEY)
      .then((id) => id && setSelectedId((cur) => cur ?? id))
      .catch(() => {});
  }, []);

  const refresh = useCallback(async () => {
    if (!userId) return;
    const mine = ++run.current;
    const [c, a, act] = await Promise.all([
      supabase.from("connections").select(CONNECTION_COLUMNS).order("created_at", { ascending: true }),
      supabase.from("actions").select(ACTION_COLUMNS).eq("kind", "propose").eq("status", "pending").order("created_at", { ascending: false }).limit(25),
      supabase.from("activity").select(ACTIVITY_COLUMNS).order("created_at", { ascending: false }).limit(60),
    ]);
    // A newer refresh started meanwhile; its answer wins.
    if (mine !== run.current) return;
    const failed = c.error ?? a.error ?? act.error;
    if (!c.error) setConnections((c.data ?? []).map((r) => toConnection(r as Raw)));
    if (!a.error) {
      const now = Date.now();
      // Past its deadline, a proposal can't be acted on; the checker marks it expired.
      setPending((a.data ?? []).map((r) => toProposal(r as Raw)).filter((p) => !p.deadline || Date.parse(p.deadline) > now));
    }
    if (!act.error) setActivity((act.data ?? []).map((r) => toActivity(r as Raw)));
    setError(failed ? dbMessage(failed) : null);
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    setLoading(true);
    refresh().catch(() => {
      setError(dbMessage(null));
      setLoading(false);
    });
  }, [userId, refresh]);

  const select = useCallback((id: string) => {
    setSelectedId(id);
    AsyncStorage.setItem(SELECTED_KEY, id).catch(() => {});
  }, []);

  const updateConnection = useCallback(
    async (id: string, patch: ConnectionPatch) => {
      const row: Raw = {};
      if (patch.authority !== undefined) row.authority = patch.authority;
      if (patch.benchSwaps !== undefined) row.bench_swaps = patch.benchSwaps;
      if (patch.replacementOrder !== undefined) row.replacement_order = patch.replacementOrder;
      if (patch.status !== undefined) row.status = patch.status;
      const { error: e } = await supabase.from("connections").update(row).eq("id", id);
      if (e) throw new Error(dbMessage(e));
      await refresh();
    },
    [refresh],
  );

  const value = useMemo<Data>(() => {
    const connection = connections.find((c) => c.id === selectedId) ?? connections[0] ?? null;
    return { loading, error, connections, connection, pending, activity, refresh, select, updateConnection };
  }, [loading, error, connections, selectedId, pending, activity, refresh, select, updateConnection]);

  return <DataContext.Provider value={value}>{props.children}</DataContext.Provider>;
}

export function useData(): Data {
  const d = useContext(DataContext);
  if (!d) throw new Error("useData outside DataProvider");
  return d;
}

/** Pull-to-refresh for a screen of these rows: the spinner stays until the rows are back. */
export function usePull(): { refreshing: boolean; onRefresh: () => void } {
  const { refresh } = useData();
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(() => {
    setRefreshing(true);
    refresh()
      .catch(() => {})
      .finally(() => setRefreshing(false));
  }, [refresh]);
  return { refreshing, onRefresh };
}
