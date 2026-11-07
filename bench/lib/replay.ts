// Replay: a case is the last minutes before a kickoff, not one question. The app's real check
// loop (packages/service's protectConnection, on the repo's own test fakes: an in-memory
// store, a fake ESPN, a clock) runs on the app's own cadence from `start` to kickoff. ESPN's
// statuses change when the case's timeline says. The model under test is the Judge, and each
// answer costs its real time on the clock, so a slow model eats into the window.
//
// What counts is who is in the lineup at kickoff. A wrong pick that a later check catches and
// fixes costs nothing; one it cannot fix (no room left, or ESPN too late for T-3) costs the
// slot. Nobody taps anything: the user is asleep, which is the product.

import { isHole, type AiChoice, type JudgeInput } from "@rosterbots/core";
import { MIN, setup, type FakeAi } from "../../packages/service/test/fakes.ts";
import type { Call, ReplayCase, ReplayCall, Usage } from "./types.ts";

export interface ReplayResult {
  /** Points the case's listed players scored from starting slots at kickoff. */
  points: number;
  /** A listed player who scored nothing was starting at kickoff. */
  zeroAtLock: boolean;
  /** Minutes, from the first check to kickoff, that a starting slot held a hole the app could see. */
  holeMinutes: number;
  /** Lineup moves the app made on its own. */
  autoMoves: number;
  aiCalls: ReplayCall[];
  usage: Usage;
  /** What the user would have seen, in order, with times in ET. */
  log: string[];
}

const et = (t: number): string =>
  new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit", second: "2-digit" }).format(new Date(t));

const starting = (slot: string): boolean => slot !== "BENCH" && slot !== "IR";

export async function replay(c: ReplayCase, judge: (input: JudgeInput) => Promise<Call<AiChoice>>): Promise<ReplayResult> {
  const lock = Date.parse(c.kickoff);
  const aiCalls: ReplayCall[] = [];
  const usage = { inputTokens: 0, outputTokens: 0, costUsd: 0, webSearches: 0 };
  let priced = true;
  const log: string[] = [];
  let clock: { now(): Date; set(at: number): void } | undefined;

  const ai = {
    judge: {
      async pick(input: JudgeInput): Promise<AiChoice | undefined> {
        const call = await judge(input);
        const t = clock!.now().getTime();
        aiCalls.push({
          at: new Date(t).toISOString(),
          ms: call.latencyMs,
          offered: input.candidates.map((x) => x.id),
          ...(call.answer ? { pick: call.answer.playerId, confidence: call.answer.confidence, reason: call.answer.reason } : {}),
          ...(call.error ? { error: call.error } : {}),
        });
        usage.inputTokens += call.usage.inputTokens ?? 0;
        usage.outputTokens += call.usage.outputTokens ?? 0;
        usage.webSearches += call.usage.webSearches ?? 0;
        if (call.usage.costUsd === undefined) priced = false;
        else usage.costUsd += call.usage.costUsd;
        log.push(`${et(t)}  AI answered in ${(call.latencyMs / 1000).toFixed(1)}s: ${call.answer ? `${call.answer.playerId === null ? "leave it" : input.candidates.find((x) => x.id === call.answer!.playerId)?.name ?? `off-list ${call.answer.playerId}`} @${call.answer.confidence.toFixed(2)}` : `no answer (${call.error ?? "?"})`}`);
        // The answer took this long: the rest of the check happens that much later.
        clock!.set(t + call.latencyMs);
        return call.answer;
      },
    },
    advisor: { advise: async () => [] },
  };

  const s = setup({
    roster: structuredClone(c.roster),
    at: c.start,
    authority: c.authority ?? "ai_rescue",
    ai: ai as unknown as FakeAi,
    freeAgents: structuredClone(c.freeAgents),
    conn: { droppable: c.droppable ?? [], replacementOrder: c.replacementOrder ?? [] },
  });
  clock = s.clock;

  // ESPN's side of the clock: games lock at kickoff, statuses change when the timeline says.
  const apply = (): void => {
    const now = s.clock.now().getTime();
    for (const e of s.espn.roster.entries) if (e.player.game?.kickoff && Date.parse(e.player.game.kickoff) <= now) e.player.locked = true;
    for (const ev of c.timeline) {
      if (Date.parse(ev.at) > now) continue;
      const players = [...s.espn.roster.entries.map((e) => e.player), ...s.espn.freeAgents.map((f) => f.player)];
      for (const p of players.filter((x) => x.id === ev.playerId)) {
        if (ev.status !== undefined) p.status = ev.status;
        if (ev.projection !== undefined) p.projection = ev.projection;
      }
    }
  };
  s.espn.onRead = () => apply();
  const readFreeAgents = s.espn.getFreeAgents.bind(s.espn);
  s.espn.getFreeAgents = async (...args: Parameters<typeof readFreeAgents>) => {
    apply();
    return readFreeAgents(...args);
  };
  const addActivity = s.store.addActivity.bind(s.store);
  s.store.addActivity = async (e) => {
    log.push(`${et(s.clock.now().getTime())}  [${e.type}] ${e.title}: ${e.body}`);
    return addActivity(e);
  };

  const holeShowing = (): boolean => s.espn.roster.entries.some((e) => starting(e.slot) && !e.player.locked && isHole(e.player));
  let holeMinutes = 0;
  for (let n = 0; s.clock.now().getTime() < lock && n < 5000; n++) {
    apply();
    await s.run();
    apply();
    const now = s.clock.now().getTime();
    const next = Date.parse(s.store.connections.get(s.conn.id)?.nextCheckAt ?? "");
    const until = Math.min(lock, Number.isFinite(next) && next > now ? next : now + MIN);
    if (holeShowing()) holeMinutes += (until - now) / MIN;
    s.clock.set(Math.max(until, now + 1));
  }
  s.clock.set(lock);
  apply();

  const pts = (id: string): number => {
    const v = c.outcome[id];
    return typeof v === "number" ? v : 0;
  };
  const listed = s.espn.roster.entries.filter((e) => starting(e.slot) && e.player.id in c.outcome);
  return {
    points: listed.reduce((a, e) => a + pts(e.player.id), 0),
    zeroAtLock: listed.some((e) => pts(e.player.id) === 0),
    holeMinutes: Math.round(holeMinutes * 10) / 10,
    autoMoves: s.store.actions.filter((a) => a.kind === "execute" && a.status === "done").length,
    aiCalls,
    usage: { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, ...(priced ? { costUsd: usage.costUsd } : {}), ...(usage.webSearches ? { webSearches: usage.webSearches } : {}) },
    log,
  };
}
