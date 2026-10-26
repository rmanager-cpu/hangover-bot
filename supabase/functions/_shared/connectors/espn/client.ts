// Copied from packages/connectors/src/espn\client.ts by scripts/build-functions.ts. Edit the original.
// The ESPN connector. Reads are the v3 league API Megacast used all season; the write is
// the ROSTER transaction the ESPN site sends when you move a player, and is UNPROVEN (see
// docs/MEGACAST-AUDIT.md). The free-agent read and the FREEAGENT add/drop transaction are
// built the same way, from what the ESPN site and community clients send, and are unproven
// too. The caller always re-reads after a write.
//
// Never log a request or its headers: they carry the member's cookies.

import type { FreeAgent, Game, Move, Player, Roster, RosterEntry, Slot } from "@rosterbots/core";
import { AuthError, ProviderError, type AddDrop, type ConnectorCapabilities, type FantasyConnector, type LeagueSummary } from "../types.ts";
import { ID_BY_SLOT, positionOf, proTeamOf, slotOf, statusOf } from "./maps.ts";

export interface EspnCredentials {
  /** Keeps its curly braces. */
  swid: string;
  espnS2: string;
}

export interface EspnOptions {
  season: number;
  credentials: EspnCredentials;
  /** Injected for tests. */
  fetch?: typeof fetch;
  timeoutMs?: number;
}

const READS = "https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/";
const WRITES = "https://lm-api-writes.fantasy.espn.com/apis/v3/games/ffl/seasons/";

// The subset of ESPN's payloads we read. Everything is optional because ESPN
// omits fields freely, and a missing field must degrade, not throw.
interface EspnPlayer {
  id: number;
  fullName?: string;
  defaultPositionId?: number;
  proTeamId?: number;
  eligibleSlots?: number[];
  injuryStatus?: string;
  injured?: boolean;
  /** statSourceId 1 is a projection; scoringPeriodId 0 is the whole season. */
  stats?: { statSourceId?: number; scoringPeriodId?: number; statSplitTypeId?: number; appliedTotal?: number }[];
  ownership?: { percentOwned?: number };
}
interface EspnEntry {
  playerId: number;
  lineupSlotId: number;
  playerPoolEntry?: { lineupLocked?: boolean; player?: EspnPlayer };
}
interface EspnTeam {
  id: number;
  name?: string;
  location?: string;
  nickname?: string;
  owners?: string[];
  roster?: { entries?: EspnEntry[] };
}
export interface EspnLeague {
  scoringPeriodId?: number;
  status?: { latestScoringPeriod?: number };
  settings?: { name?: string; rosterSettings?: { lineupSlotCounts?: Record<string, number> } };
  teams?: EspnTeam[];
}
export interface EspnSchedule {
  settings?: {
    proTeams?: {
      id: number;
      byeWeek?: number;
      proGamesByScoringPeriod?: Record<string, { date: number; homeProTeamId: number; awayProTeamId: number }[]>;
    }[];
  };
}
/** The league's player pool (view kona_player_info): everyone the filter matched, with whose they are. */
export interface EspnPlayers {
  players?: { id: number; onTeamId?: number; status?: string; player?: EspnPlayer }[];
}

const BENCH_ID = String(ID_BY_SLOT.BENCH);
const IR_ID = String(ID_BY_SLOT.IR);

/** This week's games and bye weeks by pro team, from the schedule payload, or nothing known. */
function gamesIn(schedule: EspnSchedule | undefined, period: number) {
  const proTeams = schedule?.settings?.proTeams;
  const gameOf = (proTeamId: number | undefined): Game | null | undefined => {
    if (!proTeams) return undefined; // schedule unknown
    // A missing team is a half-read, not a bye: a bye would bench a healthy starter.
    if (proTeamId === undefined) return undefined;
    if (proTeamId === 0) return null; // a free agent has no game
    const pt = proTeams.find((t) => t.id === proTeamId);
    if (!pt) return undefined;
    const g = pt.proGamesByScoringPeriod?.[String(period)]?.[0];
    if (g) {
      const opp = g.homeProTeamId === proTeamId ? g.awayProTeamId : g.homeProTeamId;
      return { kickoff: new Date(g.date).toISOString(), opponent: proTeamOf(opp) };
    }
    return pt.byeWeek === period ? null : undefined;
  };
  const byeWeekOf = (proTeamId: number | undefined): number | undefined => proTeams?.find((t) => t.id === proTeamId)?.byeWeek;
  return { gameOf, byeWeekOf };
}

