// Which key the Edge Functions use to reach the database with full rights. Supabase now
// issues secret keys (sb_secret_...) beside the legacy service_role JWT, and a project on
// the new keys can have the legacy ones turned off. Supabase's "Environment variables"
// page lists what the hosted runtime provides: SUPABASE_SECRET_KEYS, a JSON object of
// named secret keys ("default" is the one to use), and the legacy SUPABASE_SERVICE_ROLE_KEY.
// The CLI's local stack is said to provide a single SUPABASE_SECRET_KEY instead.
//
// Pure, with no Deno in it, so the Node tests can check it (scripts/function-keys.test.ts).
// It returns where the key came from, never logs the key itself.

export interface ServiceKey {
  key: string;
  /** The variable it came from, for the log. */
  from: string;
}

/** The documented new name first, then the local single key, then the legacy one. Null if none is set. */
export function serviceKey(env: (name: string) => string | undefined): ServiceKey | null {
  const named = env("SUPABASE_SECRET_KEYS");
  if (named) {
    try {
      const keys: unknown = JSON.parse(named);
      if (keys && typeof keys === "object" && !Array.isArray(keys)) {
        const map = keys as Record<string, unknown>;
        const usable = (v: unknown): v is string => typeof v === "string" && v.length > 0;
        const key = usable(map.default) ? map.default : Object.values(map).find(usable);
        if (key) return { key, from: "SUPABASE_SECRET_KEYS" };
      }
    } catch {
      // Not JSON. The other names may still be set.
    }
  }
  const single = env("SUPABASE_SECRET_KEY");
  if (single) return { key: single, from: "SUPABASE_SECRET_KEY" };
  const legacy = env("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) return { key: legacy, from: "SUPABASE_SERVICE_ROLE_KEY" };
  return null;
}

/** Every name serviceKey reads, for the line logged when none is set. */
export const SERVICE_KEY_NAMES = ["SUPABASE_SECRET_KEYS", "SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY"] as const;
