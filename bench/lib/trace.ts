// What a model did on the way to its answer, read out of each provider's response: the tools it
// called and what they returned, its reasoning as far as the provider shows it, and anything it
// wrote besides the report. Pure: the network calls are in providers.ts.

import type { ToolUse, Trace } from "./types.ts";

/**
 * The "use every tool" run (owner, Nov 7: "let them use whatever tools they want to use"):
 * added to production's system prompt, which caps searches. Grok is told to search X
 * (owner: "specifically tell Grok to use its X tools"); only xAI's models can.
 */
export function allToolsNote(xSearch: boolean): string {
  return [
    "For this run you may use every tool you have, as often as you need: search the web, read whole pages, check today's date.",
    "The search limit above does not apply.",
    ...(xSearch ? ["You can also search X: use X search for the latest injury, practice and depth-chart news from team beat reporters and NFL insiders."] : []),
    "Still finish by calling report_advice exactly once.",
  ].join(" ");
}

// ---------------------------------------------------------------- OpenRouter

export interface OpenRouterMessage {
  content?: string | null;
  reasoning?: string | null;
  reasoning_details?: { type?: string; text?: string; summary?: string; data?: string }[];
  annotations?: { type?: string; url_citation?: { url?: string; title?: string; content?: string } }[];
  tool_calls?: { function?: { name?: string; arguments?: string } }[];
}

export interface OpenRouterBody {
  provider?: string;
  choices?: { finish_reason?: string; message?: OpenRouterMessage }[];
  usage?: { server_tool_use_details?: Record<string, number> };
}

/**
 * OpenRouter runs its server tools itself and reports counts, not calls: searches made and tool
 * calls executed (fetches, the date, X), and the pages used as url_citation annotations.
 */
export function openRouterTrace(r: OpenRouterBody): Trace {
  const choice = r.choices?.[0];
  const m = choice?.message ?? {};
  const details = m.reasoning_details ?? [];
  const shown = details.filter((d) => d.type === "reasoning.text" || d.type === "reasoning.summary").map((d) => d.text ?? d.summary ?? "").filter(Boolean);
  const reasoning = (typeof m.reasoning === "string" && m.reasoning.trim() ? m.reasoning : shown.join("\n")).trim();
  const seen = new Set<string>();
  const citations: NonNullable<Trace["citations"]> = [];
  for (const a of m.annotations ?? []) {
    const c = a.url_citation;
    if (a.type !== "url_citation" || !c?.url || seen.has(c.url)) continue;
    seen.add(c.url);
    citations.push({ url: c.url, ...(c.title ? { title: c.title } : {}), ...(c.content ? { snippet: squash(c.content, 240) } : {}) });
  }
  const st = r.usage?.server_tool_use_details ?? {};
  const searches = st.web_search_requests ?? 0;
  const executed = st.tool_calls_executed ?? 0;
  const toolCounts: Record<string, number> = {};
  if (searches) toolCounts.web_search = searches;
  if (executed > searches) toolCounts["other server tools (fetch, date, X)"] = executed - searches;
  return {
    ...(r.provider ? { provider: r.provider } : {}),
    ...(reasoning ? { reasoning } : {}),
    ...(details.some((d) => d.type === "reasoning.encrypted") ? { reasoningHidden: true } : {}),
    tools: [],
    ...(Object.keys(toolCounts).length ? { toolCounts } : {}),
    ...(citations.length ? { citations } : {}),
    ...(typeof m.content === "string" && m.content.trim() ? { text: m.content.trim() } : {}),
    ...(choice?.finish_reason ? { finish: choice.finish_reason } : {}),
  };
}

// ---------------------------------------------------------------- Anthropic

/** The content blocks of every response in one advice run, in order. */
export type AnthropicBlock = { type: string; [k: string]: unknown };

/** Anthropic itemizes everything: each search's words and results, each page fetched, the summarized thinking. */
export function anthropicTrace(blocks: AnthropicBlock[], finish?: string): Trace {
  const tools: (ToolUse & { id?: string })[] = [];
  const thinking: string[] = [];
  const text: string[] = [];
  let hidden = false;
  const byId = (id: unknown) => tools.find((t) => t.id === id);
  for (const b of blocks) {
    if (b.type === "thinking" && typeof b.thinking === "string") thinking.push(b.thinking);
    else if (b.type === "redacted_thinking") hidden = true;
    else if (b.type === "text" && typeof b.text === "string") text.push(b.text);
    else if (b.type === "server_tool_use") {
      const input = (b.input ?? {}) as { query?: unknown; url?: unknown };
      tools.push({
        id: b.id as string,
        tool: String(b.name),
        ...(typeof input.query === "string" ? { query: input.query } : {}),
        ...(typeof input.url === "string" ? { url: input.url } : {}),
      });
    } else if (b.type === "web_search_tool_result") {
      const t = byId(b.tool_use_id);
      if (!t) continue;
      if (Array.isArray(b.content)) {
        t.results = (b.content as { type?: string; url?: string; title?: string }[])
          .filter((r) => r.type === "web_search_result" && r.url)
          .map((r) => ({ url: r.url!, ...(r.title ? { title: r.title } : {}) }));
      } else t.error = String((b.content as { error_code?: string } | undefined)?.error_code ?? "error");
    } else if (b.type === "web_fetch_tool_result") {
      const t = byId(b.tool_use_id);
      if (!t) continue;
      const c = b.content as { type?: string; url?: string; error_code?: string; content?: { title?: string } } | undefined;
      if (c?.type === "web_fetch_result" && c.url) t.results = [{ url: c.url, ...(c.content?.title ? { title: c.content.title } : {}) }];
      else t.error = c?.error_code ?? "error";
    }
  }
  const words = text.join("\n").trim();
  const reasoning = thinking.join("\n\n").trim();
  return {
    ...(reasoning ? { reasoning } : {}),
    ...(hidden ? { reasoningHidden: true } : {}),
    tools: tools.map(({ id: _id, ...t }) => t),
    ...(words ? { text: words } : {}),
    ...(finish ? { finish } : {}),
  };
}

function squash(s: string, n: number): string {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > n ? one.slice(0, n - 1) + "…" : one;
}