/** ESPN's player to core's, for a roster entry or a free agent. */
function toPlayer(id: number, p: EspnPlayer | undefined, locked: boolean, games: ReturnType<typeof gamesIn>, period: number): Player {
  const projection = p?.stats?.find((s) => s.statSourceId === 1 && s.scoringPeriodId === period)?.appliedTotal;
  const season = p?.stats?.find((s) => s.statSourceId === 1 && s.scoringPeriodId === 0)?.appliedTotal;
  const owned = p?.ownership?.percentOwned;
  const bye = games.byeWeekOf(p?.proTeamId);
  return {
    id: String(id),
    name: p?.fullName ?? String(id),
    position: positionOf(p?.defaultPositionId),
    proTeam: proTeamOf(p?.proTeamId),
    // No player data at all: nothing is known about him, so nothing moves him.
    status: p ? statusOf(p.injuryStatus, p.injured) : "unknown",
    eligibleSlots: (p?.eligibleSlots ?? []).map(slotOf).filter((s): s is Slot => s !== undefined),
    game: games.gameOf(p?.proTeamId),
    locked,
    ...(typeof projection === "number" ? { projection } : {}),
    ...(typeof season === "number" ? { seasonProjection: season } : {}),
    ...(typeof owned === "number" ? { percentRostered: owned } : {}),
    ...(typeof bye === "number" ? { byeWeek: bye } : {}),
  };
}

/** Pure: ESPN's league + schedule payloads to core's roster. Exported for tests. */
export function toRoster(league: EspnLeague, schedule: EspnSchedule | undefined, swid: string): Roster {
  const team = (league.teams ?? []).find((t) => (t.owners ?? []).includes(swid));
  if (!team) throw new ProviderError("these credentials manage no team in this league", 200);
  const period = league.scoringPeriodId ?? league.status?.latestScoringPeriod ?? 0;

  const counts = league.settings?.rosterSettings?.lineupSlotCounts ?? {};
  const starterSlots: Slot[] = [];
  for (const [id, count] of Object.entries(counts)) {
    const slot = slotOf(Number(id));
    if (!slot || slot === "BENCH" || slot === "IR") continue;
    for (let i = 0; i < count; i++) starterSlots.push(slot);
  }
  const benchSlots = counts[BENCH_ID];
  const irSlots = counts[IR_ID];

  const games = gamesIn(schedule, period);
  const entries: RosterEntry[] = [];
  for (const e of team.roster?.entries ?? []) {
    const slot = slotOf(e.lineupSlotId);
    if (!slot) continue; // a slot we do not model (IDP): we never touch it
    entries.push({ player: toPlayer(e.playerId, e.playerPoolEntry?.player, Boolean(e.playerPoolEntry?.lineupLocked), games, period), slot });
  }

  const name = (team.name ?? `${team.location ?? ""} ${team.nickname ?? ""}`).trim();
  return {
    teamId: String(team.id),
    teamName: name,
    period,
    starterSlots,
    entries,
    ...(typeof benchSlots === "number" ? { benchSlots } : {}),
    ...(typeof irSlots === "number" ? { irSlots } : {}),
  };
}

/** Pure: the player pool to free agents. Anyone on a team is left out; waivers are marked. Exported for tests. */
export function toFreeAgents(pool: EspnPlayers, schedule: EspnSchedule | undefined, period: number): FreeAgent[] {
  const games = gamesIn(schedule, period);
  const out: FreeAgent[] = [];
  for (const e of pool.players ?? []) {
    if (e.onTeamId !== undefined && e.onTeamId !== 0) continue;
    if (e.status !== "FREEAGENT" && e.status !== "WAIVERS") continue;
    out.push({ player: toPlayer(e.id, e.player, false, games, period), onWaivers: e.status === "WAIVERS" });
  }
  return out;
}

