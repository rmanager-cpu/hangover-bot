// The advice report's run-by-run section (owner, Nov 7: cost, speed, tools used, what those
// tools did, reasoning, any failures, and the final output). Pure: records in, markdown out.

import type { AdviceInput, AdvicePlayer } from "@rosterbots/core";
import type { AdviceCase, AdviceRecord, Trace, Usage } from "./types.ts";

const REASONING_CHARS = 1800;
const CITED = 8;

export const host = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

export const cut = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}… (${s.length.toLocaleString()} characters in all; full text in the results file)` : s);

function who(input: AdviceInput): (id: string | undefined) => string {
  const all = new Map<string, { p: AdvicePlayer; free: boolean }>();
  for (const p of input.roster) all.set(p.id, { p, free: false });
  for (const p of input.freeAgents) all.set(p.id, { p, free: true });
  return (id) => {
    if (!id) return "";
    const x = all.get(id);
    if (!x) return `unknown player ${id}`;
    const { p } = x;
    const rostered = p.percentRostered !== undefined ? `, ${Math.round(p.percentRostered)}% rostered` : "";
    const where = x.free ? (p.onWaivers ? "on waivers" : "free agent") : p.slot === "BENCH" ? "your bench" : p.slot === "IR" ? "your IR" : `starting ${p.slot}`;
    return `**${p.name}** (${p.position} ${p.proTeam}, ${where}${rostered})`;
  };
}

export function toolLines(t: Trace | undefined): string[] {
  if (!t) return ["- Not recorded."];
  const out: string[] = [];
  // Claude's newer web search filters its results by running code: one line for all of it.
  const code = t.tools.filter((u) => u.tool.includes("code_execution")).length;
  if (code) out.push(`- ran code ${code} time${code === 1 ? "" : "s"} (Claude's web search filters its results with code)`);
  for (const u of t.tools.filter((x) => !x.tool.includes("code_execution"))) {
    const what = u.query ? `"${u.query}"` : u.url ? u.url : "";
    const got = u.error
      ? `failed (${u.error})`
      : u.results?.length
        ? u.results.length === 1 && u.tool.includes("fetch")
          ? `read ${u.results[0]!.title ? `"${u.results[0]!.title}"` : host(u.results[0]!.url)}`
          : `${u.results.length} results: ${u.results.slice(0, 4).map((r) => host(r.url)).join(", ")}${u.results.length > 4 ? ", …" : ""}`
        : "no results";
    out.push(`- ${u.tool} ${what} → ${got}`);
  }
  for (const [k, n] of Object.entries(t.toolCounts ?? {})) out.push(`- ${k}: ${n}${t.tools.length ? "" : " (OpenRouter reports counts, not the searches themselves)"}`);
  return out.length ? out : ["- None."];
}

/** One run's time, cost, searches and pages read, for any job with tools. */
export function runLine(r: Usage & { latencyMs: number; trace?: Trace }): string {
  const secs = r.latencyMs / 1000;
  const parts = [
    // Speed is reported, not judged: advice runs on a schedule (owner, Nov 7: "kill the 100 second rule").
    `${secs.toFixed(0)} s`,
    r.costUsd !== undefined ? `$${r.costUsd.toFixed(3)}` : "cost unknown",
    `${r.webSearches ?? r.trace?.toolCounts?.web_search ?? r.trace?.tools.filter((t) => t.tool.includes("search")).length ?? 0} searches`,
  ];
  const fetches = r.webFetches ?? r.trace?.tools.filter((t) => t.tool.includes("fetch")).length;
  if (fetches) parts.push(`${fetches} pages read`);
  if (r.trace?.provider) parts.push(`served by ${r.trace.provider}`);
  if (r.trace?.reformatted) parts.push("report put into the app's form by a second call");
  return parts.join(" · ");
}

export function adviceDetails(cases: AdviceCase[], records: AdviceRecord[]): string {
  const lines: string[] = ["## Run by run", ""];
  for (const c of cases) {
    const mine = records.filter((r) => r.caseId === c.id);
    if (!mine.length) continue;
    const name = who(c.input);
    lines.push(`### ${c.input.teamName}, week ${c.input.week} (\`${c.id}\`)`, "");
    const models = [...new Set(mine.map((r) => r.model))];
    for (const model of models) {
      for (const r of mine.filter((x) => x.model === model).sort((a, b) => a.rep - b.rep)) {
        lines.push(`#### ${model}, run ${r.rep}`, "", runLine(r), "");
        lines.push("**Tools**", "", ...toolLines(r.trace), "");
        const cited = r.trace?.citations ?? [];
        const read = r.trace?.tools.flatMap((t) => t.results ?? []) ?? [];
        if (cited.length) {
          lines.push(`**What they found** (${cited.length} pages cited)`, "");
          for (const p of cited.slice(0, CITED)) lines.push(`- [${p.title ?? host(p.url)}](${p.url})${p.snippet ? `: ${p.snippet}` : ""}`);
          if (cited.length > CITED) lines.push(`- …and ${cited.length - CITED} more`);
          lines.push("");
        } else if (read.length) {
          const uniq = [...new Map(read.map((p) => [p.url, p])).values()];
          lines.push(`**What they found** (${uniq.length} pages)`, "");
          for (const p of uniq.slice(0, CITED)) lines.push(`- [${p.title ?? host(p.url)}](${p.url})`);
          if (uniq.length > CITED) lines.push(`- …and ${uniq.length - CITED} more`);
          lines.push("");
        }
        lines.push("**Reasoning**", "");
        if (r.trace?.reasoning) lines.push(...cut(r.trace.reasoning, REASONING_CHARS).split("\n").map((l) => `> ${l}`));
        else lines.push(r.trace?.reasoningHidden ? "> Hidden: the provider returns this model's reasoning encrypted." : "> None shown.");
        if (r.trace?.reasoning && r.trace.reasoningHidden) lines.push(">", "> (Part of it came back encrypted.)");
        lines.push("");
        if (r.error) lines.push(`**Failure:** ${r.error}${r.trace?.finish ? ` (stopped: ${r.trace.finish})` : ""}`, "");
        if (r.trace?.text) lines.push("**Also wrote**", "", ...cut(r.trace.text, 800).split("\n").map((l) => `> ${l}`), "");
        lines.push("**Final output**", "");
        if (!r.items) lines.push("No answer.");
        else if (!r.items.length) lines.push("Nothing to suggest.");
        else
          r.items.forEach((it, i) => {
            const move = [it.action?.add ? `Add ${name(it.action.add)}` : "", it.action?.drop ? `Drop ${name(it.action.drop)}` : ""].filter(Boolean).join(" · ");
            lines.push(`${i + 1}. **${it.title}** (${it.kind})${move ? `  \n   ${move}` : ""}  \n   ${it.body}  \n   Sources: ${it.sources.length ? it.sources.join(", ") : "none"}`);
          });
        lines.push("");
      }
    }
  }
  return lines.join("\n");
}
