// The AI, behind core's Judge and Advisor interfaces: Anthropic's Messages API, one model
// id in configuration (docs/AI-NATIVE.md). Server-side only: the key never reaches a
// client. What the model sees is what core's inputs carry (players, statuses, projections,
// kickoffs), never an ESPN cookie or a user's email. Errors are reported by name only.

import Anthropic from "@anthropic-ai/sdk";
import type { Advice, AdviceInput, AdviceKind, Advisor, AiChoice, Judge, JudgeInput } from "@rosterbots/core";

export const DEFAULT_MODEL = "claude-sonnet-5-5";

export interface AnthropicOptions {
  apiKey: string;
  /** The model id. Configuration, so a cheaper model is a config change. */
  model?: string;
  /** The Judge's limit: at T-15 there is no time for more than a minute. */
  judgeTimeoutMs?: number;
  /** The Advisor's limit, web searches included. */
  adviseTimeoutMs?: number;
  /** Web searches per advice run (billed per use). */
  maxSearches?: number;
  /** Injected for tests. */
  fetch?: typeof fetch;
  /** Told the error's name when a call fails; never its body. */
  onError?: (what: string) => void;
}

export interface Ai {
  judge: Judge;
  advisor: Advisor;
}

const KINDS: readonly AdviceKind[] = ["injury", "rb_backup", "bye", "construction", "fit"];
const MAX_ITEMS = 5;

/** The Judge's answer, as a JSON schema for structured output. */
export const CHOICE_SCHEMA = {
  type: "object",
  properties: {
    playerId: {
      anyOf: [{ type: "string" }, { type: "null" }],
      description: "The id of the candidate to start, exactly as listed, or null to leave the slot as it is.",
    },
    confidence: { type: "number", description: "How sure you are, from 0 to 1." },
    reason: { type: "string", description: "One sentence a fantasy player would read, naming the player and why." },
  },
  required: ["playerId", "confidence", "reason"],
  additionalProperties: false,
} as const;

const JUDGE_SYSTEM = [
  "You are RosterBots' judge for one fantasy football lineup hole: a starting slot that will score nothing at kickoff unless someone fills it.",
  "The code has already applied every safety rule. You only choose among the candidates it lists, by id, or answer null to leave the slot as it is.",
  "Judge who gives the best chance of points this week in this slot: his role on his team (a starter beats a backup), the matchup, his injury status, and his kickoff.",
  "A candidate who comes from outside the roster costs a roster spot, an IR move or a drop; he must be clearly worth it. When in doubt, prefer the bench fill the code names, or null.",
  "Never name a player who is not in the list. Answer in the JSON schema only.",
].join(" ");

/** The Advisor's one client tool: how it hands its items back, validated against this schema. */
export const REPORT_TOOL: Anthropic.Messages.Tool = {
  name: "report_advice",
  description: "Report the advice items, once, when the scan is done. An empty list means there is nothing worth saying this time.",
  strict: true,
  input_schema: {
    type: "object",
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            kind: { type: "string", enum: [...KINDS] },
            title: { type: "string", description: "One line, under 60 characters." },
            body: { type: "string", description: "Two or three sentences: what you found, and what to do." },
            sources: { type: "array", items: { type: "string" }, description: "URLs from web search, or ESPN for the data given." },
            add: { anyOf: [{ type: "string" }, { type: "null" }], description: "A free agent's id from the list to add, or null." },
            drop: { anyOf: [{ type: "string" }, { type: "null" }], description: "A rostered player's id to drop for him, or null." },
            dropOutForSeason: {
              type: "boolean",
              description: "True only when a cited source says the dropped player's season is over (a torn ACL, IR for the year) and ESPN's status has not caught up. Never for a player who will be back.",
            },
            expiresAt: { anyOf: [{ type: "string" }, { type: "null" }], description: "ISO time when this stops mattering (a kickoff, the waiver run), or null." },
          },
          required: ["kind", "title", "body", "sources", "add", "drop", "dropOutForSeason", "expiresAt"],
          additionalProperties: false,
        },
      },
    },
    required: ["items"],
    additionalProperties: false,
  },
};

const ADVISOR_SYSTEM = (searches: number) =>
  [
    "You are RosterBots' Roster Advice for one ESPN fantasy football team. Scan the roster and the free agents given, and use web search sparingly,",
    `at most ${searches} searches, for injury news, depth charts and bye weeks. Suggest at most ${MAX_ITEMS} things, each one of these kinds:`,
    "injury (a starter whose injury ESPN has not turned into a zero yet, and the fix), rb_backup (a running back who got hurt, on this team or any team,",
    "and whether his backup is a free agent worth adding now, before the waiver run), bye (next week's bye problems), construction (a position with no backup at all),",
    "fit (a free agent who fits a weak spot better than what the roster has).",
    "Rules: never suggest benching a healthy starter; an add must be a free agent from the list (not on waivers), by id exactly as given; a drop must be from the roster, by id,",
    "and prefer the ids marked droppable; never suggest dropping a starter who is playing this week, a player who will be back from injury, or a player rostered in more than",
    "65% of leagues, unless a cited source says his season is over (then set dropOutForSeason). Judge drops on the rest of the season, never on one bye week. Cite sources for anything from the web.",
    "Report once with the report_advice tool, then stop. Say nothing about the user beyond the team name.",
  ].join(" ");

const clamp = (n: number): number => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);

