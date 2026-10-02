// The ESPN connector. Reads are the v3 league API Megacast used all season; the
// write is the ROSTER transaction the ESPN site sends when you move a player, and
// is UNPROVEN (see docs/MEGACAST-AUDIT.md). The caller always re-reads after a write.
//
// Never log a request or its headers: they carry the member's cookies.

import type { Game, Move, Player, Roster, RosterEntry, Slot } from "@rosterbots/core";
import { AuthError, PlatformError, type Connector } from "../types.ts";
import { ID_BY_SLOT, positionOf, proTeamOf, slotOf, statusOf } from "./maps.ts";

export interface EspnCredentials {
  /** Keeps its curly braces. */
  swid: string;
  espnS2: string;
}

export interface EspnOptions {
  leagueId: string;
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
  if (!team) throw new PlatformError("these credentials manage no team in this league:", 200);
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

export function espnConnector(opts: EspnOptions): Connector {
  const f = opts.fetch ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 15000;
  const { swid, espnS2 } = opts.credentials;
  const cookie = `SWID=${swid}; espn_s2=${espnS2}`;
  const league = `${READS}${opts.season}/segments/0/leagues/${opts.leagueId}`;
  let teamId: string | undefined;

  async function get<T>(url: string, what: string): Promise<T> {
    const r = await f(url, { signal: AbortSignal.timeout(timeoutMs), headers: { accept: "application/json", cookie } });
    if (r.status === 401 || r.status === 403) throw new AuthError(r.status);
    if (!r.ok) throw new PlatformError(what, r.status);
    return (await r.json()) as T;
  }

  async function getRoster(): Promise<Roster> {
    const [lg, schedule] = await Promise.all([
      get<EspnLeague>(`${league}?view=mRoster&view=mTeam&view=mSettings&view=mStatus`, "roster"),
      // The schedule only adds kickoff times and byes. Without it the engine still
      // works, more cautiously, so its failure is not the roster's failure.
      get<EspnSchedule>(`${READS}${opts.season}?view=proTeamSchedules_wl`, "schedule").catch((e) => {
        if (e instanceof AuthError) throw e;
        return undefined;
      }),
    ]);
    const roster = toRoster(lg, schedule, swid);
    teamId = roster.teamId;
    return roster;
  }

  return {
    platform: "espn",

    async identify() {
      const lg = await get<EspnLeague>(`${league}?view=mTeam&view=mSettings`, "league");
      const team = (lg.teams ?? []).find((t) => (t.owners ?? []).includes(swid));
      if (!team) throw new PlatformError("these credentials manage no team in this league:", 200);
      teamId = String(team.id);
      const teamName = (team.name ?? `${team.location ?? ""} ${team.nickname ?? ""}`).trim();
      return { memberId: swid, teamId, teamName, leagueName: lg.settings?.name ?? "" };
    },

    getRoster,

    async submitMoves(moves, period) {
      if (!teamId) teamId = (await getRoster()).teamId;
      const r = await f(`${WRITES}${opts.season}/segments/0/leagues/${opts.leagueId}/transactions/`, {
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
