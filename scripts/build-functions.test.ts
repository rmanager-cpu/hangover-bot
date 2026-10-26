// The Edge Functions deploy from supabase/functions alone, so the copies of packages/*/src
// in _shared must match the originals (docs/BETA.md). The second test breaks a scratch
// copy of the tree to show --check really looks, rather than always passing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { appendFileSync, cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGES = ["core", "connectors", "football-data", "service", "ai"];

function run(root: string, ...args: string[]) {
  const r = spawnSync(process.execPath, [join(root, "scripts", "build-functions.ts"), ...args], { encoding: "utf8" });
  return { code: r.status, out: r.stdout + r.stderr };
}

test("supabase/functions/_shared matches packages/*/src (npm run functions:build if not)", () => {
  const r = run(ROOT, "--check");
  assert.equal(r.code, 0, r.out);
});

test("--check catches an edited original and an orphan copy, and a build clears both", (t) => {
  const tmp = mkdtempSync(join(tmpdir(), "functions-sync-"));
  t.after(() => rmSync(tmp, { recursive: true, force: true }));
  cpSync(join(ROOT, "scripts", "build-functions.ts"), join(tmp, "scripts", "build-functions.ts"));
  for (const pkg of PACKAGES) {
    cpSync(join(ROOT, "packages", pkg, "package.json"), join(tmp, "packages", pkg, "package.json"));
    cpSync(join(ROOT, "packages", pkg, "src"), join(tmp, "packages", pkg, "src"), { recursive: true });
  }
  cpSync(join(ROOT, "supabase", "functions"), join(tmp, "supabase", "functions"), { recursive: true });
  assert.equal(run(tmp, "--check").code, 0, "a faithful copy is in sync");

  appendFileSync(join(tmp, "packages", "core", "src", "guard.ts"), "\n// edited\n");
  writeFileSync(join(tmp, "supabase", "functions", "_shared", "service", "gone.ts"), "export {};\n");
  const stale = run(tmp, "--check");
  assert.equal(stale.code, 1);
  assert.ok(stale.out.includes(join("supabase", "functions", "_shared", "core", "guard.ts")), stale.out);
  assert.ok(stale.out.includes(join("supabase", "functions", "_shared", "service", "gone.ts")), stale.out);

  assert.equal(run(tmp).code, 0);
  assert.equal(run(tmp, "--check").code, 0, "rebuilt");
});
