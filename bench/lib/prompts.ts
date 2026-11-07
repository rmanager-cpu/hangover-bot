// The exact request production sends, captured from the production adapter itself: its
// fetch is swapped for one that records the body and answers with a stub. Nothing leaves
// the machine. Every model in the bench gets this same system prompt, user message and
// schema, so a change to packages/ai is benchmarked without touching the bench.

import { anthropicAi } from "@rosterbots/ai";
import type { AdviceInput, JudgeInput } from "@rosterbots/core";

export interface Request {
  system: string;
  user: string;
  /** The Judge's answer schema. */
  schema?: Record<string, unknown>;
  /** The Advisor's report tool, as Anthropic declares it (name, description, input_schema). */
  report?: { name: string; description: string; input_schema: Record<string, unknown> };
  /** The Advisor's web search limit. */
  maxSearches?: number;
}

const stub = (content: unknown[]): Response =>
  new Response(
    JSON.stringify({
      id: "msg_capture",
      type: "message",
      role: "assistant",
      model: "capture",
      content,
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 0, output_tokens: 0 },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );

function capture(answer: Response): { f: typeof fetch; body: () => Record<string, unknown> } {
  let body: Record<string, unknown> | undefined;
  const f = (async (_url: string | URL | Request, init?: RequestInit) => {
    body ??= JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    return answer.clone();
  }) as typeof fetch;
  return {
    f,
    body: () => {
      if (!body) throw new Error("the production adapter made no request");
      return body;
    },
  };
}

const userText = (body: Record<string, unknown>): string => {
  const first = (body.messages as { content: unknown }[] | undefined)?.[0]?.content;
  if (typeof first !== "string") throw new Error("unexpected user message shape from packages/ai");
  return first;
};

export async function judgeRequest(input: JudgeInput): Promise<Request> {
  const c = capture(stub([{ type: "text", text: JSON.stringify({ playerId: null, confidence: 0, reason: "" }) }]));
  await anthropicAi({ apiKey: "capture-only", fetch: c.f }).judge.pick(input);
  const body = c.body();
  const format = (body.output_config as { format?: { schema?: Record<string, unknown> } } | undefined)?.format;
  return { system: String(body.system), user: userText(body), ...(format?.schema ? { schema: format.schema } : {}) };
}

export async function adviceRequest(input: AdviceInput): Promise<Request> {
  const c = capture(stub([{ type: "tool_use", id: "toolu_capture", name: "report_advice", input: { items: [] } }]));
  await anthropicAi({ apiKey: "capture-only", fetch: c.f }).advisor.advise(input);
  const body = c.body();
  const tools = (body.tools ?? []) as { name?: string; type?: string; description?: string; input_schema?: Record<string, unknown>; max_uses?: number }[];
  const report = tools.find((t) => t.name === "report_advice");
  const search = tools.find((t) => t.type?.startsWith("web_search"));
  if (!report?.input_schema) throw new Error("the production advisor has no report_advice tool");
  return {
    system: String(body.system),
    user: userText(body),
    report: { name: report.name!, description: report.description ?? "", input_schema: report.input_schema },
    ...(search?.max_uses ? { maxSearches: search.max_uses } : {}),
  };
}
