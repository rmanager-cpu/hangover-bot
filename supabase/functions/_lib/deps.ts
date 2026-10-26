// The service's outside world, as the Edge Functions provide it.

import { BETA_AUTOMATION } from "@rosterbots/core";
import { espnConnector } from "@rosterbots/connectors";
import { anthropicAi } from "@rosterbots/ai";
import { expoPush, type AiDeps, type Deps } from "@rosterbots/service";
import type { AppStore } from "./store.ts";

let ai: AiDeps | undefined | null = null;

/**
 * The AI, from the function secret ANTHROPIC_API_KEY (docs/DEPLOY.md). Without it AI Native
 * runs as Auto Protect: bench fixes, and proposals where it would have gone outside. Said
 * once per instance; the key itself is never logged.
 */
function anthropic(): AiDeps | undefined {
  if (ai !== null) return ai;
  // Trimmed: a pasted secret can carry a space or newline, and the SDK puts the key after "Bearer ".
  const apiKey = (Deno.env.get("ANTHROPIC_API_KEY") ?? "").trim();
  if (!apiKey) {
    console.log("ai: ANTHROPIC_API_KEY is not set; AI Native runs without AI");
    ai = undefined;
    return ai;
  }
  const model = Deno.env.get("ANTHROPIC_MODEL") || undefined;
  console.log(`ai: Anthropic key present${model ? `, model ${model}` : ""}`);
  ai = anthropicAi({ apiKey, ...(model ? { model } : {}), onError: (what) => console.error("ai: " + what) });
  return ai;
}

export function makeDeps(store: AppStore): Deps {
  const a = anthropic();
  return {
    store,
    push: expoPush(),
    connector: (credentials, season) => espnConnector({ season, credentials }),
    now: () => new Date(),
    policy: BETA_AUTOMATION,
    ...(a ? { ai: a } : {}),
  };
}
