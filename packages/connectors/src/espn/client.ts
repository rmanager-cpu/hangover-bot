// The ESPN connector. Reads are the v3 league API Megacast used all season; the
// write is the ROSTER transaction the ESPN site sends when you move a player, and
// is UNPROVEN (see docs/MEGACAST-AUDIT.md). The caller always re-reads after a write.
//
// Never log a request or its headers: they carry the member's cookies.

import type { Game, Move, Player, Roster, RosterEntry, Slot } from "@rosterbots/core";
import { AuthError, ProviderError, type ConnectorCapabilities, type FantasyConnector, type LeagueSummary } from "../types.ts";
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
  stats?: { statSourceId?: number; scoringPeriodId?: number; appliedTotal?: number }[];
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

/** Pure: ESPN's league + schedule payloads to core's roster. Exported for tests. */
export function toRoster(league: EspnLeague, schedule: EspnSchedule | undefined, swid: string): Roster {
  const team = (league.teams ?? []).find((t) => (t.owners ?? []).includes(swid));
  if (!team) throw new ProviderError("these credentials manage no team in this league", 200);
  const period = league.scoringPeriodId ?? league.status?.latestScoringPeriod ?? 0;

  const starterSlots: Slot[] = [];
  for (const [id, count] of Object.entries(league.settings?.rosterSettings?.lineupSlotCounts ?? {})) {
    const slot = slotOf(Number(id));
    if (!slot || slot === "BENCH" || slot === "IR") continue;
    for (let i = 0; i < count; i++) starterSlots.push(slot);
  }

  const proTeams = schedule?.settings?.proTeams;
  const gameOf = (proTeamId: number | undefined): Game | null | undefined => {
    if (!proTeams) return undefined; // schedule unknown
    if (!proTeamId) return null; // a free agent has no game
    const pt = proTeams.find((t) => t.id === proTeamId);
    if (!pt) return undefined;
    const g = pt.proGamesByScoringPeriod?.[String(period)]?.[0];
    if (g) {
      const opp = g.homeProTeamId === proTeamId ? g.awayProTeamId : g.homeProTeamId;
      return { kickoff: new Date(g.date).toISOString(), opponent: proTeamOf(opp) };
    }
    return pt.byeWeek === period ? null : undefined;
  };

  const entries: RosterEntry[] = [];
  for (const e of team.roster?.entries ?? []) {
    const slot = slotOf(e.lineupSlotId);
    if (!slot) continue; // a slot we do not model (IDP): we never touch it
    const p = e.playerPoolEntry?.player;
    const projection = p?.stats?.find((s) => s.statSourceId === 1 && s.scoringPeriodId === period)?.appliedTotal;
    const player: Player = {
      id: String(e.playerId),
      name: p?.fullName ?? String(e.playerId),
      position: positionOf(p?.defaultPositionId),
      proTeam: proTeamOf(p?.proTeamId),
      status: statusOf(p?.injuryStatus, p?.injured),
      eligibleSlots: (p?.eligibleSlots ?? []).map(slotOf).filter((s): s is Slot => s !== undefined),
      game: gameOf(p?.proTeamId),
      locked: Boolean(e.playerPoolEntry?.lineupLocked),
      ...(typeof projection === "number" ? { projection } : {}),
    };
    entries.push({ player, slot });
  }

  const name = (team.name ?? `${team.location ?? ""} ${team.nickname ?? ""}`).trim();
  return { teamId: String(team.id), teamName: name, period, starterSlots, entries };
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

const CAPS: ConnectorCapabilities = {
  supported: ["READ_LEAGUE", "READ_ROSTER", "READ_PLAYER_AVAILABILITY", "READ_LINEUP_LOCKS", "WRITE_LINEUP", "VERIFY_TRANSACTION"],
  // Built from what the ESPN site sends, never yet run against a real league.
  unverified: ["WRITE_LINEUP"],
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

export function espnConnector(opts: EspnOptions): FantasyConnector {
  const f = opts.fetch ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 15000;
  const { swid, espnS2 } = opts.credentials;
  const cookie = `SWID=${swid}; espn_s2=${espnS2}`;
  const leagueUrl = (leagueId: string) => `${READS}${opts.season}/segments/0/leagues/${leagueId}`;
  const teamIds = new Map<string, string>();

  async function get<T>(url: string, what: string): Promise<T> {
    const r = await f(url, { signal: AbortSignal.timeout(timeoutMs), headers: { accept: "application/json", cookie } });
    if (r.status === 401 || r.status === 403) throw new AuthError(r.status);
    if (!r.ok) throw new ProviderError(what, r.status);
    return (await r.json()) as T;
  }

  async function getRoster(leagueId: string): Promise<Roster> {
    const [lg, schedule] = await Promise.all([
      get<EspnLeague>(`${leagueUrl(leagueId)}?view=mRoster&view=mTeam&view=mSettings&view=mStatus`, "roster"),
      // The schedule only adds kickoff times and byes. Without it the engine still
      // works, more cautiously, so its failure is not the roster's failure.
      get<EspnSchedule>(`${READS}${opts.season}?view=proTeamSchedules_wl`, "schedule").catch((e) => {
        if (e instanceof AuthError) throw e;
        return undefined;
      }),
    ]);
    const roster = toRoster(lg, schedule, swid);
    teamIds.set(leagueId, roster.teamId);
    return roster;
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
      const r = await f(`${WRITES}${opts.season}/segments/0/leagues/${leagueId}/transactions/`, {
        method: "POST",
        signal: AbortSignal.timeout(timeoutMs),
        headers: { accept: "application/json", "content-type": "application/json", cookie },
        body: JSON.stringify(toTransaction(moves, teamId, swid, period)),
      });
      if (r.status === 401 || r.status === 403) throw new AuthError(r.status);
      let detail = "";
      try {
        const j = (await r.json()) as { status?: string; type?: string; message?: string };
        detail = [j.status, j.type, j.message].filter(Boolean).join(" ");
      } catch {}
      return { httpStatus: r.status, detail };
    },
  };
}
