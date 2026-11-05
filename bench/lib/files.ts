// Reading cases and models, writing results. Results are JSON Lines, one record a line,
// appended as each call finishes, so a run that dies keeps what it got.

import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ModelEntry, RunRecord } from "./types.ts";

/** The bench folder, wherever the repo is (Windows included). */
export const BENCH = dirname(dirname(fileURLToPath(import.meta.url)));

/** Every *.json under a directory, deepest last, parsed; each tagged with the file it came from. */
export function loadJson<T>(dir: string): (T & { file: string })[] {
  if (!existsSync(dir)) return [];
  const out: (T & { file: string })[] = [];
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...loadJson<T>(path));
    else if (name.endsWith(".json")) {
      try {
        out.push({ ...(JSON.parse(readFileSync(path, "utf8")) as T), file: path });
      } catch (e) {
        throw new Error(`${path} is not valid JSON (${(e as Error).message})`);
      }
    }
  }
  return out;
}

export function loadModels(path = join(BENCH, "models.json")): ModelEntry[] {
  const list = JSON.parse(readFileSync(path, "utf8")) as { models?: ModelEntry[] };
  if (!Array.isArray(list.models)) throw new Error(`${path} needs a "models" list`);
  const names = new Set<string>();
  for (const m of list.models) {
    if (!m.name || !m.via || !m.model) throw new Error(`${path}: every model needs name, via and model`);
    if (names.has(m.name)) throw new Error(`${path}: two models are named "${m.name}"`);
    names.add(m.name);
  }
  return list.models;
}

export function readRecords(path: string): RunRecord[] {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as RunRecord);
}

export function appendRecord(path: string, r: RunRecord): void {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, JSON.stringify(r) + "\n");
}

/** A filename-safe timestamp: 2026-11-04T21-40-12. */
export const stamp = (d = new Date()): string => d.toISOString().slice(0, 19).replace(/:/g, "-");
