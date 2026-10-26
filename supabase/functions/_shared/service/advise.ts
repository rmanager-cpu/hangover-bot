// Copied from packages/service/src/advise.ts by scripts/build-functions.ts. Edit the original.
// Roster Advice (docs/AI-NATIVE.md): a scan of the roster and the free agents, with the
// AI's limited web search, a few times a week. Nothing here changes a lineup: each item
// with an action is a pending `advise` row the user carries out with one tap through
// decideAction, under the same No-Cray Rules (the Droppable switch alone is theirs to waive).

import { BENCH, IR, noCray, outsideCandidates, rosterLooksSane, type Advice, type AdviceInput, type AdvicePlayer, type Candidate, type FreeAgent, type Player, type Room, type Roster, type RosterEntry, type Settings } from "@rosterbots/core";
import { announce, connect, isSignedOut, outsideHistory, readTeamPatiently, settingsFor, signature, signedOut, storedTransaction } from "./ops.ts";
import type { ConnectionRow, Deps } from "./types.ts";
import { adviceNotice } from "./words.ts";

const HOUR = 3_600_000;

/** How many free agents the Advisor sees: enough to find a backup, few enough to read. */
const FREE_AGENTS = 60;

const ET = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric", hour12: false });

/** An advice moment: 10 AM Eastern Tuesday to Saturday (the week's injuries, before the waiver run), and 6 PM Saturday (Sunday's byes and tags). */
function isAdviceMoment(at: Date): boolean {
  const parts = ET.formatToParts(at);
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "-1") % 24;
  if (["Tue", "Wed", "Thu", "Fri", "Sat"].includes(weekday) && hour === 10) return true;
  return weekday === "Sat" && hour === 18;
}

/** The most recent advice moment at or before `now`, within the last week. Exported for tests. */
export function lastAdviceMoment(now: Date): Date | undefined {
  const top = new Date(Math.floor(now.getTime() / HOUR) * HOUR);
  for (let h = 0; h < 7 * 24; h++) {
    const at = new Date(top.getTime() - h * HOUR);
    if (isAdviceMoment(at)) return at;
  }
  return undefined;
}

/** Due when AI Native is on and the league has not been advised since the last moment. */
export function adviceDue(conn: ConnectionRow, now: Date): boolean {
  if (conn.authority !== "ai_rescue" || conn.status !== "active") return false;
  const moment = lastAdviceMoment(now);
  if (!moment) return false;
  return conn.advisedAt === null || Date.parse(conn.advisedAt) < moment.getTime();
}

function advicePlayer(p: Player, slot?: RosterEntry["slot"], onWaivers?: boolean): AdvicePlayer {
  return {
    id: p.id,
    name: p.name,
    position: p.position,
    proTeam: p.proTeam,
    ...(slot ? { slot } : {}),
    status: p.status,
    ...(p.projection !== undefined ? { projection: p.projection } : {}),
    ...(p.seasonProjection !== undefined ? { seasonProjection: p.seasonProjection } : {}),
    ...(p.percentRostered !== undefined ? { percentRostered: p.percentRostered } : {}),
    ...(p.byeWeek !== undefined ? { byeWeek: p.byeWeek } : {}),
    ...(p.game?.kickoff ? { kickoff: p.game.kickoff } : {}),
    ...(p.game?.opponent ? { opponent: p.game.opponent } : {}),
    ...(onWaivers !== undefined ? { onWaivers } : {}),
  };
}

/** Exported for tests. */
export function adviceInput(conn: ConnectionRow, roster: Roster, freeAgents: FreeAgent[], settings: Settings, now: Date): AdviceInput {
  return {
    teamName: roster.teamName || conn.teamName || "your team",
    week: roster.period,
    now: now.toISOString(),
    starterSlots: roster.starterSlots,
    roster: roster.entries.map((e) => advicePlayer(e.player, e.slot)),
    freeAgents: freeAgents.map((f) => advicePlayer(f.player, undefined, f.onWaivers)),
    droppable: settings.droppable,
  };
}

const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);

/**
 * The item's one-tap action as a candidate: the add from the free agents, the drop the AI
 * named (the Droppable switch is the user's to waive by tapping; a season-ending injury the
 * AI read about counts for the drop, since the tap takes it), or the room the rules would
 * make. `unknown` when the item names a player who is not there: not advice at all.
 * Undefined when the move breaks a rule: the item stays as a heads-up, with no tap.
 */
