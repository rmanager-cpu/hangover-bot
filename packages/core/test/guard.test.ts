// The first-weekend guardrails (docs/BETA.md): when an automatic move may happen,
// and when a read is too odd to act on. Checked without a network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { BETA_AUTOMATION, DEFAULT_SETTINGS, evaluate, guard, plan, rosterLooksSane } from "../src/index.ts";
import type { AutomationPolicy, Finding, GuardContext, Player, Roster, RosterEntry, Slot, Status, Step } from "../src/index.ts";

const KICKOFF = "2026-10-04T17:00:00.000Z"; // 1 PM ET, the deadline
const T = Date.parse(KICKOFF);
const MIN = 60_000;
const at = (ms: number) => new Date(ms);
const INSIDE = at(T - 45 * MIN);

const WR_ELIG: Slot[] = ["WR", "RB/WR", "WR/TE", "FLEX", "BENCH", "IR"];
function wr(id: string, over: Partial<Player> = {}): Player {
  return {
    id, name: id, position: "WR", proTeam: "MIN", status: "active",
    eligibleSlots: WR_ELIG, projection: 10, game: { kickoff: KICKOFF }, locked: false, ...over,
  };
}
const slot = (s: Slot, player: Player): RosterEntry => ({ slot: s, player });
function roster(entries: RosterEntry[], starterSlots: Slot[] = ["WR", "WR", "FLEX"]): Roster {
  return { teamId: "2", teamName: "Trust The Process", period: 5, starterSlots, entries };
}
const healthy = () => [slot("WR", wr("a")), slot("WR", wr("b")), slot("FLEX", wr("c")), slot("BENCH", wr("d"))];

// The real path to an execute step: a starter ruled OUT, Bench Protection, claimed account.
const outRoster = roster([slot("WR", wr("jj", { status: "out" })), slot("WR", wr("b")), slot("FLEX", wr("c")), slot("BENCH", wr("d"))]);
const settings = { ...DEFAULT_SETTINGS, authority: "bench_protection" as const, accountClaimed: true };
const finding: Finding = evaluate(outRoster, INSIDE, settings)[0]!;
const execute = plan(finding, settings, INSIDE) as Extract<Step, { do: "execute" }>;

const ctx = (over: Partial<GuardContext> = {}): GuardContext => ({
  now: INSIDE, autoMovesToday: 0, readLooksSane: true, policy: BETA_AUTOMATION, ...over,
});
type Propose = Extract<Step, { do: "propose" }>;
const held = (s: Step) => (s.do === "propose" ? s.held : undefined);

test("the setup really is an execute step with the deadline at kickoff", () => {
  assert.equal(execute.do, "execute");
  assert.equal(execute.finding.deadline, KICKOFF);
});

test("the beta policy is T-90 to T-4, three a day", () => {
  assert.deepEqual({ ...BETA_AUTOMATION }, { autoFromMinutes: 90, autoUntilMinutes: 4, maxAutoMovesPerDay: 3 });
  assert.throws(() => {
    (BETA_AUTOMATION as { maxAutoMovesPerDay: number }).maxAutoMovesPerDay = 99;
  }, "a shared default cannot be edited by one connection");
});

// ---- the window

test("inside the window, an execute passes through untouched", () => {
  assert.equal(guard(execute, ctx()), execute);
});

test("exactly T-90 is inside the window", () => {
  assert.equal(guard(execute, ctx({ now: at(T - 90 * MIN) })), execute);
});

test("a millisecond before T-90 is held, to happen automatically at T-90", () => {
  const out = guard(execute, ctx({ now: at(T - 90 * MIN - 1) }));
  assert.equal(out.do, "propose");
  assert.equal(held(out)?.reason, "too early for an automatic move");
  assert.equal(held(out)?.autoAt, "2026-10-04T15:30:00.000Z");
});

test("Sunday morning, hours out: autoAt is T-90, not now", () => {
  const out = guard(execute, ctx({ now: new Date("2026-10-04T12:05:00Z") }));
  assert.equal(held(out)?.autoAt, new Date(T - 90 * MIN).toISOString());
});

test("T-10 and exactly T-4 are inside the window", () => {
  assert.equal(guard(execute, ctx({ now: at(T - 10 * MIN) })), execute);
  assert.equal(guard(execute, ctx({ now: at(T - 4 * MIN) })), execute);
});

test("a millisecond after T-4 is a proposal only, with no autoAt", () => {
  const out = guard(execute, ctx({ now: at(T - 4 * MIN + 1) }));
  assert.equal(out.do, "propose");
  assert.deepEqual(held(out), { reason: "too close to kickoff for an automatic move" });
  assert.equal("autoAt" in held(out)!, false);
});

