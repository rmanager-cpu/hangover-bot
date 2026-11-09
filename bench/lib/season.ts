// The injury bench: is his fantasy season over? A DRAFT of a judgment the app doesn't make yet.
// WaiverBot may drop a hurt player only when his season is over (owner, Nov 7), and the owner's
// rule for knowing it (Nov 8) is the AI's confidence, not which site said it: "Let's go by AI
// confidence... Team site is a wild benchmark to use for the truth." Each case is a real injury
// from a past season: the news as it was published, asked on the Tuesday after (waiver day),
// sometimes again later. Every model gives its probability that the player plays no more
// regular-season games through week 17, and it is scored on what happened, checked against his
// ESPN game log. With names hidden too, so a model can't just remember how the season went.

import type { SeasonCase, SeasonRecord } from "./types.ts";

const median = (xs: number[]): number | undefined => {
  if (!xs.length) return undefined;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1]! + s[m]!) / 2;
};

/** The bar for acting on the AI's word alone: the owner's "wild confidence" (Nov 6). */
export const SURE = 0.95;
/** Production's confidence floor for an automatic move. */
export const FLOOR = 0.8;

export const SEASON_SYSTEM = [
  "You are RosterBots' injury judge for one NFL player on a fantasy football roster.",
  "From the news given, each item with the time it was published, give your probability that his fantasy season is over: that he will not play another regular-season game from now through the last week of the fantasy regular season.",
  "Your probability is your confidence: 0.95 means you would expect to be wrong once in twenty such calls.",
  "If you are sure enough, RosterBots drops him to make room for a player who can help. A player dropped on your word who comes back is lost to the user for the fantasy playoffs, and a player held whose season is over wastes a roster spot.",
  "Weigh what was said and who said it: the team, the coach, national and local reporters, fantasy news sites; a diagnosis, surgery, a timeline, an IR or PUP move.",
  "Also give your best guess at the week he plays again, or null if not this fantasy season.",
  "Judge only from what is given, as of now. Answer in the JSON schema only.",
].join(" ");

export const SEASON_SCHEMA = {
  type: "object",
  properties: {
    over: { type: "number", description: "Your probability, from 0 to 1, that he plays no more regular-season games through the last fantasy week." },
    backWeek: { anyOf: [{ type: "integer" }, { type: "null" }], description: "The NFL week you expect him to play again, or null for not this fantasy season." },
    reason: { type: "string", description: "One sentence: the news that decides it." },
  },
  required: ["over", "backWeek", "reason"],
  additionalProperties: false,
} as const;

/** What the model is shown at one moment. */
export interface SeasonInput {
  player: string;
  position: string;
  team: string;
  season?: number;
  now: string;
  /** The NFL week whose games come next. */
  upcomingWeek: number;
  lastFantasyWeek: number;
  /** Fantasy weeks still to play, this one included. */
  fantasyWeeksLeft: number;
  injury: string;
  /** Oldest first, only what was published by `now`. With names hidden, `at` is how long before now. */
  news: { at: string; source: string; text: string }[];
}

/**
 * Team beat writers and team-site writers in the cases: each one names his team, so with names
 * hidden he is "a beat reporter". National insiders (Schefter, Rapoport, Pelissero, Garafolo,
 * Russini, Fowler, Jordan Schultz, Mike Silver) keep their names: who said it is part of the call.
 */
export const BEAT_WRITERS = [
  "Nick Wagoner", "David Lombardi", "Matt Maiocco", "Cameron Salerno", "John Keim", "Vic Tafur", "Scott Reynolds", "Rick Stroud",
  "Greg Auman", "Jenna Laine", "Scott Smith", "Josh Weinfuss", "Zach Jacobson", "Carter Bahns", "Rob Demovsky", "Paul Dehner",
  "Ben Baby", "Aaron Wilson", "Jordan Raanan", "Kris Rhim", "Daniel Popper", "Dave Birkett", "Demetrius Harvey", "John Oehser",
  "David Furones", "Zachary Pereles", "Tim Capurso", "Todd Archer", "Jon Machota", "Daniel Oyefusi", "Adam Grosbard", "Nate Taylor",
];

