// The scratch bench: will he play? A DRAFT of a feature that is not built. Today a starter is
// replaced only when ESPN shows him OUT (or IR, suspended, a bye, projected 0). The owner's line
// for acting before ESPN does (Nov 6): "a confirmed out, or a wild confidence score that a player
// will in fact be out." This asks each model, at each moment of a real game day, how sure it is
// that the player will not play, from the designations and the news published by then, and
// scores that against what happened. The prompt below is the bench's own: when the feature is
// built, the bench should capture its real request instead, as it does for the Judge.

import type { ScratchCase } from "./types.ts";

export const SCRATCH_SYSTEM = [
  "You are RosterBots' game-day scratch judge for one NFL player in a fantasy lineup.",
  "From the official designations and the news given, each with the time it was published, give your probability that he will not play a single snap in this game.",
  "If you are sure enough, RosterBots replaces him in the lineup before ESPN shows him out. A player replaced on your word who then plays costs the user his points, so keep high numbers for a confirmed report that he is out, from the team, the official inactive list or a trusted insider.",
  "Judge only from what is given, as of now. Answer in the JSON schema only.",
].join(" ");

export const SCRATCH_SCHEMA = {
  type: "object",
  properties: {
    out: { type: "number", description: "Your probability, from 0 to 1, that he does not play in this game." },
    reason: { type: "string", description: "One sentence: the news that decides it." },
  },
  required: ["out", "reason"],
  additionalProperties: false,
} as const;

const MIN = 60_000;

/** What the model is shown at one moment. */
export interface ScratchInput {
  player: string;
  position: string;
  team: string;
  opponent: string;
  kickoff: string;
  now: string;
  minutesToKickoff: number;
  injuryReport: string;
  inactiveList: string;
  /** Oldest first, only what was published by `now`. */
  news: { at: string; source: string; text: string }[];
}

/**
 * When to ask: T-100 (when the app starts on a questionable starter), then a minute after each
 * item published later. Nothing earlier: the app cannot act before T-90, and earlier news is
 * already in front of the model at T-100.
 */
export function asksFor(c: ScratchCase): string[] {
  if (c.asks?.length) return [...c.asks].sort();
  const k = Date.parse(c.kickoff);
  const from = k - 100 * MIN;
  const times = new Set<number>([from]);
  for (const n of c.news) if (n.at) times.add(Date.parse(n.at) + MIN);
  if (c.inactiveList) times.add(Date.parse(c.inactiveList.at) + MIN);
  return [...times].filter((t) => t >= from && t < k).sort((a, b) => a - b).map((t) => new Date(t).toISOString());
}

/** Real names to stand-ins: the player's full, first and last name, his team and the opponent, plus the case's own. */
export function hiddenNames(c: ScratchCase): [string, string][] {
  const [first, ...rest] = c.player.name.split(" ");
  const last = rest.join(" ");
  const pairs: [string, string][] = [
    ...Object.entries(c.aliases ?? {}),
    [c.player.name, "Player A"],
    ...(last.length > 2 ? [[last, "Player A"] as [string, string]] : []),
    ...(first && first.length > 2 ? [[first, "Player A"] as [string, string]] : []),
    [c.player.team, "Team A"],
    [c.opponent, "Team B"],
  ];
  // Longest first, so "Rome Odunze" goes before "Odunze".
  return pairs.sort((a, b) => b[0].length - a[0].length);
}

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Whole words only: "Brown" must not eat "Browns", nor "NE" the middle of a word. */
const hide = (s: string, pairs: [string, string][]): string =>
  pairs.reduce((t, [real, alias]) => t.replace(new RegExp(`(?<![\\w'])${escape(real)}(?![\\w])`, "g"), alias), s);

export function scratchInput(c: ScratchCase, at: string, hidden: boolean): ScratchInput {
  const now = Date.parse(at);
  const listed = c.inactiveList && Date.parse(c.inactiveList.at) <= now ? c.inactiveList.result : "not posted yet";
  const input: ScratchInput = {
    player: c.player.name,
    position: c.player.position,
    team: c.player.team,
    opponent: c.opponent,
    kickoff: c.kickoff,
    now: new Date(now).toISOString(),
    minutesToKickoff: Math.round((Date.parse(c.kickoff) - now) / MIN),
    injuryReport: c.designation ?? "unknown",
    inactiveList: listed,
    news: c.news
      .filter((n): n is typeof n & { at: string } => n.at !== null && Date.parse(n.at) <= now)
      .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
      .map((n) => ({ at: n.at, source: n.source, text: n.words })),
  };
  if (!hidden) return input;
  const pairs = hiddenNames(c);
  return {
    ...input,
    player: "Player A",
    team: "Team A",
    opponent: "Team B",
    news: input.news.map((n) => ({ ...n, text: hide(n.text, pairs), source: hide(n.source, pairs) })),
  };
}

/** The model's answer, or undefined when it is not one. */
export function parseScratch(v: unknown): { out: number; reason: string } | undefined {
  if (!v || typeof v !== "object") return undefined;
  const { out, reason } = v as { out?: unknown; reason?: unknown };
  if (typeof out !== "number" || !Number.isFinite(out)) return undefined;
  return { out: Math.min(1, Math.max(0, out)), reason: typeof reason === "string" ? reason : "" };
}