test("after kickoff, a proposal only", () => {
  assert.equal(held(guard(execute, ctx({ now: at(T + 5 * MIN) })))?.reason, "too close to kickoff for an automatic move");
});

test("the window comes from the policy passed in, not the beta default", () => {
  const policy: AutomationPolicy = { autoFromMinutes: 60, autoUntilMinutes: 5, maxAutoMovesPerDay: 3 };
  assert.equal(held(guard(execute, ctx({ policy, now: at(T - 61 * MIN) })))?.autoAt, new Date(T - 60 * MIN).toISOString());
  assert.equal(guard(execute, ctx({ policy, now: at(T - 60 * MIN) })), execute);
  assert.equal(guard(execute, ctx({ policy, now: at(T - 5 * MIN) })), execute);
  assert.equal(held(guard(execute, ctx({ policy, now: at(T - 4 * MIN) })))?.reason, "too close to kickoff for an automatic move");
});

test("a policy whose window is upside down never acts", () => {
  const policy: AutomationPolicy = { autoFromMinutes: 10, autoUntilMinutes: 90, maxAutoMovesPerDay: 3 };
  for (const m of [120, 90, 45, 10, 5]) assert.equal(guard(execute, ctx({ policy, now: at(T - m * MIN) })).do, "propose", `T-${m}`);
});

// ---- the daily cap

test("under the daily cap, it acts", () => {
  assert.equal(guard(execute, ctx({ autoMovesToday: 2 })), execute);
});

test("at the daily cap, it is held", () => {
  assert.deepEqual(held(guard(execute, ctx({ autoMovesToday: 3 }))), { reason: "daily limit" });
  assert.deepEqual(held(guard(execute, ctx({ autoMovesToday: 7 }))), { reason: "daily limit" });
});

test("the cap is the policy's: a connection's own limit is honoured, and zero means never", () => {
  assert.equal(guard(execute, ctx({ autoMovesToday: 3, policy: { ...BETA_AUTOMATION, maxAutoMovesPerDay: 5 } })), execute);
  assert.equal(held(guard(execute, ctx({ autoMovesToday: 0, policy: { ...BETA_AUTOMATION, maxAutoMovesPerDay: 0 } })))?.reason, "daily limit");
});

// ---- the read and the kickoff

test("a read that does not look sane is never acted on", () => {
  assert.deepEqual(held(guard(execute, ctx({ readLooksSane: false }))), { reason: "ESPN data looked incomplete" });
});

test("no deadline means the kickoff is unknown: a proposal", () => {
  const { deadline: _, ...rest } = execute.finding;
  const step: Step = { ...execute, finding: rest };
  assert.deepEqual(held(guard(step, ctx())), { reason: "kickoff unknown" });
});

test("a deadline that does not parse is as unknown as a missing one", () => {
  const step: Step = { ...execute, finding: { ...execute.finding, deadline: "Sunday, 1 PM" } };
  assert.deepEqual(held(guard(step, ctx())), { reason: "kickoff unknown" });
});

test("the guardrails apply in order: read, cap, kickoff, window", () => {
  const { deadline: _, ...noKick } = execute.finding;
  const noKickoff: Step = { ...execute, finding: noKick };
  const early = at(T - 3 * 60 * MIN);
  assert.equal(held(guard(noKickoff, ctx({ readLooksSane: false, autoMovesToday: 9, now: early })))?.reason, "ESPN data looked incomplete");
  assert.equal(held(guard(noKickoff, ctx({ autoMovesToday: 9, now: early })))?.reason, "daily limit");
  assert.equal(held(guard(noKickoff, ctx({ now: early })))?.reason, "kickoff unknown");
  assert.equal(held(guard(execute, ctx({ autoMovesToday: 3, now: early })))?.autoAt, undefined, "a capped move promises no autoAt");
});

// ---- what a held step carries

test("a held proposal keeps the finding, the candidate and the source", () => {
  const out = guard(execute, ctx({ readLooksSane: false })) as Propose;
  assert.equal(out.finding, execute.finding);
  assert.equal(out.candidate, execute.candidate);
  assert.equal(out.source, "rules");
  const fromAi: Step = { ...execute, source: "ai" };
  assert.equal((guard(fromAi, ctx({ autoMovesToday: 3 })) as Propose).source, "ai");
});

test("guard does not change the step it was given", () => {
  const before = structuredClone(execute);
  guard(execute, ctx({ now: at(T - 3 * 60 * MIN) }));
  guard(execute, ctx({ readLooksSane: false }));
  assert.deepEqual(execute, before);
});

