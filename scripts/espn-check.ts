// Phase 0's end-to-end read: credentials -> leagues -> my team -> roster -> what
// the engine would do. Reads only; it never writes to ESPN.
//
//   ESPN_SWID='{...}' ESPN_S2='...' npm run espn:check
//   ESPN_SWID='{...}' ESPN_S2='...' npm run espn:check -- 36784699
//
// The cookies come from the environment for this check only. In the product they
// live in Supabase Vault, per connection. Never print them.

import { DEFAULT_SETTINGS, evaluate, plan } from "@rosterbots/core";
import { AuthError, espnConnector } from "@rosterbots/connectors";

const swid = process.env.ESPN_SWID;
const espnS2 = process.env.ESPN_S2;
const season = Number(process.env.ESPN_SEASON ?? 2026);
if (!swid || !espnS2) {
  console.error("Set ESPN_SWID (with its braces) and ESPN_S2.");
  process.exit(1);
}

const espn = espnConnector({ season, credentials: { swid, espnS2 } });

try {
  let leagueId = process.argv[2];
  if (!leagueId) {
    const leagues = await espn.getLeagues();
    console.log(`${leagues.length} football league(s) this season:`);
    for (const l of leagues) console.log(`  ${l.leagueId}  ${l.leagueName}  (team ${l.teamId ?? "?"} ${l.teamName ?? ""})`);
    leagueId = leagues[0]?.leagueId;
    if (!leagueId) process.exit(0);
  }

  const me = await espn.getMyTeam(leagueId);
  console.log(`\n${me.leagueName}: team #${me.teamId} ${me.teamName}`);

  const roster = await espn.getRoster(leagueId);
  console.log(`period ${roster.period}, starting slots ${roster.starterSlots.join(" ")}`);
  for (const e of roster.entries) {
    const p = e.player;
    const game = p.game === null ? "BYE" : p.game ? p.game.kickoff.slice(0, 16) + " vs " + (p.game.opponent ?? "?") : "schedule unknown";
    const proj = p.projection === undefined ? "  -  " : p.projection.toFixed(1).padStart(5);
    console.log(`  ${e.slot.padEnd(9)} ${p.name.padEnd(24)} ${p.position.padEnd(4)} ${p.status.padEnd(12)} ${proj}  ${game}${p.locked ? "  LOCKED" : ""}`);
  }

  // What the engine would do at Bench Protection, as if the account were claimed.
  const settings = { ...DEFAULT_SETTINGS, authority: "bench_protection" as const, accountClaimed: true };
  const now = new Date();
  const findings = evaluate(roster, now, settings);
  console.log(`\n${findings.length} finding(s), as Bench Protection would see them:`);
  for (const f of findings) {
    const step = plan(f, settings, now);
    const who = f.starter?.name ?? "empty " + f.slot;
    const what = f.resolution.type === "deterministic" ? f.resolution.candidate.player.name : f.resolution.type;
    console.log(`  ${f.kind.padEnd(22)} ${who.padEnd(24)} -> ${step.do} (${what}): ${f.resolution.why}`);
  }
  console.log("\nNothing was written.");
} catch (e) {
  if (e instanceof AuthError) console.error("ESPN rejected the cookies (" + e.httpStatus + "). Sign in again and copy fresh ones.");
  else console.error(e instanceof Error ? e.message : e);
  process.exit(1);
}
