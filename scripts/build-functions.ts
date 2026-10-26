// Edge Functions run on Deno and are deployed from supabase/functions alone, so the
// shared packages are copied in beside them and each function gets an import map.
//
//   node scripts/build-functions.ts           write supabase/functions/_shared and deno.json files
//   node scripts/build-functions.ts --check   change nothing; exit 1 if anything is stale
//
// The copies are committed: deploying must not depend on having run this first.

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FUNCTIONS = join(ROOT, "supabase", "functions");
const SHARED = join(FUNCTIONS, "_shared");

/** Copied as `@rosterbots/<name>`. */
const PACKAGES = ["core", "connectors", "football-data", "service", "ai"];
const SUPABASE_JS = "npm:@supabase/supabase-js@2";
/** The AI package's one dependency, resolved by Deno's npm support at the pinned version package.json names. */
const ANTHROPIC_SDK = "npm:@anthropic-ai/sdk@1.3.0";

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

// The entry point a package exports, as a path inside its src folder.
function entryOf(pkg: string): string {
  const manifest = JSON.parse(readFileSync(join(ROOT, "packages", pkg, "package.json"), "utf8")) as {
    exports?: string | Record<string, string>;
  };
  const exp = typeof manifest.exports === "string" ? manifest.exports : manifest.exports?.["."];
  if (!exp || !exp.startsWith("./src/")) throw new Error(`packages/${pkg}: exports "." must point into ./src/`);
  return exp.slice("./src/".length);
}

/** Every file this script owns, with the content it should have. */
function expected(): Map<string, string> {
  const files = new Map<string, string>();
  const imports: Record<string, string> = {};

  for (const pkg of PACKAGES) {
    const src = join(ROOT, "packages", pkg, "src");
    if (!existsSync(src)) throw new Error(`packages/${pkg}/src is missing`);
    for (const file of walk(src)) {
      const rel = relative(src, file);
      const body = readFileSync(file, "utf8");
      const header = file.endsWith(".ts") ? `// Copied from packages/${pkg}/src/${rel} by scripts/build-functions.ts. Edit the original.\n` : "";
      files.set(join(SHARED, pkg, rel), header + body);
    }
    imports[`@rosterbots/${pkg}`] = `../_shared/${pkg}/${entryOf(pkg)}`;
  }
  imports["@supabase/supabase-js"] = SUPABASE_JS;
  imports["@anthropic-ai/sdk"] = ANTHROPIC_SDK;

  // "lock": false keeps a local `deno check` from leaving lockfiles in every function.
  const denoJson = JSON.stringify({ imports, lock: false }, null, 2) + "\n";
  for (const fn of functionDirs()) files.set(join(FUNCTIONS, fn, "deno.json"), denoJson);
  return files;
}

// A function is a folder with an index.ts; _shared and _lib are not deployed.
function functionDirs(): string[] {
  if (!existsSync(FUNCTIONS)) return [];
  return readdirSync(FUNCTIONS)
    .filter((n) => !n.startsWith("_") && !n.startsWith("."))
    .filter((n) => existsSync(join(FUNCTIONS, n, "index.ts")))
    .sort();
}

function stale(files: Map<string, string>): string[] {
  const out: string[] = [];
  for (const [path, content] of files) {
    if (!existsSync(path) || readFileSync(path, "utf8") !== content) out.push(relative(ROOT, path));
  }
  // A file left in _shared after its original was deleted or renamed.
  if (existsSync(SHARED)) {
    for (const path of walk(SHARED)) if (!files.has(path)) out.push(relative(ROOT, path));
  }
  return out.sort();
}

function write(files: Map<string, string>): void {
  rmSync(SHARED, { recursive: true, force: true });
  for (const [path, content] of files) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }
}

const check = process.argv.includes("--check");
let files: Map<string, string>;
try {
  files = expected();
} catch (e) {
  console.error("build-functions: " + (e instanceof Error ? e.message : String(e)));
  process.exit(2);
}

if (check) {
  const out = stale(files);
  if (out.length) {
    console.error(`supabase/functions is out of date with packages/ (${out.length} file(s)). Run: node scripts/build-functions.ts`);
    for (const p of out) console.error("  " + p);
    process.exit(1);
  }
  console.log("supabase/functions is up to date.");
} else {
  write(files);
  console.log(`Wrote ${files.size} files: ${PACKAGES.join(", ")} into supabase/functions/_shared, deno.json for ${functionDirs().join(", ") || "no functions yet"}.`);
}
