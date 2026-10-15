// The service runs under Deno in Supabase Edge Functions as well as Node, so its
// source may use only what both have, and it never logs (an ESPN request carries
// cookies). Plain substring checks, deliberately: no regular expressions to lose
// their backslashes in an edit.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

const dir = new URL("../src/", import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith(".ts"));

const FORBIDDEN = ['from "node:', "from 'node:", "require(", "process.", "Buffer", "__dirname", "Deno.", "@supabase", "console."];

test("the service source uses nothing Node-only or Deno-only, and never logs", () => {
  assert.ok(files.length >= 6);
  for (const f of files) {
    const src = readFileSync(new URL(f, dir), "utf8");
    for (const word of FORBIDDEN) assert.equal(src.includes(word), false, `${f} contains ${word}`);
  }
});

test("every relative import names its .ts file, as Deno and Node type stripping both need", () => {
  for (const f of files) {
    const src = readFileSync(new URL(f, dir), "utf8");
    for (const line of src.split("\n")) {
      const from = line.indexOf('from "./');
      if (from === -1) continue;
      const end = line.indexOf('"', from + 6);
      assert.ok(line.slice(from + 6, end).endsWith(".ts"), `${f}: ${line.trim()}`);
    }
  }
});
