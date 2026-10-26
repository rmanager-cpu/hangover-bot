// check: the scheduled checker. pg_cron posts here every minute (see the migration).
// There is no user JWT, so verify_jwt is off and the caller proves itself with
// x-cron-secret. Connections run one at a time: one bad connection never stops the
// others, and the log carries connection ids and outcomes only.

import { adviceDue, adviseConnection, protectConnection, type CheckSummary } from "@rosterbots/service";
import { makeDeps } from "../_lib/deps.ts";
import { json, serve } from "../_lib/http.ts";
import { adminClient, createStore } from "../_lib/store.ts";

const MAX_CONNECTIONS = 25;

// Stop starting connections well inside the Edge Function wall-clock limit (150 s on
// the free plan). The ones not reached are handed back and the next run takes them.
const BUDGET_MS = 90_000;

// Roster Advice reads ESPN and asks the AI, with web searches: up to 100 s. One league per
// run, and only when the checks left most of the wall clock, so a run never overruns it.
const ADVICE_AFTER_MS = 20_000;

// A connection due this soon is due now. next_check_at sits on a minute boundary (the
// service's nextCheckAt), and this clock is read a moment after the cron tick, on another
// host than the database's: without slack, a row could be missed by milliseconds and wait a
// whole tick, which inside T-10 is the difference between every minute and every two.
const DUE_SLACK_MS = 30_000;

// Compared without stopping at the first difference, so timing does not leak it.
function sameSecret(given: string, expected: string): boolean {
  const a = new TextEncoder().encode(given);
  const b = new TextEncoder().encode(expected);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

serve("check", async (req) => {
  // No MCP tool sets a function secret, so this is the one value the owner adds by hand
  // (docs/DEPLOY.md). Until then every call is refused, cron's included, and the log says why.
  const secret = Deno.env.get("CRON_SECRET") ?? "";
  if (!secret) {
    console.error("check: CRON_SECRET is not set. Add it in the dashboard under Edge Functions, Secrets, equal to the Vault secret cron_secret. No connection was checked.");
    return json({ error: "not_configured", message: "CRON_SECRET is not set on the check function." }, 503);
  }
  if (!sameSecret(req.headers.get("x-cron-secret") ?? "", secret)) {
    return json({ error: "unauthorized", message: "Bad or missing x-cron-secret." }, 401);
  }

  const started = Date.now();
  const store = createStore(adminClient());
  const deps = makeDeps(store);
  const nowIso = deps.now().toISOString();
  const due = await store.dueConnections(new Date(Date.parse(nowIso) + DUE_SLACK_MS).toISOString(), MAX_CONNECTIONS);

  const results: CheckSummary[] = [];
  const deferred: string[] = [];
  for (const conn of due) {
    if (Date.now() - started > BUDGET_MS) {
      deferred.push(conn.id);
      continue;
    }
    let s: CheckSummary;
    try {
      s = await protectConnection(deps, conn);
    } catch (e) {
      // protectConnection catches its own failures; this is the backstop. The lease
      // taken in dueConnections retries the connection in a few minutes.
      s = {
        connectionId: conn.id,
        outcome: "error",
        findings: 0,
        executed: 0,
        proposed: 0,
        notified: 0,
        nextCheckAt: conn.nextCheckAt ?? nowIso,
        error: e instanceof Error ? e.name : "unknown error",
      };
    }
    results.push(s);
    console.log(
      `check: ${s.connectionId} ${s.outcome} findings=${s.findings} executed=${s.executed} proposed=${s.proposed} notified=${s.notified}`,
    );
  }
  if (deferred.length) {
    await store.releaseConnections(deferred, nowIso);
    console.log(`check: ${deferred.length} connection(s) left for the next run`);
  }

  // Roster Advice for one AI Native league whose moment has come (docs/AI-NATIVE.md).
  let advised: string | undefined;
  if (deps.ai?.advisor && Date.now() - started < ADVICE_AFTER_MS) {
    const league = due.find((conn) => adviceDue(conn, deps.now()));
    if (league) {
      const a = await adviseConnection(deps, league);
      advised = a.connectionId;
      console.log(`advise: ${a.connectionId} ${a.outcome} given=${a.given} recorded=${a.recorded}${a.error ? " " + a.error : ""}`);
    }
  }

  return json({ checked: results.length, deferred: deferred.length, results, ...(advised ? { advised } : {}) });
});
