// The shared research bench (owner, Nov 7: one agent "that does all the research leading up to
// waiver wire day... that's the data each rosterbot goes off"). Every model gets the same job,
// the owner's own question, "Tell me what I need to know about week N", for every player a
// RosterBots team rosters or could add, and hands back a brief: each fact tagged by its
// evidence, with its sources. Nothing like it is built in the app; this bench is for choosing
// the model before it is.
//
// Code checks every fact the way the app would have to before acting on it:
//  - the player id is one we sent, and the words name him (core's checkAdviceMove, the check
//    Roster Advice runs on every move);
//  - "confirmed" is backed (owner, Nov 8): the team's or the league's page, a national news
//    organization's ("ESPN, a Disney company of legitimate journalists"), or two different sites;
//  - every fact but a bye cites a page;
//  - a bye matches ESPN's schedule.
// Coverage is counted too: the injured players the brief covered, and the week's byes it got.
// Whether the facts are true and matter is for a human.

import { checkAdviceMove, type AdviceInput, type AdvicePlayer, type Status } from "@rosterbots/core";
import { statusOf } from "@rosterbots/connectors";
import { cut, host, runLine, toolLines } from "./detail.ts";
import type { Brief, Fact, FactKind, FactTier, ResearchCase, ResearchRecord, ResearchTarget, SourceKind } from "./types.ts";

const KINDS: readonly FactKind[] = ["injury", "return", "role", "trade", "release", "suspension", "bye", "pickup", "other"];
const TIERS: readonly FactTier[] = ["confirmed", "reported", "speculation"];
const SOURCE_KINDS: readonly SourceKind[] = ["team", "national_insider", "beat_reporter", "outlet", "fantasy_site", "other"];

export const RESEARCH_SYSTEM = (week: number): string =>
  [
    `You are RosterBots' shared research for week ${week} of the NFL fantasy football season.`,
    "Your brief is the only news every RosterBots team's bots will read this week: WaiverBot, which makes Tuesday's waiver claims and adds, and GameDayBot, which fixes lineups before kickoff.",
    "They act on it for many users at once, so a wrong fact is wrong in every league that has the player.",
    "Cover the players listed (ESPN's ids, names, teams and statuses as of now), and anyone else a fantasy manager needs to know about this week: a new starter, a backup taking over, a player coming back.",
    "Research: injuries (the status, the timeline, practice reports), returns from IR, role and depth-chart changes (who starts, snap and target share, a backfield split), trades, releases and suspensions, this week's byes, and free agents worth adding before waivers run.",
    "Label every fact by its evidence.",
    "confirmed: a fact from the team or the league (an announcement, the official injury or practice report, a transaction), from a national news organization (ESPN, the AP, NFL Network, CBS, NBC, Fox, Yahoo, The Athletic and their reporters), or the same fact on two or more fantasy sites. Cite every page it is on.",
    "reported: a fact only one fantasy site, local outlet or other source has.",
    "speculation: takes, not facts: rankings, start-or-sit calls, who to add, projections, predictions, and your own reading of events, from any site, ESPN's included. A take belongs in the brief only when several sites share it; say so. One analyst's take is never enough to act on.",
    "A player is out for the season when the team says so or it is confirmed as above; an injury that usually ends seasons is only reported until then.",
    "Each fact names one player by the id given (null for a player not listed, or a fact about a whole team), says what changed and what it means for fantasy in one or two sentences, names who said it, and cites the pages it came from.",
    "Say nothing ESPN's status already shows unless there is news beyond it. No fact without a source. No filler: a player with no news gets no fact.",
    `Then the summary: what a fantasy manager needs to know about week ${week}, most important first, at most 10 lines.`,
    "Report once with report_brief, then stop.",
  ].join(" ");

