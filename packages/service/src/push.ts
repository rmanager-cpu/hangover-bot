// Expo's push service, which hands on to FCM and APNs. fetch is injected so tests
// need no network and the same code runs under Deno and Node.

import type { Push } from "./types.ts";

export const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
// Expo takes at most 100 messages a request.
const BATCH = 100;

export function expoPush(fetchImpl?: typeof fetch): Push {
  return {
    async send(tokens, msg) {
      const f = fetchImpl ?? fetch;
      const to = [...new Set(tokens)];
      for (let i = 0; i < to.length; i += BATCH) {
        // No channelId: Expo creates Android's default channel itself. High priority so it shows on a locked phone.
        const messages = to.slice(i, i + BATCH).map((token) => ({
          to: token,
          title: msg.title,
          body: msg.body,
          sound: "default",
          priority: "high",
          ...(msg.data ? { data: msg.data } : {}),
        }));
        const r = await f(EXPO_PUSH_URL, {
          method: "POST",
          signal: AbortSignal.timeout(10_000),
          headers: { accept: "application/json", "content-type": "application/json" },
          body: JSON.stringify(messages),
        });
        // Per-token errors (an uninstalled app) come back inside a 200 and are not fatal to the rest.
        if (!r.ok) throw new Error("Expo push refused the request (HTTP " + r.status + ")");
      }
    },
  };
}
