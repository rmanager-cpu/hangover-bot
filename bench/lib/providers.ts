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

import Anthropic from "@anthropic-ai/sdk";
import { anthropicAi, parseAdvice, parseChoice } from "@rosterbots/ai";
import type { Advice, AdviceInput, AiChoice, JudgeInput } from "@rosterbots/core";
import { adviceRequest, judgeRequest } from "./prompts.ts";
import { allToolsNote, anthropicTrace, openRouterTrace, type AnthropicBlock, type OpenRouterMessage } from "./trace.ts";
import type { Call, ModelEntry, Trace, Usage } from "./types.ts";

const OPENROUTER = "https://openrouter.ai/api/v1";
/** Production's limits (packages/ai): a minute for the Judge, 100 seconds for the Advisor. */
export const JUDGE_TIMEOUT_MS = 60_000;
export const ADVISE_TIMEOUT_MS = 100_000;
/** The every-tool run's guard against a hung call, not a speed rule: speed is reported, not judged. */
export const ALL_TOOLS_TIMEOUT_MS = 300_000;
/** Anthropic's web search, per search ($10 per 1,000), on top of tokens. OpenRouter's cost already includes its search fees. */
export const ANTHROPIC_SEARCH_USD = 0.01;

export type AdviseOptions = { web: boolean; tools?: "production" | "all" };

export interface Env {
  OPENROUTER_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
}

/** OpenRouter's listed price, dollars per token. */
export interface Price {
  prompt: number;
  completion: number;
}

/** A question the bench writes itself (no production request to capture yet): JSON in, JSON out. */
export interface Ask {
  system: string;
  user: string;
  schema: Record<string, unknown>;
}

export interface Contender {
  entry: ModelEntry;
  judge(input: JudgeInput): Promise<Call<AiChoice>>;
  advise(input: AdviceInput, opts: AdviseOptions): Promise<Call<Advice[]>>;
  /** The parsed JSON answer, unchecked; the caller validates it. Run like the Judge: low effort, a minute. */
  ask(req: Ask): Promise<Call<unknown>>;
}

const parsed = (text: string | null | undefined): unknown => {
  if (typeof text !== "string") return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

const ms = (t0: number): number => Math.round(performance.now() - t0);

const errorName = (e: unknown): string =>
  e instanceof Error ? (e.name === "TimeoutError" || e.name === "AbortError" ? "timeout" : e.name) : "unknown error";

// ---------------------------------------------------------------- OpenRouter

interface ChatResponse {
  provider?: string;
  choices?: { finish_reason?: string; message?: OpenRouterMessage }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number; server_tool_use_details?: Record<string, number> };
  error?: { code?: number | string; message?: string };
}

/**
 * Busy, not broke: OpenRouter's 429 is a short burst limit, its own or the model's provider's
 * (running out of credit is a 402). On Nov 7 five calls to three providers got one in the
 * same 1.6 seconds, with the key unlimited and $47 of its $50 left. So wait and try again,
 * as production would.
 */
const BUSY = new Set([429, 502, 503]);
const RETRIES = 3;

/** OpenRouter's reason for a failed call, short: which provider said what. Never the request. */
async function reasonOf(res: Response): Promise<string> {
  try {
    const j = (await res.json()) as { error?: { message?: string; metadata?: { provider_name?: string } } };
    const who = j.error?.metadata?.provider_name;
    const what = j.error?.message?.slice(0, 80);
    return what ? ` (${who ? who + ": " : ""}${what})` : "";
  } catch {
    return "";
  }
}