/** The brief's one tool, strict: how the research hands its facts back. */
export const BRIEF_TOOL = {
  name: "report_brief",
  description: "Report the week's brief, once, when the research is done.",
  input_schema: {
    type: "object",
    properties: {
      summary: { type: "array", items: { type: "string" }, description: "What a fantasy manager needs to know this week, most important first, at most 10 lines." },
      facts: {
        type: "array",
        items: {
          type: "object",
          properties: {
            playerId: { anyOf: [{ type: "string" }, { type: "null" }], description: "The player's id exactly as listed, or null for a player not listed or a whole team." },
            player: { type: "string", description: "The player's full name, or the team's for a team fact." },
            team: { type: "string", description: "The NFL team's abbreviation." },
            kind: { type: "string", enum: [...KINDS] },
            tier: { type: "string", enum: [...TIERS], description: "confirmed: the team or league, a national news organization, or two or more fantasy sites. reported: one other source. speculation: a take, not a fact." },
            sourceKind: { type: "string", enum: [...SOURCE_KINDS], description: "Who said it: the team itself, a national insider, a beat reporter, a news outlet, a fantasy site, or other." },
            claim: { type: "string", description: "What changed and what it means for fantasy, in one or two sentences." },
            sources: { type: "array", items: { type: "string" }, description: "The URLs it came from." },
            asOf: { anyOf: [{ type: "string" }, { type: "null" }], description: "When the source published it, ISO, or null when it doesn't say." },
          },
          required: ["playerId", "player", "team", "kind", "tier", "sourceKind", "claim", "sources", "asOf"],
          additionalProperties: false,
        },
      },
    },
    required: ["summary", "facts"],
    additionalProperties: false,
  },
};

/** The message every model gets: the owner's question, and everyone it covers. */
export function researchUser(c: ResearchCase, now: string): string {
  return JSON.stringify({
    question: c.question,
    season: c.season,
    week: c.week,
    now,
    statusesReadAt: c.builtAt,
    players: c.targets.map((t) => ({
      id: t.id,
      name: t.name,
      position: t.position,
      team: t.proTeam,
      espnStatus: t.status,
      ...(t.percentRostered !== undefined ? { percentRostered: Math.round(t.percentRostered) } : {}),
      ...(t.byeWeek !== undefined ? { byeWeek: t.byeWeek } : {}),
      ...(t.projection !== undefined ? { projection: Math.round(t.projection * 10) / 10 } : {}),
      on: t.on,
    })),
  });
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);
/** "Speculation", "beat reporter", "national-insider": the label meant, whatever the case or spacing. */
const label = <T extends string>(list: readonly T[], v: unknown): T | undefined => {
  const s = typeof v === "string" ? v.trim().toLowerCase().replace(/[\s-]+/g, "_") : undefined;
  return list.find((k) => k === s);
};

/** The report tool's input to a brief, keeping what is well formed. Undefined when it is no brief at all. */
export function parseBrief(input: unknown): Brief | undefined {
  if (!input || typeof input !== "object") return undefined;
  const { summary, facts } = input as { summary?: unknown; facts?: unknown };
  if (!Array.isArray(summary) && !Array.isArray(facts)) return undefined;
  const out: Brief = { summary: Array.isArray(summary) ? summary.map(str).filter((s): s is string => !!s) : [], facts: [], malformed: 0 };
  for (const raw of Array.isArray(facts) ? facts : []) {
    const f = (raw ?? {}) as Record<string, unknown>;
    const kind = label(KINDS, f.kind);
    const tier = label(TIERS, f.tier);
    const sourceKind = label(SOURCE_KINDS, f.sourceKind) ?? "other";
    const player = str(f.player);
    const claim = str(f.claim);
    if (!kind || !tier || !player || !claim) {
      out.malformed++;
      continue;
    }
    const asOf = str(f.asOf);
    out.facts.push({
      playerId: str(f.playerId) ?? null,
      player,
      team: str(f.team) ?? "",
      kind,
      tier,
      sourceKind,
      claim,
      sources: Array.isArray(f.sources) ? f.sources.map(str).filter((s): s is string => !!s) : [],
      ...(asOf ? { asOf } : {}),
    });
  }
  return out;
}

