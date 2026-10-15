// The Edge Functions' choice of database key, under the newer API keys and the legacy ones.
// No network and no Deno: the chooser is pure.
import { test } from "node:test";
import assert from "node:assert/strict";
import { serviceKey } from "../supabase/functions/_lib/keys.ts";

const env = (vars: Record<string, string>) => (name: string) => vars[name];

test("the newer secret keys are used when the runtime provides them, the default one first", () => {
  const keys = JSON.stringify({ other: "sb_secret_other", default: "sb_secret_default" });
  assert.deepEqual(serviceKey(env({ SUPABASE_SECRET_KEYS: keys, SUPABASE_SERVICE_ROLE_KEY: "legacy-jwt" })), {
    key: "sb_secret_default",
    from: "SUPABASE_SECRET_KEYS",
  });
  assert.equal(serviceKey(env({ SUPABASE_SECRET_KEYS: JSON.stringify({ ops: "sb_secret_ops" }) }))?.key, "sb_secret_ops", "any named key if there is no default");
});

test("the legacy service_role key still works on its own", () => {
  assert.deepEqual(serviceKey(env({ SUPABASE_SERVICE_ROLE_KEY: "legacy-jwt" })), { key: "legacy-jwt", from: "SUPABASE_SERVICE_ROLE_KEY" });
});

test("a malformed or empty key list falls back instead of failing", () => {
  assert.equal(serviceKey(env({ SUPABASE_SECRET_KEYS: "not json", SUPABASE_SERVICE_ROLE_KEY: "legacy-jwt" }))?.from, "SUPABASE_SERVICE_ROLE_KEY");
  assert.equal(serviceKey(env({ SUPABASE_SECRET_KEYS: "{}", SUPABASE_SECRET_KEY: "sb_secret_local" }))?.from, "SUPABASE_SECRET_KEY");
  assert.equal(serviceKey(env({ SUPABASE_SECRET_KEYS: '{"default":""}', SUPABASE_SERVICE_ROLE_KEY: "legacy-jwt" }))?.key, "legacy-jwt");
});

test("no key at all is null, for the caller to say so", () => {
  assert.equal(serviceKey(env({})), null);
});