/** Real names to stand-ins: the player's full, first and last name, plus the case's own. */
export function seasonHiddenNames(c: SeasonCase): [string, string][] {
  const [first, ...rest] = c.player.name.split(" ");
  const last = rest.join(" ").replace(/\s+(Jr\.?|Sr\.?|II|III|IV)$/, "");
  const pairs: [string, string][] = [
    ...BEAT_WRITERS.map((w): [string, string] => [w, "a beat reporter"]),
    ...Object.entries(c.aliases ?? {}),
    [c.player.name, "Player A"],
    ...(last.length > 2 ? [[last, "Player A"] as [string, string]] : []),
    ...(first && first.length > 2 ? [[first, "Player A"] as [string, string]] : []),
    [c.player.team, "Team A"],
  ];
  // Longest first, so "Mark Andrews" goes before "Andrews".
  return pairs.sort((a, b) => b[0].length - a[0].length);
}

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Whole words only: "Brown" must not eat "Browns". */
export const hideIn = (s: string, pairs: [string, string][]): string =>
  pairs.reduce((t, [real, alias]) => t.replace(new RegExp(`(?<![\\w'])${escape(real)}(?![\\w])`, "g"), alias), s);

const HOUR = 3_600_000;
/** "3 days before now", "5 hours before now": a date with the year gone. */
function before(at: number, now: number): string {
  const h = Math.max(0, Math.round((now - at) / HOUR));
  if (h < 48) return `${h} hour${h === 1 ? "" : "s"} before now`;
  return `${Math.round(h / 24)} days before now`;
}

/** Dates in prose ("Sept. 15", "Nov 3, 2024", "2023"), taken out when names are hidden: with the year they name the player. */
const DATES = /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,\s*\d{4})?|\b(?:19|20)\d{2}\b/g;

export function seasonInput(c: SeasonCase, ask: { at: string; week: number }, hidden: boolean): SeasonInput {
  const now = Date.parse(ask.at);
  const news = c.news
    .filter((n): n is typeof n & { at: string } => n.at !== null && Date.parse(n.at) <= now)
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const base = {
    position: c.player.position,
    upcomingWeek: ask.week,
    lastFantasyWeek: c.lastWeek,
    fantasyWeeksLeft: Math.max(0, c.lastWeek - ask.week + 1),
  };
  if (!hidden) {
    return {
      player: c.player.name,
      team: c.player.team,
      season: c.season,
      now: new Date(now).toISOString(),
      ...base,
      injury: c.injury,
      news: news.map((n) => ({ at: n.at, source: n.source, text: n.words })),
    };
  }
  const pairs = seasonHiddenNames(c);
  const blind = (s: string) => hideIn(s, pairs).replace(DATES, "(date)");
  return {
    player: "Player A",
    team: "Team A",
    now: `the Tuesday before week ${ask.week}`,
    ...base,
    injury: blind(c.injury),
    news: news.map((n) => ({ at: before(Date.parse(n.at), now), source: blind(n.source), text: blind(n.words) })),
  };
}

/** The model's answer, or undefined when it is not one. */
export function parseSeason(v: unknown): { over: number; backWeek: number | null; reason: string } | undefined {
  if (!v || typeof v !== "object") return undefined;
  const { over, backWeek, reason } = v as { over?: unknown; backWeek?: unknown; reason?: unknown };
  if (typeof over !== "number" || !Number.isFinite(over)) return undefined;
  return {
    over: Math.min(1, Math.max(0, over)),
    backWeek: typeof backWeek === "number" && Number.isFinite(backWeek) ? Math.round(backWeek) : null,
    reason: typeof reason === "string" ? reason : "",
  };
}