/**
 * Whether a report can stand as the brief, or should be put into the brief's form by a second
 * call. Nov 7 rehearsal: with OpenRouter's server tools the schema isn't enforced, and GLM and
 * DeepSeek sent a good summary with every one of 91 facts in other fields.
 */
export function usableBrief(input: unknown): boolean {
  const b = parseBrief(input);
  // A week of 100-odd players with no fact at all is a report in the wrong form, not a quiet
  // week (the second rehearsal: GLM wrote ten summary lines and an empty list).
  return !!b && b.facts.length > 0 && b.malformed <= b.facts.length;
}

// ---------------------------------------------------------------- Teams, for byes

const NICKNAME: Record<string, string> = {
  ATL: "Falcons", BUF: "Bills", CHI: "Bears", CIN: "Bengals", CLE: "Browns", DAL: "Cowboys", DEN: "Broncos", DET: "Lions",
  GB: "Packers", TEN: "Titans", IND: "Colts", KC: "Chiefs", LV: "Raiders", LAR: "Rams", MIA: "Dolphins", MIN: "Vikings",
  NE: "Patriots", NO: "Saints", NYG: "Giants", NYJ: "Jets", PHI: "Eagles", ARI: "Cardinals", PIT: "Steelers", LAC: "Chargers",
  SF: "49ers", SEA: "Seahawks", TB: "Buccaneers", WSH: "Commanders", CAR: "Panthers", JAX: "Jaguars", BAL: "Ravens", HOU: "Texans",
};
/**
 * Where a team's own word is published: its site, and the league's (the official injury report
 * and transactions). A "confirmed" fact citing none of them rests on the model's label alone.
 */
const TEAM_SITES = new Set([
  "nfl.com", "atlantafalcons.com", "buffalobills.com", "chicagobears.com", "bengals.com", "clevelandbrowns.com", "dallascowboys.com",
  "denverbroncos.com", "detroitlions.com", "packers.com", "tennesseetitans.com", "colts.com", "chiefs.com", "raiders.com", "therams.com",
  "miamidolphins.com", "vikings.com", "patriots.com", "neworleanssaints.com", "giants.com", "newyorkjets.com", "philadelphiaeagles.com",
  "azcardinals.com", "steelers.com", "chargers.com", "49ers.com", "seahawks.com", "buccaneers.com", "commanders.com", "panthers.com",
  "jaguars.com", "baltimoreravens.com", "houstontexans.com",
]);
const onSite = (sites: Set<string>, url: string): boolean => {
  const h = host(url).toLowerCase();
  return [...sites].some((s) => h === s || h.endsWith(`.${s}`));
};
export const isTeamPage = (url: string): boolean => onSite(TEAM_SITES, url);

/**
 * National news organizations: their reporting confirms a fact as the team's word does (owner,
 * Nov 8: "ESPN, a Disney company of legitimate journalists"). The AP, the networks' sports
 * desks, Yahoo, The Athletic (nytimes.com), USA Today and SI are the same kind of newsroom.
 */
const NEWS_SITES = new Set(["espn.com", "apnews.com", "nytimes.com", "theathletic.com", "cbssports.com", "nbcsports.com", "foxsports.com", "yahoo.com", "usatoday.com", "si.com"]);
export const isNewsPage = (url: string): boolean => onSite(NEWS_SITES, url);

/** The site a page is on, for counting different ones: sports.mynorthwest.com is mynorthwest.com. */
const siteOf = (url: string): string => host(url).toLowerCase().split(".").slice(-2).join(".");

/**
 * Whether a "confirmed" fact's pages back the label: one from the team or the league, one from a
 * national news organization, or the same fact on two different other sites (owner, Nov 8:
 * "I'd like to see what you're calling fact pop up on more than just one fantasy site").
 */