test("every step other than execute passes through unchanged, whatever the context", () => {
  const { candidate } = execute;
  const steps: Step[] = [
    { do: "notify", finding },
    { do: "wait", finding, until: new Date(T - 100 * MIN).toISOString() },
    { do: "propose", finding, candidate, source: "rules" },
    { do: "propose", finding, candidate, source: "rules", held: { reason: "daily limit" } },
    { do: "ask_user", finding, candidates: [candidate] },
    { do: "consult_ai", finding, candidates: [candidate] },
  ];
  const worst = ctx({ readLooksSane: false, autoMovesToday: 99, now: at(T + 60 * MIN) });
  for (const s of steps) {
    assert.equal(guard(s, worst), s, s.do);
    assert.equal(guard(s, ctx()), s, s.do);
  }
});

test("end to end: the same OUT starter at three times on Sunday", () => {
  const run = (now: Date) => guard(plan(evaluate(outRoster, now, settings)[0]!, settings, now), ctx({ now }));
  assert.equal(held(run(at(T - 4 * 60 * MIN)))?.autoAt, "2026-10-04T15:30:00.000Z");
  assert.equal(run(at(T - 60 * MIN)).do, "execute");
  assert.equal(run(at(T - 5 * MIN)).do, "execute", "a late scratch at T-5 is still fixed");
  assert.equal(run(at(T - 3 * MIN)).do, "propose");
});

// ---- rosterLooksSane

test("a normal roster looks sane", () => {
  assert.equal(rosterLooksSane(roster(healthy())), true);
});

test("an empty roster does not", () => {
  assert.equal(rosterLooksSane(roster([])), false);
});

test("the same player twice does not", () => {
  assert.equal(rosterLooksSane(roster([...healthy(), slot("BENCH", wr("a"))])), false);
});

test("a roster with no starting slots read does not", () => {
  assert.equal(rosterLooksSane(roster(healthy(), [])), false);
});

test("a starter in a slot the league does not have does not", () => {
  const te = wr("t", { position: "TE", eligibleSlots: ["TE", "FLEX", "BENCH"] });
  assert.equal(rosterLooksSane(roster([...healthy(), slot("TE", te)])), false);
});

test("more starters in a slot than the league has does not", () => {
  assert.equal(rosterLooksSane(roster([...healthy(), slot("WR", wr("e"))])), false);
});

test("an empty starting slot is a finding, not a bad read", () => {
  assert.equal(rosterLooksSane(roster([slot("WR", wr("a")), slot("FLEX", wr("c")), slot("BENCH", wr("d"))])), true);
});

test("three starters out at once is a bad week; four is a bad read", () => {
  const statuses: Status[] = ["out", "ir", "suspended"];
  const slots: Slot[] = ["WR", "WR", "FLEX", "FLEX"];
  const lineup = (n: number) => slots.map((s, i) => slot(s, wr(`s${i}`, i < n ? { status: statuses[i % 3]! } : {})));
  assert.equal(rosterLooksSane(roster(lineup(3), slots)), true);
  assert.equal(rosterLooksSane(roster(lineup(4), slots)), false);
});

test("a starter who has already played and is now OUT or IR does not count against the read", () => {
  const statuses: Status[] = ["out", "ir", "suspended"];
  const slots: Slot[] = ["WR", "WR", "FLEX", "FLEX"];
  // Thursday's starter, locked, then placed on IR; three more OUT before Sunday's games.
  const lineup = slots.map((s, i) => slot(s, wr(`s${i}`, { status: statuses[i % 3]!, ...(i === 3 ? { locked: true } : {}) })));
  assert.equal(rosterLooksSane(roster(lineup, slots)), true);
});

test("injured players on the bench or IR do not count against the read", () => {
  const hurt = ["e", "f", "g", "h", "i"].map((id, i) => slot(i % 2 ? "IR" : "BENCH", wr(id, { status: "out" })));
  assert.equal(rosterLooksSane(roster([...healthy(), ...hurt])), true);
});

test("questionable, doubtful and unknown starters do not count as out", () => {
  const slots: Slot[] = ["WR", "WR", "FLEX", "FLEX"];
  const st: Status[] = ["questionable", "doubtful", "unknown", "out"];
  assert.equal(rosterLooksSane(roster(slots.map((s, i) => slot(s, wr(`s${i}`, { status: st[i]! }))), slots)), true);
});

test("a negative player id is real (every D/ST)", () => {
  const dst = wr("-16001", { name: "Vikings D/ST", position: "D/ST", eligibleSlots: ["DST", "BENCH"] });
  assert.equal(rosterLooksSane(roster([...healthy(), slot("DST", dst)], ["WR", "WR", "FLEX", "DST"])), true);
});
