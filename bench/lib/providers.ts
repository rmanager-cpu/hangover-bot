// The contenders. Every one answers the same captured production request (prompts.ts) and is
// parsed by production's own parsers (parseChoice, parseAdvice), so the only thing that
// changes between rows of a report is the model.
//
//  - openrouter: any model on OpenRouter, through its OpenAI-style chat API. One key, one code
//    path, cost reported per call.
//  - anthropic: the production adapter in packages/ai, unchanged, with your Anthropic key. The
//    baseline: what RosterBots does today.
//  - mock: offline stand-ins for testing the bench itself.
//
// This file is the bench's only network code. It is dev tooling: nothing in packages/ or
// supabase/ imports it, and it does not change which provider production uses (docs/STACK.md).

import { anthropicAi, parseAdvice, parseChoice } from "@rosterbots/ai";
import type { Advice, AdviceInput, AiChoice, JudgeInput } from "@rosterbots/core";
import { adviceRequest, judgeRequest } from "./prompts.ts";
import type { Call, ModelEntry, Usage } from "./types.ts";

const OPENROUTER = "https://openrouter.ai/api/v1";
/** Production's limits (packages/ai): a minute for the Judge, 100 seconds for the Advisor. */
export const JUDGE_TIMEOUT_MS = 60_000;
export const ADVISE_TIMEOUT_MS = 100_000;

export interface Env {
  OPENROUTER_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
}

/** OpenRouter's listed price, dollars per token. */
export interface Price {
  prompt: number;
  completion: number;
}

export interface Contender {
  entry: ModelEntry;
  judge(input: JudgeInput): Promise<Call<AiChoice>>;
  advise(input: AdviceInput, opts: { web: boolean }): Promise<Call<Advice[]>>;
}

const ms = (t0: number): number => Math.round(performance.now() - t0);

const errorName = (e: unknown): string =>
  e instanceof Error ? (e.name === "TimeoutError" || e.name === "AbortError" ? "timeout" : e.name) : "unknown error";

// ---------------------------------------------------------------- OpenRouter

interface ChatResponse {
  choices?: {
    finish_reason?: string;
    message?: { content?: string | null; tool_calls?: { function?: { name?: string; arguments?: string } }[] };
  }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
  error?: { code?: number | string; message?: string };
}