export function backsConfirmed(sources: string[]): boolean {
  const pages = sources.filter((s) => /^https?:\/\//i.test(s));
  return pages.some((p) => isTeamPage(p) || isNewsPage(p)) || new Set(pages.map(siteOf)).size >= 2;
}

/** Other abbreviations sites use for the same teams. */
const ALIAS: Record<string, string> = { WAS: "WSH", JAC: "JAX", LA: "LAR", LVR: "LV", SFO: "SF", TAM: "TB", GNB: "GB", KAN: "KC", NWE: "NE", NOR: "NO" };

/**
 * Teams by place, the way GPT-6.1 Terra wrote the byes on Nov 8 ("Chicago, Denver, Philadelphia
 * and Tampa Bay"). New York and Los Angeles have two teams each, so they name neither.
 */
const CITY: Record<string, string> = {
  ATL: "Atlanta", BUF: "Buffalo", CHI: "Chicago", CIN: "Cincinnati", CLE: "Cleveland", DAL: "Dallas", DEN: "Denver", DET: "Detroit",
  GB: "Green Bay", TEN: "Tennessee", IND: "Indianapolis", KC: "Kansas City", LV: "Las Vegas", MIA: "Miami", MIN: "Minnesota",
  NE: "New England", NO: "New Orleans", PHI: "Philadelphia", ARI: "Arizona", PIT: "Pittsburgh", SF: "San Francisco", SEA: "Seattle",
  TB: "Tampa Bay", WSH: "Washington", CAR: "Carolina", JAX: "Jacksonville", BAL: "Baltimore", HOU: "Houston",
};

/** Every team a piece of text names, by nickname, by city, or by abbreviation in capitals. */
export function teamsIn(text: string): Set<string> {
  const out = new Set<string>();
  for (const [abbr, nick] of Object.entries(NICKNAME)) if (new RegExp(`\\b${nick}\\b`, "i").test(text)) out.add(abbr);
  for (const [abbr, city] of Object.entries(CITY)) if (new RegExp(`\\b${city}\\b`).test(text)) out.add(abbr);
  for (const word of text.match(/\b[A-Z]{2,3}\b/g) ?? []) {
    const abbr = ALIAS[word] ?? word;
    if (NICKNAME[abbr]) out.add(abbr);
  }
  return out;
}

/** Each team's bye, as ESPN's schedule gives it through the players' byeWeek. */
function byes(c: ResearchCase): Map<string, number> {
  const m = new Map<string, number>();
  for (const t of c.targets) if (t.byeWeek !== undefined && NICKNAME[t.proTeam]) m.set(t.proTeam, t.byeWeek);
  return m;
}

// ---------------------------------------------------------------- Checks

export type FactFlag = "unknown_id" | "words_not_id" | "confirmed_one_source" | "unsourced" | "wrong_bye";
const FLAGS: readonly FactFlag[] = ["unknown_id", "words_not_id", "confirmed_one_source", "unsourced", "wrong_bye"];

const INJURED: readonly Status[] = ["questionable", "doubtful", "out", "ir", "suspended"];

/** The case as core's Roster Advice input, so the words-name-the-player check is the app's own. */
function asAdviceInput(c: ResearchCase): AdviceInput {
  const p = (t: ResearchTarget): AdvicePlayer => ({ id: t.id, name: t.name, position: t.position, proTeam: t.proTeam, status: t.status });
  return {
    teamName: "",
    week: c.week,
    now: c.builtAt,
    starterSlots: [],
    droppable: [],
    roster: c.targets.filter((t) => t.on !== "free agent").map((t) => ({ ...p(t), slot: "BENCH" as const })),
    freeAgents: c.targets.filter((t) => t.on === "free agent").map(p),
  };
}

export interface FactCheck {
  fact: Fact;
  flags: FactFlag[];
}

export interface BriefCheck {
  facts: FactCheck[];
  tiers: Record<FactTier, number>;
  /** Players ESPN shows hurt or suspended, and how many of them a fact covers by id. */
  injured: number;
  injuredCovered: number;
  /** Teams on bye this week, and how many the brief names in a bye fact or a summary line. */
  byeTeams: number;
  byesNamed: number;
  /** Teams a bye fact names that ESPN doesn't have on bye. */
  wrongByes: string[];
  flags: Record<FactFlag, number>;
}

export function checkBrief(c: ResearchCase, b: Brief): BriefCheck {
  const ids = new Map(c.targets.map((t) => [t.id, t]));
  const input = asAdviceInput(c);
  const bye = byes(c);
  const onBye = new Set([...bye].filter(([, w]) => w === c.week).map(([t]) => t));
  const named = new Set<string>();
  const wrong = new Set<string>();
  // With and without a suffix: "Mike Washington" is a Raiders back, not the Commanders.
  const people = [...new Set(c.targets.filter((t) => t.position !== "DST").flatMap((t) => [t.name, t.name.replace(/\s+(Jr\.?|Sr\.?|II|III|IV)$/, "")]))].sort((a, b) => b.length - a.length);
  const withoutNames = (s: string): string => people.reduce((x, n) => x.split(n).join(" "), s);
  const facts: FactCheck[] = b.facts.map((f) => {
    const flags: FactFlag[] = [];
    const t = f.playerId ? ids.get(f.playerId) : undefined;
    if (f.playerId && !t) flags.push("unknown_id");
    if (t) {
      const action = t.on === "free agent" ? { add: t.id } : { drop: t.id };
      const problem = checkAdviceMove({ kind: "fit", title: f.player, body: f.claim, sources: [], action }, input);
      if (problem === "add_not_named" || problem === "drop_not_named") flags.push("words_not_id");
    }
    // The pages decide, not the model's word for who said it. A bye is checked against ESPN's schedule instead.
    if (f.tier === "confirmed" && f.kind !== "bye" && !backsConfirmed(f.sources)) flags.push("confirmed_one_source");
    if (f.kind !== "bye" && !f.sources.some((s) => /^https?:\/\//i.test(s))) flags.push("unsourced");
    if (f.kind === "bye") {
      // Judged against the week it's about: GLM's second rehearsal added next week's byes as a
      // planning note. Players' names come out first ("KC Concepcion" is not the Chiefs).
      const weeksIn = (s: string) => new Set([...s.matchAll(/\bweek\s*(\d{1,2})\b/gi)].map((m) => Number(m[1])));
      // The title's week if it names one ("Week 11 byes (planning note)"), else any the claim names.
      const title = weeksIn(`${f.player} ${f.team}`);
      const claim = weeksIn(f.claim);
      const about = title.size ? title : claim.size ? claim : new Set([c.week]);
      // The teams on bye are the title's when it names any: GPT-6.1 Sol's "Philadelphia Eagles"
      // fact named the Giants only as Philadelphia's last game before the bye.
      const titleTeams = teamsIn(withoutNames(`${f.team} ${f.player}`));
      const teams = titleTeams.size ? titleTeams : teamsIn(withoutNames(f.claim));
      let bad = false;
      for (const team of teams) {
        if (!bye.has(team)) continue;
        if (about.has(c.week) && onBye.has(team)) named.add(team);
        if (!about.has(bye.get(team)!)) {
          wrong.add(team);
          bad = true;
        }
      }
      if (bad) flags.push("wrong_bye");
    }
    return { fact: f, flags };
  });
  for (const line of b.summary) if (/\bbyes?\b/i.test(line)) for (const team of teamsIn(withoutNames(line))) if (onBye.has(team)) named.add(team);
  const covered = new Set(b.facts.map((f) => f.playerId).filter((id): id is string => !!id));
  const injured = c.targets.filter((t) => INJURED.includes(t.status));
  const count = <K extends string>(keys: readonly K[], pick: (x: FactCheck) => K[]): Record<K, number> => {
    const o = Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>;
    for (const x of facts) for (const k of pick(x)) o[k]++;
    return o;
  };
  return {
    facts,
    tiers: count(TIERS, (x) => [x.fact.tier]),
    injured: injured.length,
    injuredCovered: injured.filter((t) => covered.has(t.id)).length,
    byeTeams: onBye.size,
    byesNamed: named.size,
    wrongByes: [...wrong].sort(),
    flags: count(FLAGS, (x) => x.flags),
  };
}

// ---------------------------------------------------------------- Report

export interface ResearchSummary {
  model: string;
  runs: number;
  answered: number;
  avgMs: number;
  costUsd?: number;
  searches: number;
  pagesRead: number;
  facts: number;
  tiers: Record<FactTier, number>;
  injured: string;
  byes: string;
  wrongByes: number;
  flags: Record<FactFlag, number>;
  errors: Record<string, number>;
}

const searchesOf = (r: ResearchRecord): number => r.webSearches ?? r.trace?.toolCounts?.web_search ?? r.trace?.tools.filter((t) => t.tool.includes("search")).length ?? 0;
const fetchesOf = (r: ResearchRecord): number => r.webFetches ?? r.trace?.tools.filter((t) => t.tool.includes("fetch")).length ?? 0;

export function summarizeResearch(cases: ResearchCase[], records: ResearchRecord[]): ResearchSummary[] {
  const byId = new Map(cases.map((c) => [c.id, c]));
  const models = [...new Set(records.map((r) => r.model))];
  return models.map((model) => {
    const mine = records.filter((r) => r.model === model);
    const ok = mine.filter((r) => r.brief && byId.has(r.caseId));
    const checks = ok.map((r) => checkBrief(byId.get(r.caseId)!, r.brief!));
    const sum = (f: (c: BriefCheck) => number) => checks.reduce((n, c) => n + f(c), 0);
    const errors: Record<string, number> = {};
    for (const r of mine) if (r.error) errors[r.error] = (errors[r.error] ?? 0) + 1;
    const costs = mine.map((r) => r.costUsd).filter((x): x is number => x !== undefined);
    return {
      model,
      runs: mine.length,
      answered: ok.length,
      avgMs: mine.reduce((n, r) => n + r.latencyMs, 0) / Math.max(1, mine.length),
      ...(costs.length ? { costUsd: costs.reduce((a, b) => a + b, 0) } : {}),
      searches: mine.reduce((n, r) => n + searchesOf(r), 0),
      pagesRead: mine.reduce((n, r) => n + fetchesOf(r), 0),
      facts: sum((c) => c.facts.length),
      tiers: { confirmed: sum((c) => c.tiers.confirmed), reported: sum((c) => c.tiers.reported), speculation: sum((c) => c.tiers.speculation) },
      injured: checks.length ? `${sum((c) => c.injuredCovered)} of ${sum((c) => c.injured)}` : "—",
      byes: checks.length ? `${sum((c) => c.byesNamed)} of ${sum((c) => c.byeTeams)}` : "—",
      wrongByes: sum((c) => c.wrongByes.length),
      flags: Object.fromEntries(FLAGS.map((k) => [k, sum((c) => c.flags[k])])) as Record<FactFlag, number>,
      errors,
    };
  });
}

export function researchTable(rows: ResearchSummary[]): string {
  const head = "| Model | Runs | Time | Cost | Searches | Pages read | Facts | Confirmed · reported · speculation | Injured players covered | Byes named | Wrong bye | Unknown id | Words ≠ id | \"Confirmed\" on one site | No source | Failures |";
  const rule = "|" + "---|".repeat(16);
  const body = rows.map((r) =>
    [
      r.model,
      `${r.answered}/${r.runs}`,
      `${(r.avgMs / 1000).toFixed(0)} s`,
      r.costUsd === undefined ? "—" : `$${r.costUsd.toFixed(2)}`,
      r.searches,
      r.pagesRead,
      r.facts,
      `${r.tiers.confirmed} · ${r.tiers.reported} · ${r.tiers.speculation}`,
      r.injured,
      r.byes,
      r.wrongByes,
      r.flags.unknown_id,
      r.flags.words_not_id,
      r.flags.confirmed_one_source,
      r.flags.unsourced,
      Object.entries(r.errors).map(([k, v]) => `${k} ×${v}`).join(", ") || "—",
    ].join(" | "),
  );
  return [head, rule, ...body.map((l) => `| ${l} |`)].join("\n");
}

export const RESEARCH_FOOTER = [
  "Every model got the same job: the owner's question, every player on both RosterBots rosters and both free-agent lists (ESPN's statuses refreshed when the case was built), and every tool its provider offers. It hands back a brief: facts tagged by evidence, with sources, and a summary.",
  "",
  "- **Confirmed · reported · speculation**: the model's own labels. Confirmed: the team or league, a national news organization such as ESPN, or the same fact on two or more sites. Reported: one other source. Speculation: takes (owner, Nov 8).",
  "- **Injured players covered**: of the listed players ESPN shows questionable, doubtful, out, IR or suspended, how many a fact covers by id. Not every one has news; a low number is a question, not a failure.",
  "- **Byes named / Wrong bye**: this week's bye teams the brief names (in a bye fact or a summary line), and teams a bye fact names that ESPN's schedule doesn't have on bye.",
  "- **Unknown id / Words ≠ id**: a fact on an id we didn't send, or whose words name someone else (Roster Advice's own check). The app would throw the fact out.",
  "- **\"Confirmed\" on one site**: labeled confirmed, but no page cited is the team's, the league's or a national news organization's, and only one other site is cited. The app would treat it as reported.",
  "- **No source**: a fact (not a bye) with no page cited.",
  "- Speed and cost are reported, not judged: the research runs a few times a week for everyone.",
];

const FLAG_WORDS: Record<FactFlag, string> = {
  unknown_id: "unknown id",
  words_not_id: "words name someone else",
  confirmed_one_source: "\"confirmed\" on one site",
  unsourced: "no source",
  wrong_bye: "not on bye per ESPN",
};

export function researchDetails(cases: ResearchCase[], records: ResearchRecord[]): string {
  const lines: string[] = ["## Run by run", ""];
  for (const c of cases) {
    const mine = records.filter((r) => r.caseId === c.id);
    if (!mine.length) continue;
    const who = new Map(c.targets.map((t) => [t.id, t]));
    lines.push(`### Week ${c.week}, ${c.targets.length} players (\`${c.id}\`)`, "");
    for (const model of [...new Set(mine.map((r) => r.model))]) {
      for (const r of mine.filter((x) => x.model === model).sort((a, b) => a.rep - b.rep)) {
        lines.push(`#### ${model}, run ${r.rep}`, "", runLine(r), "");
        lines.push("**Tools**", "", ...toolLines(r.trace), "");
        lines.push("**Reasoning**", "");
        if (r.trace?.reasoning) lines.push(...cut(r.trace.reasoning, 1800).split("\n").map((l) => `> ${l}`));
        else lines.push(r.trace?.reasoningHidden ? "> Hidden: the provider returns this model's reasoning encrypted." : "> None shown.");
        lines.push("");
        if (r.error) lines.push(`**Failure:** ${r.error}${r.trace?.finish ? ` (stopped: ${r.trace.finish})` : ""}`, "");
        if (!r.brief) {
          lines.push("No brief.", "");
          continue;
        }
        const check = checkBrief(c, r.brief);
        lines.push("**Summary**", "", ...(r.brief.summary.length ? r.brief.summary.map((s) => `- ${s}`) : ["- None."]), "");
        lines.push(
          `**Facts** (${check.facts.length}: ${check.tiers.confirmed} confirmed, ${check.tiers.reported} reported, ${check.tiers.speculation} speculation${r.brief.malformed ? `; ${r.brief.malformed} malformed, left out` : ""}) · injured players covered ${check.injuredCovered} of ${check.injured} · byes named ${check.byesNamed} of ${check.byeTeams}${check.wrongByes.length ? ` · wrong byes: ${check.wrongByes.join(", ")}` : ""}`,
          "",
        );
        for (const tier of TIERS) {
          const these = check.facts.filter((x) => x.fact.tier === tier);
          if (!these.length) continue;
          lines.push(`*${tier[0]!.toUpperCase()}${tier.slice(1)}*`, "");
          for (const { fact: f, flags } of these) {
            const t = f.playerId ? who.get(f.playerId) : undefined;
            const espn = t ? `, ESPN: ${t.status}, ${t.on}` : "";
            const src = f.sources.length ? f.sources.slice(0, 3).map((s) => (/^https?:/i.test(s) ? `[${host(s)}](${s})` : s)).join(", ") + (f.sources.length > 3 ? ", …" : "") : "no source";
            const warn = flags.length ? ` **⚠ ${flags.map((x) => FLAG_WORDS[x]).join("; ")}**` : "";
            lines.push(`- **${f.player}** (${f.team || "?"}, ${f.kind}${espn}; ${f.sourceKind.replace("_", " ")}${f.asOf ? `, ${f.asOf.slice(0, 10)}` : ""}): ${f.claim} · ${src}${warn}`);
          }
          lines.push("");
        }
      }
    }
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------- Building a case

const ESPN_PLAYERS = (season: number) => `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${season}/segments/0/leaguedefaults/3?view=kona_player_info&scoringPeriodId=`;

interface EspnPublic {
  players?: {
    id?: number;
    player?: {
      id?: number;
      injuryStatus?: string;
      injured?: boolean;
      ownership?: { percentOwned?: number };
      stats?: { seasonId?: number; scoringPeriodId?: number; statSourceId?: number; statSplitTypeId?: number; appliedTotal?: number }[];
    };
  }[];
}

/**
 * Everyone on the live advice cases' rosters and free-agent lists, once each, with ESPN's
 * status, % rostered and the week's projection read fresh from its public player data (no
 * league, no cookies: the same numbers every ESPN league shows).
 */
export async function buildResearchCase(inputs: AdviceInput[], season: number, week: number, question: string, f: typeof fetch = fetch, now = new Date()): Promise<ResearchCase> {
  const targets = new Map<string, ResearchTarget>();
  const add = (p: AdvicePlayer, on: "roster" | "free agent") => {
    const had = targets.get(p.id);
    if (had) {
      if (had.on !== on) had.on = "both";
      return;
    }
    targets.set(p.id, {
      id: p.id,
      name: p.name,
      position: p.position,
      proTeam: p.proTeam,
      status: p.status,
      ...(p.percentRostered !== undefined ? { percentRostered: p.percentRostered } : {}),
      ...(p.byeWeek !== undefined ? { byeWeek: p.byeWeek } : {}),
      on,
    });
  };
  for (const i of inputs) {
    for (const p of i.roster) add(p, "roster");
    for (const p of i.freeAgents) add(p, "free agent");
  }
  const filter = { players: { filterIds: { value: [...targets.keys()].map(Number) }, filterStatsForTopScoringPeriodIds: { value: 2, additionalValue: [`11${season}${week}`] } } };
  const res = await f(ESPN_PLAYERS(season) + week, { headers: { "x-fantasy-filter": JSON.stringify(filter), accept: "application/json" }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`ESPN's player data answered ${res.status}`);
  const body = (await res.json()) as EspnPublic;
  let fresh = 0;
  for (const e of body.players ?? []) {
    const id = String(e.player?.id ?? e.id);
    const t = targets.get(id);
    if (!t || !e.player) continue;
    fresh++;
    t.status = statusOf(e.player.injuryStatus, e.player.injured);
    const owned = e.player.ownership?.percentOwned;
    if (typeof owned === "number") t.percentRostered = owned;
    const proj = e.player.stats?.find((s) => s.statSourceId === 1 && s.scoringPeriodId === week && s.statSplitTypeId === 1 && (s.seasonId === undefined || s.seasonId === season))?.appliedTotal;
    if (typeof proj === "number") t.projection = proj;
    else delete t.projection;
  }
  const at = now.toISOString();
  return {
    id: `${season}-w${week}-${at.slice(0, 10)}`,
    note: `Every player on the live advice cases' rosters and free-agent lists (${inputs.map((i) => i.teamName).join(", ")}), statuses read from ESPN's public player data at ${at} (${fresh} of ${targets.size} refreshed).`,
    season,
    week,
    question,
    builtAt: at,
    targets: [...targets.values()],
  };
}