function candidateOf(item: Advice, roster: Roster, freeAgents: FreeAgent[], settings: Settings, now: Date, history: Awaited<ReturnType<typeof outsideHistory>>): Candidate | undefined | "unknown" {
  const addId = item.action?.add;
  if (!addId) return undefined;
  const fa = freeAgents.find((f) => f.player.id === addId);
  if (!fa) return "unknown";
  if (fa.onWaivers) return undefined;
  const ctx = { roster, settings, now, history, slot: BENCH, baseline: 0, purpose: "advice" as const };
  const dropId = item.action?.drop;
  if (dropId) {
    const e = roster.entries.find((x) => x.player.id === dropId);
    if (!e) return "unknown";
    if (e.slot === IR) return undefined;
    const player: Player = item.action?.outForSeason ? { ...e.player, outForSeason: true } : e.player;
    const room: Room = { how: "drop", player, from: e.slot };
    const v = noCray({ add: fa.player, room }, ctx);
    if (!v.ok && !v.waivable) return undefined;
    // Where he lands: a bench spot if there is one after the drop, else the slot the drop vacated, if he can play it.
    const benchFree = Math.max(0, (roster.benchSlots ?? 0) - roster.entries.filter((x) => x.slot === BENCH).length) + (e.slot === BENCH ? 1 : 0);
    const to = benchFree >= 1 ? BENCH : fa.player.eligibleSlots.includes(e.slot) ? e.slot : undefined;
    if (!to) return undefined;
    return { player: fa.player, moves: [], add: { to, room } };
  }
  const out = outsideCandidates([fa], ctx);
  return out.moves[0] ?? out.asks[0]?.candidate;
}

export interface AdviceSummary {
  connectionId: string;
  outcome: "ok" | "skipped" | "needs_reauth" | "error";
  /** Items the Advisor gave, and of those, new ones recorded. */
  given: number;
  recorded: number;
  error?: string;
}

/** One advice run for one league. Never throws: a failure is this run's outcome. */
export async function adviseConnection(deps: Deps, conn: ConnectionRow): Promise<AdviceSummary> {
  const now = deps.now();
  const out = (outcome: AdviceSummary["outcome"], given = 0, recorded = 0, error?: string): AdviceSummary => ({
    connectionId: conn.id, outcome, given, recorded, ...(error !== undefined ? { error } : {}),
  });
  const advisor = deps.ai?.advisor;
  if (!advisor || !adviceDue(conn, now)) return out("skipped");
  try {
    const espn = await connect(deps, conn);
    if (!espn) {
      await signedOut(deps, conn, now, null);
      return out("needs_reauth");
    }
    const roster = await readTeamPatiently(deps, espn, conn);
    if (!rosterLooksSane(roster)) return out("skipped");
    const freeAgents = await espn.getFreeAgents(conn.leagueId, roster.period, { limit: FREE_AGENTS });
    const settings = await settingsFor(deps, conn);
    // Marked before the call, answer or not: a run the wall clock kills must not bill its
    // searches again every minute; the next moment brings the next run.
    await deps.store.setAdvised(conn.id, now.toISOString());
    const items = await advisor.advise(adviceInput(conn, roster, freeAgents, settings, now));
    const history = await outsideHistory(deps.store, conn.id, roster.period);
    const titles: string[] = [];
    for (const item of items) {
      const found = item.action?.add ? candidateOf(item, roster, freeAgents, settings, now, history) : undefined;
      if (found === "unknown") continue; // names a player who is not there: not advice at all
      const candidate = found;
      const tx = candidate ? storedTransaction(candidate) : null;
      const key = `${roster.period}:advice:${candidate ? `add-${candidate.player.id}` : slug(item.title)}`;
      const sig = signature("advise", key, candidate?.moves ?? [], tx);
      if ((await deps.store.actionsFor(conn.id, key, roster.period)).some((a) => a.signature === sig && a.status !== "superseded")) continue;
      await deps.store.insertAction({
        connectionId: conn.id, userId: conn.userId, findingKey: key, period: roster.period,
        kind: "advise", status: "pending", moves: candidate?.moves ?? [],
        summary: item.title, reason: item.body, deadline: item.expiresAt ? new Date(item.expiresAt).toISOString() : null, autoAt: null, signature: sig,
        transaction: tx, sources: item.sources,
      });
      titles.push(item.title);
    }
    if (titles.length) await announce(deps, conn, adviceNotice(titles), { kind: "advice", count: titles.length });
    return out("ok", items.length, titles.length);
  } catch (e) {
    if (isSignedOut(e)) {
      try {
        await signedOut(deps, conn, now, e);
      } catch {
        // The store is failing too; the outcome below still says what happened.
      }
      return out("needs_reauth");
    }
    return out("error", 0, 0, e instanceof Error ? e.message : String(e));
  }
}