/** The body ESPN's site posts to move players. Exported for tests. */
export function toTransaction(moves: Move[], teamId: string, swid: string, period: number) {
  return {
    isLeagueManager: false,
    teamId: Number(teamId),
    type: "ROSTER",
    memberId: swid,
    scoringPeriodId: period,
    executionType: "EXECUTE",
    items: moves.map((m) => ({
      playerId: Number(m.playerId),
      type: "LINEUP",
      fromLineupSlotId: ID_BY_SLOT[m.from],
      toLineupSlotId: ID_BY_SLOT[m.to],
    })),
  };
}

/** The body ESPN's site posts to add a free agent, with the drop that makes room. Exported for tests. */
export function toAddDrop(tx: AddDrop, teamId: string, swid: string, period: number) {
  const team = Number(teamId);
  return {
    isLeagueManager: false,
    teamId: team,
    type: "FREEAGENT",
    memberId: swid,
    scoringPeriodId: period,
    executionType: "EXECUTE",
    items: [
      { playerId: Number(tx.add.playerId), type: "ADD", toTeamId: team, toLineupSlotId: ID_BY_SLOT[tx.add.toSlot] },
      ...(tx.drop ? [{ playerId: Number(tx.drop.playerId), type: "DROP", fromTeamId: team, fromLineupSlotId: ID_BY_SLOT[tx.drop.fromSlot] }] : []),
    ],
  };
}

/** The x-fantasy-filter the ESPN site sends for the free-agent list. Exported for tests. */
export function freeAgentFilter(season: number, period: number, slots: Slot[] | undefined, limit: number) {
  return {
    players: {
      filterStatus: { value: ["FREEAGENT", "WAIVERS"] },
      ...(slots?.length ? { filterSlotIds: { value: slots.map((s) => ID_BY_SLOT[s]) } } : {}),
      limit,
      sortPercOwned: { sortPriority: 1, sortAsc: false },
      filterRanksForScoringPeriodIds: { value: [period] },
      // The stat sets to send back: season actuals and projections, and this week's projection.
      filterStatsForTopScoringPeriodIds: { value: 2, additionalValue: [`00${season}`, `10${season}`, `11${season}${period}`, `02${season}`] },
    },
  };
}

const CAPS: ConnectorCapabilities = {
  supported: [
    "READ_LEAGUE", "READ_ROSTER", "READ_PLAYER_AVAILABILITY", "READ_LINEUP_LOCKS", "WRITE_LINEUP", "VERIFY_TRANSACTION",
    "READ_FREE_AGENTS", "ADD_FREE_AGENT", "DROP_PLAYER", "MOVE_TO_IR",
  ],
  // Built from what the ESPN site sends, never yet run against a real league.
  unverified: ["WRITE_LINEUP", "READ_FREE_AGENTS", "ADD_FREE_AGENT", "DROP_PLAYER", "MOVE_TO_IR"],
};

// ESPN's fan profile lists every game a member plays. Read the way the ESPN site
// and community clients read it; not yet seen from this code. UNVERIFIED.
const FAN = "https://fan.api.espn.com/apis/v2/fans/";
interface EspnFan {
  preferences?: {
    metaData?: {
      entry?: {
        abbrev?: string;
        gameId?: number;
        seasonId?: number;
        entryId?: number;
        entryLocation?: string;
        entryNickname?: string;
        groups?: { groupId?: number; groupName?: string }[];
      };
    };
  }[];
}

/** Pure: the fan profile to this season's football leagues. Exported for tests. */
export function toLeagues(fan: EspnFan, season: number): LeagueSummary[] {
  const out: LeagueSummary[] = [];
  for (const pref of fan.preferences ?? []) {
    const e = pref.metaData?.entry;
    if (!e || (e.abbrev !== "FFL" && e.gameId !== 1) || e.seasonId !== season) continue;
    const g = e.groups?.[0];
    if (!g?.groupId) continue;
    const teamName = `${e.entryLocation ?? ""} ${e.entryNickname ?? ""}`.trim();
    out.push({
      leagueId: String(g.groupId),
      leagueName: g.groupName ?? "",
      season,
      ...(e.entryId !== undefined ? { teamId: String(e.entryId) } : {}),
      ...(teamName ? { teamName } : {}),
    });
  }
  return out;
}

const DEFAULT_FREE_AGENTS = 40;