async function chat(key: string, body: Record<string, unknown>, timeoutMs: number, f: typeof fetch): Promise<ChatResponse> {
  for (let attempt = 0; ; attempt++) {
    const res = await f(`${OPENROUTER}/chat/completions`, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json", "x-title": "RosterBots bench" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (BUSY.has(res.status) && attempt < RETRIES) {
      const after = Number(res.headers.get("retry-after") ?? NaN);
      const wait = Number.isFinite(after) && after >= 0 ? Math.min(after, 30) * 1000 : 1000 * 2 ** attempt + Math.random() * 500;
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    if (!res.ok) throw Object.assign(new Error(`http ${res.status}`), { name: `http ${res.status}${await reasonOf(res)}` });
    const json = (await res.json()) as ChatResponse;
    if (json.error) throw Object.assign(new Error("provider error"), { name: `provider error ${json.error.code ?? ""}`.trim() });
    return json;
  }
}

const orUsage = (r: ChatResponse): Usage => ({
  ...(r.usage?.prompt_tokens !== undefined ? { inputTokens: r.usage.prompt_tokens } : {}),
  ...(r.usage?.completion_tokens !== undefined ? { outputTokens: r.usage.completion_tokens } : {}),
  // Includes OpenRouter's search and fetch fees (Nov 7: $0.026 billed against $0.004 of tokens).
  ...(r.usage?.cost !== undefined ? { costUsd: r.usage.cost } : {}),
  ...(r.usage?.server_tool_use_details?.web_search_requests ? { webSearches: r.usage.server_tool_use_details.web_search_requests } : {}),
});

/**
 * The every-tool request: OpenRouter's server tools, which it runs itself before the model
 * answers (search, fetch, the date; X search for xAI's models), and the report function, left
 * to the model to call when it is done. Forcing it, as production does, would skip the tools.
 */
function allToolsBody(entry: ModelEntry, req: { system: string; user: string; report: { name: string; description: string; input_schema: Record<string, unknown> } }) {
  const xai = entry.model.startsWith("x-ai/");
  return {
    model: entry.model,
    messages: [
      { role: "system", content: `${req.system} ${allToolsNote(xai)}` },
      { role: "user", content: req.user },
    ],
    tools: [
      { type: "openrouter:web_search", parameters: { max_results: 5, ...(xai ? { x_search: {} } : {}) } },
      { type: "openrouter:web_fetch" },
      { type: "openrouter:datetime" },
      { type: "function", function: { name: req.report.name, description: req.report.description, parameters: req.report.input_schema, strict: true } },
    ],
    tool_choice: "auto",
    // Reasoning counts against it: DeepSeek V4.1 Flash thought for 24,000 tokens on Nov 7 and
    // stopped before it reported at 16,000.
    max_tokens: 48000,
    usage: { include: true },
    provider: { require_parameters: true },
    ...reasoningOf(entry, "medium"),
  };
}

const reasoningOf = (e: ModelEntry, fallback: "low" | "medium"): Record<string, unknown> => {
  const effort = e.reasoning ?? fallback;
  return effort === "none" ? { reasoning: { enabled: false } } : { reasoning: { effort } };
};

const sumUsage = (a: Usage, b: Usage): Usage => {
  const add = (x?: number, y?: number) => (x === undefined && y === undefined ? undefined : (x ?? 0) + (y ?? 0));
  const out: Usage = {};
  for (const k of ["inputTokens", "outputTokens", "costUsd", "webSearches"] as const) {
    const v = add(a[k], b[k]);
    if (v !== undefined) out[k] = v;
  }
  return out;
};

/**
 * Production's forced report, no tools, given what the research call concluded: its words, its
 * draft report and the pages it read. Told to keep the advice as is: only the form changes.
 */
async function reform(
  entry: ModelEntry,
  key: string,
  req: { system: string; user: string },
  report: { name: string; description: string; input_schema: Record<string, unknown> },
  t: Trace,
  f: typeof fetch,
): Promise<{ args?: unknown; usage: Usage; error?: string }> {
  const draft = [
    t.text ? `What I wrote: ${t.text}` : "",
    t.rawReport ? `My draft report, in the wrong fields: ${t.rawReport}` : "",
    !t.text && !t.rawReport && t.reasoning ? `My notes: ${t.reasoning.slice(-6000)}` : "",
    t.citations?.length ? `Pages I read: ${t.citations.map((c) => c.url).join(", ")}` : "",
  ].filter(Boolean).join("\n\n");
  try {
    const r = await chat(
      key,
      {
        model: entry.model,
        messages: [
          { role: "system", content: req.system },
          { role: "user", content: req.user },
          { role: "assistant", content: draft || "I have no draft." },
          { role: "user", content: `Now call ${report.name} once, with exactly its fields. Keep the same advice: no new moves, none dropped. Put the pages you used in sources.` },
        ],
        tools: [{ type: "function", function: { name: report.name, description: report.description, parameters: report.input_schema, strict: true } }],
        tool_choice: { type: "function", function: { name: report.name } },
        max_tokens: 8000,
        usage: { include: true },
        provider: { require_parameters: true },
        ...reasoningOf(entry, "low"),
      },
      ADVISE_TIMEOUT_MS,
      f,
    );
    const raw = r.choices?.[0]?.message?.tool_calls?.find((c) => c.function?.name === report.name)?.function?.arguments;
    if (!raw) return { usage: orUsage(r), error: "no report" };
    try {
      return { args: JSON.parse(raw), usage: orUsage(r) };
    } catch {
      return { usage: orUsage(r), error: "unparseable report" };
    }
  } catch (e) {
    return { usage: {}, error: errorName(e) };
  }
}

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
    async ask(req) {
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
            response_format: { type: "json_schema", json_schema: { name: "answer", strict: true, schema: req.schema } },
            max_tokens: 2500,
            usage: { include: true },
            provider: { require_parameters: true },
            ...reasoningOf(entry, "low"),
          },
          JUDGE_TIMEOUT_MS,
          f,
        );
        const text = r.choices?.[0]?.message?.content;
        const answer = parsed(text);
        return { answer, latencyMs: ms(t0), usage: orUsage(r), ...(answer !== undefined ? {} : { error: text ? "unparseable answer" : `no answer (${r.choices?.[0]?.finish_reason ?? "?"})` }) };
      } catch (e) {
        return { answer: undefined, latencyMs: ms(t0), usage: {}, error: errorName(e) };
      }
    },
    async advise(input, opts) {
      const req = await adviceRequest(input);
      const report = req.report!;
      const all = opts.tools === "all";
      const t0 = performance.now();
      try {
        const r = await chat(
          key,
          all
            ? allToolsBody(entry, { system: req.system, user: req.user, report })
            : {
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
          all ? ALL_TOOLS_TIMEOUT_MS : ADVISE_TIMEOUT_MS,
          f,
        );
        const trace = openRouterTrace(r);
        const call = r.choices?.[0]?.message?.tool_calls?.find((t) => t.function?.name === report.name);
        const raw = call?.function?.arguments;
        let args: unknown;
        try {
          args = raw ? JSON.parse(raw) : undefined;
        } catch {
          args = undefined;
        }
        const answer = args === undefined ? undefined : parseAdvice(args);
        const sent = (args as { items?: unknown[] } | null | undefined)?.items;
        // Kept fewer than it sent, or sent no list, or no report at all.
        const lost = answer === undefined || !Array.isArray(sent) || answer.length < Math.min(sent.length, 5);
        if (!lost) return { answer, latencyMs: ms(t0), usage: orUsage(r), trace };
        const kept = raw ? { ...trace, rawReport: raw.slice(0, 6000) } : trace;
        if (!all) return { answer, latencyMs: ms(t0), usage: orUsage(r), ...(answer === undefined ? { error: raw ? "unparseable report" : "no report" } : {}), trace: kept };
        // The every-tool run: the same advice, put into production's form by a forced call.
        const fixed = await reform(entry, key, req, report, kept, f);
        const usage = sumUsage(orUsage(r), fixed.usage);
        const final = { ...kept, reformatted: true };
        if (!fixed.args) return { answer: undefined, latencyMs: ms(t0), usage, error: `no report after reformatting (${fixed.error})`, trace: final };
        return { answer: parseAdvice(fixed.args), latencyMs: ms(t0), usage, trace: final };
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
    const meter = { inputTokens: 0, outputTokens: 0, webSearches: 0, webFetches: 0, blocks: [] as AnthropicBlock[], stop: undefined as string | undefined };
    const wrapped = (async (url: string | URL | Request, init?: RequestInit) => {
      const res = await f(url, init);
      try {
        const body = (await res.clone().json()) as { usage?: Record<string, unknown>; content?: AnthropicBlock[]; stop_reason?: string };
        const u = body.usage ?? {};
        const n = (k: string): number => (typeof u[k] === "number" ? (u[k] as number) : 0);
        meter.inputTokens += n("input_tokens") + n("cache_creation_input_tokens") + n("cache_read_input_tokens");
        meter.outputTokens += n("output_tokens");
        const stu = u.server_tool_use as { web_search_requests?: number; web_fetch_requests?: number } | undefined;
        meter.webSearches += stu?.web_search_requests ?? 0;
        meter.webFetches += stu?.web_fetch_requests ?? 0;
        // Every response's blocks, in order: the trace of searches, fetches and thinking.
        if (Array.isArray(body.content)) meter.blocks.push(...body.content);
        if (body.stop_reason) meter.stop = body.stop_reason;
      } catch {
        // Not JSON (a stream or an error page): no usage to read.
      }
      return res;
    }) as typeof fetch;
    const usage = (): Usage => ({
      inputTokens: meter.inputTokens,
      outputTokens: meter.outputTokens,
      // Tokens at the listed price, plus Anthropic's per-search fee. Fetches cost only their tokens.
      ...(price ? { costUsd: meter.inputTokens * price.prompt + meter.outputTokens * price.completion + meter.webSearches * ANTHROPIC_SEARCH_USD } : {}),
      ...(meter.webSearches ? { webSearches: meter.webSearches } : {}),
      ...(meter.webFetches ? { webFetches: meter.webFetches } : {}),
    });
    const trace = () => anthropicTrace(meter.blocks, meter.stop);
    return { wrapped, usage, trace };
  };

  /**
   * The every-tool run: production's system prompt, user message and report tool, with web
   * search uncapped, web fetch, and the thinking shown. Production's loop: a long run comes
   * back as pause_turn and is continued; the report tool ends it.
   */
  async function adviseWithAllTools(input: AdviceInput): Promise<Call<Advice[]>> {
    const m = metered();
    const req = await adviceRequest(input);
    const report = req.report!;
    const client = new Anthropic({ apiKey: key, maxRetries: 1, fetch: m.wrapped });
    const signal = AbortSignal.timeout(ALL_TOOLS_TIMEOUT_MS);
    const messages: Anthropic.Messages.MessageParam[] = [{ role: "user", content: req.user }];
    const t0 = performance.now();
    const done = (answer: Advice[] | undefined, error?: string): Call<Advice[]> => ({ answer, latencyMs: ms(t0), usage: m.usage(), ...(error ? { error } : {}), trace: m.trace() });
    try {
      for (let round = 0; round < 10; round++) {
        const res = await client.messages.create(
          {
            model: entry.model,
            max_tokens: 16000,
            system: `${req.system} ${allToolsNote(false)}`,
            messages,
            tools: [
              { type: "web_search_20260209", name: "web_search" },
              { type: "web_fetch_20260209", name: "web_fetch", max_content_tokens: 20000 },
              { name: report.name, description: report.description, input_schema: report.input_schema as Anthropic.Messages.Tool.InputSchema },
            ],
            tool_choice: { type: "auto" },
            thinking: { type: "adaptive", display: "summarized" },
            output_config: { effort: "medium" },
          },
          { signal, timeout: ALL_TOOLS_TIMEOUT_MS, maxRetries: 0 },
        );
        const reported = res.content.find((b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use" && b.name === report.name);
        if (reported) return done(parseAdvice(reported.input));
        if (res.stop_reason !== "pause_turn") return done(undefined, res.stop_reason === "max_tokens" ? "max_tokens" : "no report");
        messages.push({ role: "assistant", content: res.content });
      }
      return done(undefined, "no report after 10 rounds");
    } catch (e) {
      return done(undefined, e instanceof Anthropic.APIError ? `${e.name} ${e.status ?? ""}`.trim() : errorName(e));
    }
  }

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
    async advise(input, opts) {
      if (opts.tools === "all") return adviseWithAllTools(input);
      const m = metered();
      let error: string | undefined;
      const ai = anthropicAi({ apiKey: key, model: entry.model, fetch: m.wrapped, onError: (w) => (error = w) });
      const t0 = performance.now();
      const items = await ai.advisor.advise(input);
      // The adapter answers [] for "nothing to say" and for a failure alike; the error tells them apart.
      return { answer: error ? undefined : items, latencyMs: ms(t0), usage: m.usage(), ...(error ? { error } : {}), trace: m.trace() };
    },
    async ask(req) {
      // The Judge's call shape (packages/ai), with the bench's own prompt and schema.
      const m = metered();
      const client = new Anthropic({ apiKey: key, maxRetries: 1, fetch: m.wrapped });
      const t0 = performance.now();
      try {
        const res = await client.messages.create(
          {
            model: entry.model,
            max_tokens: 2500,
            system: req.system,
            messages: [{ role: "user", content: req.user }],
            thinking: { type: "adaptive" },
            output_config: { effort: "low", format: { type: "json_schema", schema: req.schema } },
          },
          { timeout: JUDGE_TIMEOUT_MS, maxRetries: 1 },
        );
        const text = res.content.find((b): b is Anthropic.TextBlock => b.type === "text")?.text;
        const answer = parsed(text);
        return { answer, latencyMs: ms(t0), usage: m.usage(), ...(answer !== undefined ? {} : { error: text ? "unparseable answer" : `no answer (${res.stop_reason ?? "?"})` }) };
      } catch (e) {
        return { answer: undefined, latencyMs: ms(t0), usage: m.usage(), error: e instanceof Anthropic.APIError ? `${e.name} ${e.status ?? ""}`.trim() : errorName(e) };
      }
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
    async ask(req) {
      // The scratch bench's stand-ins: "keyword" believes any news that says out; "never" never does.
      if (entry.model === "silent") return { answer: undefined, latencyMs: 1, usage: { costUsd: 0 }, error: "mock silence" };
      const news = ((parsed(req.user) as { news?: { text?: string }[] } | undefined)?.news ?? []).map((n) => n.text ?? "").join(" ");
      const said = /ruled out|\binactive\b|will not play|won't play/i.test(news);
      const out = entry.model === "never" ? 0.05 : entry.model === "keyword" ? (said ? 0.97 : 0.2) : 0.5;
      return { answer: { out, reason: said ? "The news says he is out." : "Nothing says he is out." }, latencyMs: 1, usage: { costUsd: 0 } };
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
