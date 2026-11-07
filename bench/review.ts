// Blind review for Roster Advice, which has no answer key: you read the advice with the
// model names hidden behind letters, score each item, then the tally unblinds it. Grading
// it yourself beats asking another model to, which tends to favour answers like its own.
//
//   node bench/review.ts export bench/results/advice-....jsonl   → ...-review.csv + ...-review-key.json
//   (open the CSV in a spreadsheet, fill the score column 1-5, save as CSV)
//   node bench/review.ts tally  bench/results/advice-...-review.csv

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AdvicePlayer } from "@rosterbots/core";
import { BENCH, loadJson, readRecords } from "./lib/files.ts";
import type { AdviceCase, AdviceRecord } from "./lib/types.ts";

const COLUMNS = ["case", "model", "run", "item", "kind", "title", "advice", "action", "sources", "score", "notes"];

const cell = (s: string | number): string => {
  const v = String(s);
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
};

/** A CSV with quoted fields, as spreadsheets save it. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      if (row.some((f) => f !== "")) rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  row.push(field);
  if (row.some((f) => f !== "")) rows.push(row);
  return rows;
}

function shuffle<T>(xs: T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

function exportReview(path: string): void {
  const records = (readRecords(path) as AdviceRecord[]).filter((r) => r.job === "advice");
  const cases = new Map(loadJson<AdviceCase>(join(BENCH, "cases", "advice")).map((c) => [c.id, c]));
  const models = shuffle([...new Set(records.map((r) => r.model))]);
  const label = new Map(models.map((m, i) => [m, String.fromCharCode(65 + i)]));
  const nameOf = (c: AdviceCase | undefined, id: string): string => {
    const all: AdvicePlayer[] = c ? [...c.input.roster, ...c.input.freeAgents] : [];
    return all.find((p) => p.id === id)?.name ?? `unknown player ${id}`;
  };
  const rows: string[][] = [];
  for (const caseId of [...new Set(records.map((r) => r.caseId))]) {
    const c = cases.get(caseId);
    // Shuffled within each case, so position doesn't give a model away.
    for (const r of shuffle(records.filter((x) => x.caseId === caseId))) {
      const l = label.get(r.model)!;
      if (!r.items) {
        rows.push([caseId, l, String(r.rep), "-", "-", "(no answer)", r.error ?? "", "", "", "", ""]);
        continue;
      }
      if (!r.items.length) rows.push([caseId, l, String(r.rep), "-", "-", "(nothing suggested)", "", "", "", "", ""]);
      r.items.forEach((it, i) => {
        const a = it.action;
        const action = a ? [a.add ? `add ${nameOf(c, a.add)}` : "", a.drop ? `drop ${nameOf(c, a.drop)}${a.outForSeason ? " (season over)" : ""}` : ""].filter(Boolean).join(", ") : "";
        rows.push([caseId, l, String(r.rep), String(i + 1), it.kind, it.title, it.body, action, it.sources.join(" "), "", ""]);
      });
    }
  }
  const csvPath = path.replace(/\.jsonl$/, "-review.csv");
  const keyPath = path.replace(/\.jsonl$/, "-review-key.json");
  writeFileSync(csvPath, [COLUMNS, ...rows].map((r) => r.map(cell).join(",")).join("\n") + "\n");
  writeFileSync(keyPath, JSON.stringify(Object.fromEntries([...label].map(([m, l]) => [l, m])), null, 2) + "\n");
  console.log(`Review sheet: ${csvPath}\nKey (don't peek): ${keyPath}\nScore 1-5: 5 = I'd act on it, 3 = fine but obvious, 1 = wrong or harmful. Score "(nothing suggested)" too.`);
}

function tally(csvPath: string): void {
  const keyPath = csvPath.replace(/-review\.csv$/, "-review-key.json");
  const key = JSON.parse(readFileSync(keyPath, "utf8")) as Record<string, string>;
  const [head, ...rows] = parseCsv(readFileSync(csvPath, "utf8"));
  const col = (name: string) => head!.indexOf(name);
  const scores = new Map<string, number[]>();
  for (const r of rows) {
    const s = Number(r[col("score")]);
    if (!r[col("score")]?.trim() || !Number.isFinite(s)) continue;
    const model = key[r[col("model")]!] ?? r[col("model")]!;
    scores.set(model, [...(scores.get(model) ?? []), s]);
  }
  const table = [...scores]
    .map(([m, xs]) => ({ m, avg: xs.reduce((a, b) => a + b, 0) / xs.length, n: xs.length, low: xs.filter((x) => x <= 2).length }))
    .sort((a, b) => b.avg - a.avg);
  console.log("| Model | Avg score | Scored | Scored 1-2 |\n|---|---|---|---|");
  for (const t of table) console.log(`| ${t.m} | ${t.avg.toFixed(2)} | ${t.n} | ${t.low} |`);
}

const [cmd, file] = process.argv.slice(2);
if (cmd === "export" && file) exportReview(file);
else if (cmd === "tally" && file) tally(file);
else console.log("node bench/review.ts export <advice-results.jsonl>   |   node bench/review.ts tally <...-review.csv>");