export function espnConnector(opts: EspnOptions): FantasyConnector {
  const f = opts.fetch ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 15000;
  const { swid, espnS2 } = opts.credentials;
  const cookie = `SWID=${swid}; espn_s2=${espnS2}`;
  const leagueUrl = (leagueId: string) => `${READS}${opts.season}/segments/0/leagues/${leagueId}`;
  const teamIds = new Map<string, string>();

  async function get<T>(url: string, what: string, extra: Record<string, string> = {}): Promise<T> {
    const r = await f(url, { signal: AbortSignal.timeout(timeoutMs), headers: { accept: "application/json", cookie, ...extra } });
    if (r.status === 401 || r.status === 403) throw new AuthError(r.status);
    if (!r.ok) throw new ProviderError(what, r.status);
    return (await r.json()) as T;
  }

  // The schedule only adds kickoff times and byes. Without it the engine still works, more
  // cautiously, so its failure is not the roster's failure. Read once per connector: one
  // check reads the team and the free agents several times, and the schedule is the season's.
  let scheduleRead: Promise<EspnSchedule | undefined> | undefined;
  const schedule = () => {
    scheduleRead ??= get<EspnSchedule>(`${READS}${opts.season}?view=proTeamSchedules_wl`, "schedule").catch((e) => {
      if (e instanceof AuthError) throw e;
      return undefined;
    });
    return scheduleRead;
  };

  async function getRoster(leagueId: string): Promise<Roster> {
    const [lg, sched] = await Promise.all([get<EspnLeague>(`${leagueUrl(leagueId)}?view=mRoster&view=mTeam&view=mSettings&view=mStatus`, "roster"), schedule()]);
    const roster = toRoster(lg, sched, swid);
    teamIds.set(leagueId, roster.teamId);
    return roster;
  }

  async function post(leagueId: string, body: unknown) {
    const r = await f(`${WRITES}${opts.season}/segments/0/leagues/${leagueId}/transactions/`, {
      method: "POST",
      signal: AbortSignal.timeout(timeoutMs),
      headers: { accept: "application/json", "content-type": "application/json", cookie },
      body: JSON.stringify(body),
    });
    if (r.status === 401 || r.status === 403) throw new AuthError(r.status);
    let detail = "";
    try {
      const j = (await r.json()) as { status?: string; type?: string; message?: string };
      detail = [j.status, j.type, j.message].filter(Boolean).join(" ");
    } catch {}
    return { httpStatus: r.status, detail };
  }

  return {
    provider: "espn",

    capabilities: () => CAPS,

    async getLeagues() {
      return toLeagues(await get<EspnFan>(FAN + encodeURIComponent(swid), "fan profile"), opts.season);
    },

    async getMyTeam(leagueId) {
      const lg = await get<EspnLeague>(`${leagueUrl(leagueId)}?view=mTeam&view=mSettings`, "league");
      const team = (lg.teams ?? []).find((t) => (t.owners ?? []).includes(swid));
      if (!team) throw new ProviderError("these credentials manage no team in league " + leagueId, 200);
      teamIds.set(leagueId, String(team.id));
      const teamName = (team.name ?? `${team.location ?? ""} ${team.nickname ?? ""}`).trim();
      return { teamId: String(team.id), teamName, leagueName: lg.settings?.name ?? "" };
    },

    getRoster,

    async setLineup(leagueId, moves, period) {
      const teamId = teamIds.get(leagueId) ?? (await getRoster(leagueId)).teamId;
      return post(leagueId, toTransaction(moves, teamId, swid, period));
    },

    async getFreeAgents(leagueId, period, o = {}) {
      const filter = freeAgentFilter(opts.season, period, o.slots, o.limit ?? DEFAULT_FREE_AGENTS);
      const [pool, sched] = await Promise.all([
        get<EspnPlayers>(`${leagueUrl(leagueId)}?view=kona_player_info&scoringPeriodId=${period}`, "free agents", { "x-fantasy-filter": JSON.stringify(filter) }),
        schedule(),
      ]);
      return toFreeAgents(pool, sched, period);
    },

    async addDrop(leagueId, tx, period) {
      const teamId = teamIds.get(leagueId) ?? (await getRoster(leagueId)).teamId;
      return post(leagueId, toAddDrop(tx, teamId, swid, period));
    },
  };
}