async function chat(key: string, body: Record<string, unknown>, timeoutMs: number, f: typeof fetch): Promise<ChatResponse> {
  const res = await f(`${OPENROUTER}/chat/completions`, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json", "x-title": "RosterBots bench" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw Object.assign(new Error(`http ${res.status}`), { name: `http ${res.status}` });
  const json = (await res.json()) as ChatResponse;
  if (json.error) throw Object.assign(new Error("provider error"), { name: `provider error ${json.error.code ?? ""}`.trim() });
  return json;
}

const orUsage = (r: ChatResponse): Usage => ({
  ...(r.usage?.prompt_tokens !== undefined ? { inputTokens: r.usage.prompt_tokens } : {}),
  ...(r.usage?.completion_tokens !== undefined ? { outputTokens: r.usage.completion_tokens } : {}),
  ...(r.usage?.cost !== undefined ? { costUsd: r.usage.cost } : {}),
});

const reasoningOf = (e: ModelEntry, fallback: "low" | "medium"): Record<string, unknown> => {
  const effort = e.reasoning ?? fallback;
  return effort === "none" ? { reasoning: { enabled: false } } : { reasoning: { effort } };
};

function openRouter(entry: ModelEntry, key: string, f: typeof fetch): Contender {
  return {
    entry,
    async judge(input) {
      const req = await judgeRequest(input);
      const t0 = performance.now();
      try {
        const r = await chat(
          key,
          {
            model: entry.model,
            messages: [
              { role: "system", content: req.system },
              { role: "user", content: req.user },
            ],
            response_format: { type: "json_schema", json_schema: { name: "choice", strict: true, schema: req.schema } },
            max_tokens: 2500,
            usage: { include: true },
            // Route only to hosts that honour the schema, rather than one that ignores it.
            provider: { require_parameters: true },
            ...reasoningOf(entry, "low"),
          },
          JUDGE_TIMEOUT_MS,
          f,
        );
        const text = r.choices?.[0]?.message?.content;
        const answer = typeof text === "string" ? parseChoice(text) : undefined;
        return { answer, latencyMs: ms(t0), usage: orUsage(r), ...(answer ? {} : { error: text ? "unparseable answer" : `no answer (${r.choices?.[0]?.finish_reason ?? "?"})` }) };
      } catch (e) {
        return { answer: undefined, latencyMs: ms(t0), usage: {}, error: errorName(e) };
      }
    },
    async advise(input, opts) {
      const req = await adviceRequest(input);
      const report = req.report!;
      const t0 = performance.now();
      try {
        const r = await chat(
          key,
          {
            model: entry.model,
            messages: [
              { role: "system", content: req.system },
              { role: "user", content: req.user },
            ],
            tools: [{ type: "function", function: { name: report.name, description: report.description, parameters: report.input_schema, strict: true } }],
            tool_choice: { type: "function", function: { name: report.name } },
            max_tokens: 8000,
            usage: { include: true },
            provider: { require_parameters: true },
            ...reasoningOf(entry, "medium"),
            // OpenRouter's web plugin searches once, up front, with its own engine: not the
            // agentic search production does with Claude. Comparable between OpenRouter rows only.
            ...(opts.web ? { plugins: [{ id: "web", max_results: req.maxSearches ?? 6 }] } : {}),
          },
          ADVISE_TIMEOUT_MS,
          f,
        );
        const call = r.choices?.[0]?.message?.tool_calls?.find((t) => t.function?.name === report.name);
        if (!call?.function?.arguments) return { answer: undefined, latencyMs: ms(t0), usage: orUsage(r), error: "no report" };
        let args: unknown;
        try {
          args = JSON.parse(call.function.arguments);
        } catch {
          return { answer: undefined, latencyMs: ms(t0), usage: orUsage(r), error: "unparseable report" };
        }
        return { answer: parseAdvice(args), latencyMs: ms(t0), usage: orUsage(r) };
      } catch (e) {
        return { answer: undefined, latencyMs: ms(t0), usage: {}, error: errorName(e) };
      }
    },
  };
}

// ---------------------------------------------------------------- Anthropic, the production adapter

function anthropicDirect(entry: ModelEntry, key: string, price: Price | undefined, f: typeof fetch): Contender {
  // The adapter takes a fetch, so a metering wrapper reads each response's usage on the way past.
  const metered = () => {
    const meter = { inputTokens: 0, outputTokens: 0, webSearches: 0 };
    const wrapped = (async (url: string | URL | Request, init?: RequestInit) => {
      const res = await f(url, init);
      try {
        const u = ((await res.clone().json()) as { usage?: Record<string, unknown> }).usage ?? {};
        const n = (k: string): number => (typeof u[k] === "number" ? (u[k] as number) : 0);
        meter.inputTokens += n("input_tokens") + n("cache_creation_input_tokens") + n("cache_read_input_tokens");
        meter.outputTokens += n("output_tokens");
        const stu = u.server_tool_use as { web_search_requests?: number } | undefined;
        meter.webSearches += stu?.web_search_requests ?? 0;
      } catch {
        // Not JSON (a stream or an error page): no usage to read.
      }
      return res;
    }) as typeof fetch;
    const usage = (): Usage => ({
      inputTokens: meter.inputTokens,
      outputTokens: meter.outputTokens,
      // Token cost only: web searches are billed per search on top, counted in webSearches.
      ...(price ? { costUsd: meter.inputTokens * price.prompt + meter.outputTokens * price.completion } : {}),
      ...(meter.webSearches ? { webSearches: meter.webSearches } : {}),
    });
    return { wrapped, usage };
  };

  return {
    entry,
    async judge(input) {
      const m = metered();
      let error: string | undefined;
      const ai = anthropicAi({ apiKey: key, model: entry.model, fetch: m.wrapped, onError: (w) => (error = w) });
      const t0 = performance.now();
      const answer = await ai.judge.pick(input);
      return { answer, latencyMs: ms(t0), usage: m.usage(), ...(answer ? {} : { error: error ?? "no answer" }) };
    },
    async advise(input) {
      const m = metered();
      let error: string | undefined;
      const ai = anthropicAi({ apiKey: key, model: entry.model, fetch: m.wrapped, onError: (w) => (error = w) });
      const t0 = performance.now();
      const items = await ai.advisor.advise(input);
      // The adapter answers [] for "nothing to say" and for a failure alike; the error tells them apart.
      return { answer: error ? undefined : items, latencyMs: ms(t0), usage: m.usage(), ...(error ? { error } : {}) };
    },
  };
}

// ---------------------------------------------------------------- Mocks

function mock(entry: ModelEntry): Contender {
  const best = (input: JudgeInput): AiChoice => {
    const top = [...input.candidates].sort((a, b) => (b.projection ?? 0) - (a.projection ?? 0))[0];
    const fill = input.benchFill?.projection ?? 0;
    return top && (top.projection ?? 0) > fill
      ? { playerId: top.id, confidence: 0.9, reason: `${top.name} projects highest.` }
      : { playerId: null, confidence: 0.9, reason: "The bench fill is as good as anyone." };
  };
  const judges: Record<string, (i: JudgeInput) => AiChoice | undefined> = {
    "best-projection": best,
    keep: () => ({ playerId: null, confidence: 0.9, reason: "Keep the bench fill." }),
    "off-list": () => ({ playerId: "nobody", confidence: 0.95, reason: "A player who was not offered." }),
    "first-unsure": (i) => ({ playerId: i.candidates[0]?.id ?? null, confidence: 0.5, reason: "First on the list." }),
    silent: () => undefined,
  };
  return {
    entry,
    async judge(input) {
      const pick = judges[entry.model];
      if (!pick) throw new Error(`unknown mock "${entry.model}"; one of ${Object.keys(judges).join(", ")}`);
      const answer = pick(input);
      return { answer, latencyMs: 1, usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 }, ...(answer ? {} : { error: "mock silence" }) };
    },
    async advise(input) {
      if (entry.model === "silent") return { answer: undefined, latencyMs: 1, usage: { costUsd: 0 }, error: "mock silence" };
      const fa = [...input.freeAgents].filter((p) => !p.onWaivers).sort((a, b) => (b.seasonProjection ?? 0) - (a.seasonProjection ?? 0))[0];
      const drop = entry.model === "off-list" ? "nobody" : input.droppable[0];
      const items: Advice[] = fa
        ? [{ kind: "fit", title: `Add ${fa.name}`, body: `${fa.name} projects best of the free agents.`, sources: ["ESPN"], action: { add: fa.id, ...(drop ? { drop } : {}) } }]
        : [];
      return { answer: items, latencyMs: 1, usage: { costUsd: 0 } };
    },
  };
}