/** The Judge's text to a choice, or undefined when it is not one. Exported for tests. */
export function parseChoice(text: string): AiChoice | undefined {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!v || typeof v !== "object") return undefined;
  const { playerId, confidence, reason } = v as { playerId?: unknown; confidence?: unknown; reason?: unknown };
  if (playerId !== null && typeof playerId !== "string") return undefined;
  if (typeof confidence !== "number") return undefined;
  return { playerId: playerId ?? null, confidence: clamp(confidence), reason: typeof reason === "string" ? reason : "" };
}

/** The report tool's input to advice items, dropping anything malformed. Exported for tests. */
export function parseAdvice(input: unknown): Advice[] {
  const items = (input as { items?: unknown } | null)?.items;
  if (!Array.isArray(items)) return [];
  const out: Advice[] = [];
  for (const raw of items.slice(0, MAX_ITEMS)) {
    if (!raw || typeof raw !== "object") continue;
    const it = raw as Record<string, unknown>;
    const kind = KINDS.find((k) => k === it.kind);
    if (!kind || typeof it.title !== "string" || typeof it.body !== "string" || !it.title.trim() || !it.body.trim()) continue;
    const sources = Array.isArray(it.sources) ? it.sources.filter((s): s is string => typeof s === "string" && s.trim() !== "") : [];
    const add = typeof it.add === "string" && it.add.trim() ? it.add.trim() : undefined;
    const drop = typeof it.drop === "string" && it.drop.trim() ? it.drop.trim() : undefined;
    const over = drop !== undefined && it.dropOutForSeason === true;
    const expires = typeof it.expiresAt === "string" && !Number.isNaN(Date.parse(it.expiresAt)) ? new Date(it.expiresAt).toISOString() : undefined;
    out.push({
      kind,
      title: it.title.trim(),
      body: it.body.trim(),
      sources,
      ...(add || drop ? { action: { ...(add ? { add } : {}), ...(drop ? { drop } : {}), ...(over ? { outForSeason: true } : {}) } } : {}),
      ...(expires ? { expiresAt: expires } : {}),
    });
  }
  return out;
}

const errorName = (e: unknown): string => (e instanceof Anthropic.APIError ? `${e.name} ${e.status ?? ""}`.trim() : e instanceof Error ? e.name : "unknown error");

export function anthropicAi(opts: AnthropicOptions): Ai {
  const model = opts.model ?? DEFAULT_MODEL;
  const judgeTimeout = opts.judgeTimeoutMs ?? 60_000;
  const adviseTimeout = opts.adviseTimeoutMs ?? 100_000;
  const searches = opts.maxSearches ?? 6;
  const client = new Anthropic({ apiKey: opts.apiKey, maxRetries: 1, ...(opts.fetch ? { fetch: opts.fetch } : {}) });
  const report = (what: string) => opts.onError?.(what);

  const judge: Judge = {
    async pick(input: JudgeInput): Promise<AiChoice | undefined> {
      try {
        // Thinking tokens count against max_tokens, so the budget is well above the answer's size,
        // with low effort: a pick among a handful of options, inside the minute it has.
        const res = await client.messages.create(
          {
            model,
            max_tokens: 2500,
            system: JUDGE_SYSTEM,
            messages: [{ role: "user", content: JSON.stringify(input) }],
            thinking: { type: "adaptive" },
            output_config: { effort: "low", format: { type: "json_schema", schema: CHOICE_SCHEMA } },
          },
          { timeout: judgeTimeout, maxRetries: 1 },
        );
        if (res.stop_reason === "refusal" || res.stop_reason === "max_tokens") return undefined;
        const text = res.content.find((b): b is Anthropic.Messages.TextBlock => b.type === "text")?.text;
        return text === undefined ? undefined : parseChoice(text);
      } catch (e) {
        report("judge: " + errorName(e));
        return undefined;
      }
    },
  };

  const advisor: Advisor = {
    async advise(input: AdviceInput): Promise<Advice[]> {
      const signal = AbortSignal.timeout(adviseTimeout);
      const webSearch: Anthropic.Messages.WebSearchTool20260209 = { type: "web_search_20260209", name: "web_search", max_uses: searches };
      const messages: Anthropic.Messages.MessageParam[] = [{ role: "user", content: JSON.stringify(input) }];
      try {
        // Web searches run on Anthropic's side; a long run comes back as pause_turn and is
        // continued with the same conversation. Three continuations is plenty for six searches.
        for (let round = 0; round < 4; round++) {
          const res = await client.messages.create(
            {
              model,
              max_tokens: 8000,
              system: ADVISOR_SYSTEM(searches),
              messages,
              tools: [webSearch, REPORT_TOOL],
              tool_choice: { type: "auto" },
              thinking: { type: "adaptive" },
              output_config: { effort: "medium" },
            },
            { signal, timeout: adviseTimeout, maxRetries: 0 },
          );
          const reported = res.content.find((b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use" && b.name === REPORT_TOOL.name);
          if (reported) return parseAdvice(reported.input);
          if (res.stop_reason === "max_tokens") {
            report("advisor: max_tokens");
            return [];
          }
          if (res.stop_reason !== "pause_turn") return [];
          messages.push({ role: "assistant", content: res.content });
        }
        return [];
      } catch (e) {
        report("advisor: " + errorName(e));
        return [];
      }
    },
  };

  return { judge, advisor };
}