/** What's wrong with a case, if anything: the checks a hand-built case must pass before it counts. */
export function seasonCaseProblems(c: SeasonCase): string[] {
  const out: string[] = [];
  if (!c.asks.length) out.push("no asks");
  const asks = c.asks.map((a) => Date.parse(a.at));
  if (asks.some((t, i) => Number.isNaN(t) || (i > 0 && t <= asks[i - 1]!))) out.push("asks are not valid times in order");
  if ((c.group === "A") !== (c.backWeek === null)) out.push(`group ${c.group} but backWeek ${c.backWeek}`);
  if (c.backWeek !== null && c.backWeek > c.lastWeek) out.push(`backWeek ${c.backWeek} is after week ${c.lastWeek}: that is group A`);
  if (c.backWeek !== null && c.asks.some((a) => a.week > c.backWeek!)) out.push("an ask comes after he was back");
  const last = Math.max(...asks);
  for (const n of c.news) {
    if (n.at !== null && Date.parse(n.at) > last) out.push(`news after the last ask: ${n.source}, ${n.at}`);
    if (!n.url) out.push(`no url: ${n.source}`);
  }
  if (!c.news.some((n) => n.at !== null && Date.parse(n.at) <= asks[0]!)) out.push("no news by the first ask");
  return out;
}

// ---------------------------------------------------------------- Scoring

export interface SeasonSummary {
  model: string;
  hidden: boolean;
  cases: number;
  overCases: number;
  backCases: number;
  /** Came back, but at some ask it was sure his season was over: the worst outcome. */
  droppedSure: number;
  droppedFloor: number;
  /** Season over, and at some ask it was sure. */
  calledSure: number;
  calledFloor: number;
  /** Mean squared error of every answer against what happened (1 over, 0 back). Lower is better. */
  brier?: number;
  /** Its last answer, on average: on players whose season was over, and on players who came back. */
  lastOver?: number;
  lastBack?: number;
  /** Weeks off on the week he came back, median, where it guessed one. */
  weekOff?: number;
  failed: number;
  costPerCase?: number;
}

const mean = (xs: number[]): number | undefined => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined);

/** One model's answers on one case in one name mode, in ask order. */
function runs(records: SeasonRecord[]): Map<string, SeasonRecord[]> {
  const by = new Map<string, SeasonRecord[]>();
  for (const r of records) {
    const k = `${r.model}\u0000${r.hidden}\u0000${r.caseId}\u0000${r.rep}`;
    by.set(k, [...(by.get(k) ?? []), r]);
  }
  for (const d of by.values()) d.sort((a, b) => Date.parse(a.asked) - Date.parse(b.asked));
  return by;
}

export function summarizeSeason(cases: SeasonCase[], records: SeasonRecord[]): SeasonSummary[] {
  const byId = new Map(cases.map((c) => [c.id, c]));
  const rows = new Map<string, { s: SeasonSummary; sq: number[]; lo: number[]; lb: number[]; off: number[]; cost: number; priced: boolean }>();
  for (const run of runs(records).values()) {
    const first = run[0]!;
    const c = byId.get(first.caseId);
    if (!c) continue;
    const key = `${first.model}\u0000${first.hidden}`;
    const row =
      rows.get(key) ??
      { s: { model: first.model, hidden: first.hidden, cases: 0, overCases: 0, backCases: 0, droppedSure: 0, droppedFloor: 0, calledSure: 0, calledFloor: 0, failed: 0 }, sq: [], lo: [], lb: [], off: [], cost: 0, priced: true };
    rows.set(key, row);
    const s = row.s;
    s.cases++;
    s.failed += run.filter((r) => r.over === undefined).length;
    for (const r of run) {
      if (r.costUsd === undefined) row.priced = false;
      else row.cost += r.costUsd;
    }
    const answered = run.filter((r): r is SeasonRecord & { over: number } => r.over !== undefined);
    const truth = c.backWeek === null ? 1 : 0;
    for (const r of answered) row.sq.push((r.over - truth) ** 2);
    const sure = answered.some((r) => r.over >= SURE);
    const floor = answered.some((r) => r.over >= FLOOR);
    const last = answered.at(-1)?.over;
    if (c.backWeek === null) {
      s.overCases++;
      if (sure) s.calledSure++;
      if (floor) s.calledFloor++;
      if (last !== undefined) row.lo.push(last);
    } else {
      s.backCases++;
      if (sure) s.droppedSure++;
      if (floor) s.droppedFloor++;
      if (last !== undefined) row.lb.push(last);
      const guess = answered.at(-1)?.backWeek;
      if (typeof guess === "number") row.off.push(Math.abs(guess - c.backWeek));
    }
  }
  return [...rows.values()].map(({ s, sq, lo, lb, off, cost, priced }) => {
    const b = mean(sq);
    const o = mean(lo);
    const k = mean(lb);
    const w = median(off);
    return {
      ...s,
      ...(b !== undefined ? { brier: b } : {}),
      ...(o !== undefined ? { lastOver: o } : {}),
      ...(k !== undefined ? { lastBack: k } : {}),
      ...(w !== undefined ? { weekOff: w } : {}),
      ...(priced && s.cases ? { costPerCase: cost / s.cases } : {}),
    };
  });
}