// ---------------------------------------------------------------- Setup

export function contender(entry: ModelEntry, env: Env, prices: Map<string, Price>, f: typeof fetch = fetch): Contender {
  if (entry.via === "mock") return mock(entry);
  if (entry.via === "openrouter") return openRouter(entry, env.OPENROUTER_API_KEY ?? "", f);
  return anthropicDirect(entry, env.ANTHROPIC_API_KEY ?? "", entry.priceFrom ? prices.get(entry.priceFrom) : undefined, f);
}

export interface CatalogModel {
  id: string;
  created?: number;
  pricing?: { prompt?: string; completion?: string };
}

export async function openRouterCatalog(f: typeof fetch = fetch): Promise<CatalogModel[]> {
  const res = await f(`${OPENROUTER}/models`, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`OpenRouter's model list answered ${res.status}`);
  return ((await res.json()) as { data?: CatalogModel[] }).data ?? [];
}

/** Ids from the same author, newest first: what to put in models.json instead of a missing id. */
export function suggestions(catalog: CatalogModel[], id: string, n = 5): string[] {
  const author = id.split("/")[0] + "/";
  return catalog
    .filter((m) => m.id.startsWith(author) && !m.id.endsWith(":batch"))
    .sort((a, b) => (b.created ?? 0) - (a.created ?? 0))
    .slice(0, n)
    .map((m) => m.id);
}

/**
 * Before spending anything: keys present, every OpenRouter id real, prices for direct calls.
 * Problems stop the run; warnings don't. Both come back as sentences.
 */
export async function preflight(
  entries: ModelEntry[],
  env: Env,
  f: typeof fetch = fetch,
): Promise<{ problems: string[]; warnings: string[]; prices: Map<string, Price> }> {
  const problems: string[] = [];
  const warnings: string[] = [];
  const prices = new Map<string, Price>();
  if (entries.some((e) => e.via === "openrouter") && !env.OPENROUTER_API_KEY) problems.push("OPENROUTER_API_KEY is not set (https://openrouter.ai/keys).");
  if (entries.some((e) => e.via === "anthropic") && !env.ANTHROPIC_API_KEY) problems.push("ANTHROPIC_API_KEY is not set.");
  const needCatalog = entries.some((e) => e.via === "openrouter" || e.priceFrom);
  if (!needCatalog) return { problems, warnings, prices };
  let catalog: CatalogModel[];
  try {
    catalog = await openRouterCatalog(f);
  } catch (e) {
    const missing = `Could not read OpenRouter's model list (${errorName(e)}).`;
    if (entries.some((e) => e.via === "openrouter")) problems.push(missing);
    else warnings.push(`${missing} Direct Anthropic costs will show as blank.`);
    return { problems, warnings, prices };
  }
  for (const m of catalog) {
    const prompt = Number(m.pricing?.prompt);
    const completion = Number(m.pricing?.completion);
    if (Number.isFinite(prompt) && Number.isFinite(completion)) prices.set(m.id, { prompt, completion });
  }
  const ids = new Set(catalog.map((m) => m.id));
  for (const e of entries) {
    if (e.via === "openrouter" && !ids.has(e.model)) {
      const alt = suggestions(catalog, e.model);
      problems.push(`"${e.name}": OpenRouter has no model "${e.model}".${alt.length ? ` Newest from that author: ${alt.join(", ")}` : ""}`);
    }
    if (e.priceFrom && !prices.has(e.priceFrom)) warnings.push(`"${e.name}": no OpenRouter price for "${e.priceFrom}"; its cost will show as blank.`);
  }
  return { problems, warnings, prices };
}
