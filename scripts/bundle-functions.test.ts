// Each bundle must stand on its own: every import inside it resolves to a file inside it,
// nothing reaches above the function folder, and the manifest lists exactly the files
// written. Built into a scratch folder; the repo is not touched.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { bundleAll, functionDirs } from "./bundle-functions.ts";

const SPECIFIER = /(?:from|import)\s*["']([^"']+)["']/g;

test("every function bundles into a folder whose imports all resolve inside it", () => {
  const out = mkdtempSync(join(tmpdir(), "hangoverbot-bundle-"));
  try {
    const manifests = bundleAll(out);
    assert.deepEqual(manifests.map((m) => m.name), functionDirs());
    assert.ok(manifests.length >= 6, "the six beta functions");

    for (const m of manifests) {
      const root = join(out, m.name);
      assert.equal(m.entrypoint_path, "index.ts");
      assert.equal(m.import_map_path, "deno.json");
      assert.equal(m.verify_jwt, false);
      for (const f of m.files) assert.ok(existsSync(join(root, f)), `${m.name}: ${f} listed but not written`);
      assert.ok(m.files.includes("index.ts") && m.files.includes("deno.json"));
      assert.ok(m.files.some((f) => f.startsWith("_lib/")) && m.files.some((f) => f.startsWith("_shared/")));
      assert.ok(existsSync(join(root, "manifest.json")));

      const map = JSON.parse(readFileSync(join(root, "deno.json"), "utf8")) as { imports: Record<string, string> };
      for (const [name, target] of Object.entries(map.imports)) {
        if (target.startsWith("npm:")) continue;
        assert.ok(target.startsWith("./"), `${m.name}: import map ${name} must point inside the bundle, got ${target}`);
        assert.ok(existsSync(join(root, target)), `${m.name}: import map ${name} -> ${target} is missing`);
      }

      for (const f of m.files.filter((x) => x.endsWith(".ts"))) {
        const source = readFileSync(join(root, f), "utf8");
        for (const match of source.matchAll(SPECIFIER)) {
          const spec = match[1] ?? "";
          if (spec.startsWith(".")) {
            const target = resolve(dirname(join(root, f)), spec);
            assert.ok(!relative(root, target).startsWith(".."), `${m.name}: ${f} imports ${spec}, outside the bundle`);
            assert.ok(existsSync(target), `${m.name}: ${f} imports ${spec}, which is not in the bundle`);
          } else if (!spec.startsWith("npm:") && !spec.startsWith("node:")) {
            assert.ok(spec in map.imports, `${m.name}: ${f} imports ${spec}, which the import map does not know`);
          }
        }
      }
    }
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});