const two = (x?: number): string => (x === undefined ? "—" : x.toFixed(2));
const usd = (x?: number): string => (x === undefined ? "—" : x < 0.01 ? `$${x.toFixed(4)}` : `$${x.toFixed(3)}`);

export function seasonTable(rows: SeasonSummary[]): string {
  const sorted = [...rows].sort(
    (a, b) =>
      a.droppedSure - b.droppedSure ||
      b.calledSure - a.calledSure ||
      (a.brier ?? 9) - (b.brier ?? 9) ||
      Number(a.hidden) - Number(b.hidden),
  );
  const head = `| Model | Names | Came back, but it was sure he was done (${SURE} / ${FLOOR}) | Season over, and it was sure (${SURE} / ${FLOOR}) | Brier (lower is better) | Last P(over): over / came back | Weeks off on his return | Failed calls | Cost / case |`;
  const rule = "|" + "---|".repeat(9);
  const body = sorted.map(
    (s) =>
      `| ${s.model} | ${s.hidden ? "hidden" : "real"} | ${s.droppedSure} / ${s.droppedFloor} of ${s.backCases} | ${s.calledSure} / ${s.calledFloor} of ${s.overCases} | ${s.brier === undefined ? "—" : s.brier.toFixed(3)} | ${two(s.lastOver)} / ${two(s.lastBack)} | ${s.weekOff === undefined ? "—" : s.weekOff} | ${s.failed} | ${usd(s.costPerCase)} |`,
  );
  return [head, rule, ...body].join("\n");
}

/** Every answer across every model, by how sure it was, and how often the season really was over. */
export function calibrationTable(cases: SeasonCase[], records: SeasonRecord[], hidden: boolean): string {
  const byId = new Map(cases.map((c) => [c.id, c]));
  const bins: [number, number, string][] = [
    [SURE, 1.0001, `${SURE} and up`],
    [FLOOR, SURE, `${FLOOR} to ${SURE}`],
    [0.5, FLOOR, `0.5 to ${FLOOR}`],
    [0.2, 0.5, "0.2 to 0.5"],
    [0, 0.2, "under 0.2"],
  ];
  const mine = records.filter((r) => r.hidden === hidden && r.over !== undefined && byId.has(r.caseId));
  const head = "| Its probability the season was over | Answers | Season really was over |";
  const rule = "|---|---|---|";
  const body = bins.map(([lo, hi, label]) => {
    const these = mine.filter((r) => r.over! >= lo && r.over! < hi);
    const over = these.filter((r) => byId.get(r.caseId)!.backWeek === null).length;
    return `| ${label} | ${these.length} | ${these.length ? `${Math.round((100 * over) / these.length)}%` : "—"} |`;
  });
  return [head, rule, ...body].join("\n");
}

