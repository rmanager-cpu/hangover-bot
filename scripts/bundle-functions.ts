// The Supabase MCP's deploy_edge_function takes one function at a time as a flat list of
// files named relative to that function's own folder, so it cannot reach ../_lib or
// ../_shared the way the CLI's deploy does. This writes each function as a folder that
// stands on its own: index.ts, its own copy of _lib and _shared, a deno.json whose
// import map points inside, and a manifest.json listing the files to send.
//
//   node scripts/bundle-functions.ts                 write supabase/.bundle/<function>/ for every function
//   node scripts/bundle-functions.ts --out <dir>     write them under <dir> instead
//
// The output is not committed (gitignored): docs/DEPLOY.md builds it at deploy time.

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FUNCTIONS = join(ROOT, "supabase", "functions");
const DEFAULT_OUT = join(ROOT, "supabase", ".bundle");

/** The folders every function shares, copied into each bundle under the same names. */
const SHARED_DIRS = ["_lib", "_shared"];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

// A function is a folder with an index.ts; _shared and _lib are not functions.
export function functionDirs(): string[] {
  return readdirSync(FUNCTIONS)
    .filter((n) => !n.startsWith("_") && !n.startsWith("."))
    .filter((n) => existsSync(join(FUNCTIONS, n, "index.ts")))
    .sort();
}

// "../_lib/x.ts" and "../_shared/..." become "./_lib/x.ts" and "./_shared/...": the
// copies sit inside the function folder. Written without escape sequences on purpose.
const rewrite = (source: string): string => source.split('"../_lib/').join('"./_lib/').split('"../_shared/').join('"./_shared/');

export interface Manifest {
  name: string;
  entrypoint_path: string;
  import_map_path: string;
  /** Off for every function: each checks its caller itself (supabase/config.toml says why). */
  verify_jwt: false;
  /** Relative to the function folder, the names to send; read each file for its content. */
  files: string[];
}

/** Writes one function's bundle and returns its manifest. */
export function bundle(fn: string, outRoot: string): Manifest {
  const src = join(FUNCTIONS, fn);
  const out = join(outRoot, fn);
  rmSync(out, { recursive: true, force: true });
  const files: string[] = [];
  const put = (rel: string, content: string) => {
    const path = join(out, rel);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
    files.push(rel);
  };

  put("index.ts", rewrite(readFileSync(join(src, "index.ts"), "utf8")));
  // deno.json's import map is the same rewrite: "../_shared/core/index.ts" to "./_shared/...".
  put("deno.json", rewrite(readFileSync(join(src, "deno.json"), "utf8")));
  for (const dir of SHARED_DIRS) {
    const from = join(FUNCTIONS, dir);
    if (!existsSync(from)) throw new Error(`supabase/functions/${dir} is missing; run npm run functions:build`);
    for (const file of walk(from)) {
      const rel = join(dir, relative(from, file)).split("\\").join("/");
      put(rel, file.endsWith(".ts") ? rewrite(readFileSync(file, "utf8")) : readFileSync(file, "utf8"));
    }
  }

  const manifest: Manifest = { name: fn, entrypoint_path: "index.ts", import_map_path: "deno.json", verify_jwt: false, files };
  writeFileSync(join(out, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  return manifest;
}

export function bundleAll(outRoot: string): Manifest[] {
  mkdirSync(outRoot, { recursive: true });
  return functionDirs().map((fn) => bundle(fn, outRoot));
}

// Run as a script, not when imported by the test.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const at = process.argv.indexOf("--out");
  const outRoot = at !== -1 && process.argv[at + 1] ? process.argv[at + 1]! : DEFAULT_OUT;
  const done = bundleAll(outRoot);
  for (const m of done) console.log(`${m.name}: ${m.files.length} files`);
  console.log(`Bundles in ${relative(ROOT, outRoot) || "."}: one folder per function, each with a manifest.json.`);
}