/** Case by case: each model's last probability, real names · hidden. */
export function seasonCaseTable(cases: SeasonCase[], records: SeasonRecord[]): string {
  const models = [...new Set(records.map((r) => r.model))];
  const all = [...runs(records).values()];
  const cell = (c: SeasonCase, model: string, hidden: boolean): string => {
    const run = all.find((d) => d[0]!.caseId === c.id && d[0]!.model === model && d[0]!.hidden === hidden);
    const last = run?.filter((r) => r.over !== undefined).at(-1)?.over;
    if (last === undefined) return "—";
    const wrong = c.backWeek === null ? last < FLOOR : last >= SURE;
    return wrong ? `**${last.toFixed(2)}**` : last.toFixed(2);
  };
  const head = `| Case | What happened | ${models.join(" | ")} |`;
  const rule = "|" + "---|".repeat(models.length + 2);
  const body = cases
    .filter((c) => records.some((r) => r.caseId === c.id))
    .map((c) => `| ${c.id} | ${c.backWeek === null ? "**season over**" : `back week ${c.backWeek}`} | ${models.map((m) => `${cell(c, m, false)} · ${cell(c, m, true)}`).join(" | ")} |`);
  return [head, rule, ...body].join("\n");
}

export const SEASON_FOOTER = [
  "Each case is a real injury from a past season, asked on the Tuesday after it (waiver day) and sometimes once more later, from the news as it was published by then. Every model gives its probability that the player plays no more regular-season games through week 17, the end of the fantasy regular season. What happened comes from his ESPN game log.",
  "",
  `- **Came back, but it was sure he was done**: at some ask it reached ${SURE} (the owner's \"wild confidence\") or ${FLOOR} (today's floor for an automatic move), and he played again by week 17. RosterBots would have dropped a player who came back. The number that matters most.`,
  `- **Season over, and it was sure**: he didn't play again, and at some ask it reached the bar. RosterBots would have freed the spot.`,
  "- **Brier**: the mean squared error of every answer against what happened. 0 is perfect; always answering 0.5 scores 0.25.",
  "- **Names**: real, or hidden behind Player A / Team A with dates shown only as time before now, so the model can't remember the season. A gap between the two is memory, not judgment.",
  "- **Bold** in the case table: a last answer that would have done harm (sure he was done when he came back) or missed (under the floor when his season was over).",
];

// ---------------------------------------------------------------- Outcomes from ESPN

interface EspnGameLog {
  filters?: unknown[];
  events?: Record<string, { week?: number; gameDate?: string }>;
  seasonTypes?: { displayName?: string; categories?: { events?: { eventId: string }[] }[] }[];
}

/**
 * The first regular-season week he played after the first ask, by his ESPN game log (no login,
 * no cookie), or null if none by lastWeek. Undefined when the log can't be read.
 */
export async function espnBackWeek(c: SeasonCase, f: typeof fetch = fetch): Promise<number | null | undefined> {
  if (!c.player.espnId) return undefined;
  const res = await f(`https://site.web.api.espn.com/apis/common/v3/sports/football/nfl/athletes/${c.player.espnId}/gamelog?season=${c.season}`);
  if (!res.ok) return undefined;
  const log = (await res.json()) as EspnGameLog;
  const regular = (log.seasonTypes ?? []).filter((s) => /regular/i.test(s.displayName ?? ""));
  // A log with no games at all is a player who never played that season: ESPN sends only its
  // filters (Joe Mixon and Brandon Aiyuk, 2025). A log with games but none regular is unreadable.
  if (!regular.length) return !log.seasonTypes?.length && Array.isArray(log.filters) ? null : undefined;
  const from = Date.parse(c.asks[0]!.at);
  const weeks = regular
    .flatMap((s) => s.categories ?? [])
    .flatMap((cat) => cat.events ?? [])
    .map((e) => log.events?.[e.eventId])
    .filter((e): e is { week: number; gameDate: string } => typeof e?.week === "number" && typeof e.gameDate === "string")
    .filter((e) => Date.parse(e.gameDate) > from && e.week <= c.lastWeek)
    .map((e) => e.week);
  return weeks.length ? Math.min(...weeks) : null;
}
