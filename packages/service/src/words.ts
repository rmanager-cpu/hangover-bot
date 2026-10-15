// Everything a person reads: push titles, activity bodies, receipts. The handoff's
// product voice, calm and specific: "Achane was ruled OUT. Moved Jaylen Wright from
// bench to RB. Achane is on your bench." Times are US Eastern, the way kickoffs are
// given, and say so: the owner is on Pacific time.

import { BENCH, IR, NOBODY_ELIGIBLE, isStarting, type Candidate, type Finding, type Move, type Player, type Roster, type Slot, type Step } from "@rosterbots/core";
import type { ActionStatus, ActivityType } from "./types.ts";

export interface Notice {
  type: ActivityType;
  title: string;
  body: string;
}

/** Finds a player by id in the reads at hand, for names in a receipt. */
export type Lookup = (playerId: string) => Player | undefined;

export function playersIn(...rosters: (Roster | undefined)[]): Lookup {
  const by = new Map<string, Player>();
  for (const r of rosters) for (const e of r?.entries ?? []) if (!by.has(e.player.id)) by.set(e.player.id, e.player);
  return (id) => by.get(id);
}

// ---- time

const EASTERN = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  weekday: "long",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

function eastern(at: Date) {
  const parts = EASTERN.formatToParts(at);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return {
    day: part("year") + "-" + part("month") + "-" + part("day"),
    weekday: part("weekday"),
    // Assembled from parts because recent ICU puts a narrow no-break space before PM.
    time: part("hour") + ":" + part("minute") + " " + part("dayPeriod"),
  };
}

/** "2:14 PM ET" today in the East, "Sunday 1:00 PM ET" any other day. */
export function clock(at: Date | string, now: Date): string {
  const a = eastern(new Date(at));
  return (a.day === eastern(now).day ? "" : a.weekday + " ") + a.time + " ET";
}

// ---- names and slots

const SUFFIXES = ["Jr.", "Jr", "Sr.", "Sr", "II", "III", "IV", "V"];
const PARTICLES = ["St.", "St", "Van", "Von", "Vander", "De", "Del", "Da", "Di", "Le", "La"];

/** "De'Von Achane" is "Achane", "Amon-Ra St. Brown" is "St. Brown". A D/ST keeps its whole name. */
export function shortName(name: string): string {
  const words = name.split(" ").filter(Boolean);
  if (words.length < 2 || name.includes("D/ST")) return name;
  while (words.length > 2 && SUFFIXES.includes(words[words.length - 1]!)) words.pop();
  const last = words[words.length - 1]!;
  const before = words[words.length - 2]!;
  return words.length > 2 && PARTICLES.includes(before) ? before + " " + last : last;
}

export function slotName(slot: Slot | string): string {
  if (slot === BENCH) return "bench";
  if (slot === "DST") return "D/ST";
  return slot;
}

function where(slot: Slot | undefined): string {
  if (slot === undefined) return "off your roster";
  if (slot === BENCH) return "on your bench";
  if (slot === IR) return "on IR";
  return "at " + slotName(slot);
}

/** "A", "A and B", "A, B and C". */
export function list(items: string[]): string {
  if (items.length < 2) return items.join("");
  return items.slice(0, -1).join(", ") + " and " + items[items.length - 1];
}

// ---- findings

/** The action's `reason`: "Achane was ruled OUT". */
export function problemOf(f: Finding): string {
  const who = f.starter ? shortName(f.starter.name) : "";
  switch (f.kind) {
    case "empty_slot":
      return `Nobody is starting at ${slotName(f.slot)}`;
    case "starter_on_bye":
      return `${who} is on bye this week`;
    case "starter_out":
      if (f.starter?.status === "ir") return `${who} is on IR`;
      if (f.starter?.status === "suspended") return `${who} is suspended`;
      return `${who} was ruled OUT`;
    case "starter_zero":
      return `ESPN projects ${who} for zero points`;
    case "starter_doubtful":
      return `${who} is doubtful`;
    case "starter_questionable":
      return `${who} is questionable`;
    case "starter_status_unknown":
      return `${who}'s injury status could not be read`;
  }
}

/** Where a candidate's move puts a player: the hole, or the slot a shifted starter vacated. */
const lands = (c: Candidate, f: Finding, id: string): Slot => c.moves.find((m) => m.playerId === id)?.to ?? f.slot;

/** "Start Jaylen Wright at RB", or with shifts, "Start Rashid Shaheed at FLEX and move Kenneth Walker III to RB". */
function startText(f: Finding, c: Candidate): string {
  const start = `Start ${c.player.name} at ${slotName(lands(c, f, c.player.id))}`;
  return c.via?.length ? `${start} and move ${list(c.via.map((p) => `${p.name} to ${slotName(lands(c, f, p.id))}`))}` : start;
}

/** The action's `summary`: "Start Jaylen Wright at RB instead of De'Von Achane". */
export function changeOf(f: Finding, c: Candidate): string {
  const start = startText(f, c);
  return f.starter ? `${start} instead of ${f.starter.name}` : start;
}

// The held reasons the service adds on top of core.guard's own. The first four are about
// one finding; the last three hold every automatic move on the connection.
export const HELD_DECLINED = "declined earlier";
export const HELD_TRIED = "already tried automatically";
export const HELD_APPROVED = "already changed with the user's approval";
export const HELD_FAILED = "an earlier change for this failed";
export const HELD_FAILED_NOW = "a change failed this check";
export const HELD_FAILED_WEEK = "a change failed this week";
export const HELD_UNPROVEN = "ESPN changes not proven yet";
export const HELD_JUDGMENT = "now a judgment call";

/** Why a move that could have been automatic is waiting for a tap. */
export function heldText(held: { reason: string; autoAt?: string }, now: Date): string {
  if (held.autoAt) return `I'll do it automatically at ${clock(held.autoAt, now)} if you don't decide first.`;
  switch (held.reason) {
    case "too close to kickoff for an automatic move":
      return "It's too close to kickoff for me to do it on my own.";
    case "daily limit":
      return "I've already made today's limit of automatic moves.";
    case "ESPN data looked incomplete":
      return "Something in ESPN's data looked off, so I won't do it on my own.";
    case "kickoff unknown":
      return "I couldn't read the kickoff time, so I won't do it on my own.";
    case HELD_DECLINED:
      return "You turned down a change here earlier, so I won't do it on my own.";
    case HELD_TRIED:
      return "I already made an automatic move for this, so this one is yours to approve.";
    case HELD_APPROVED:
      return "You approved a change for this earlier, so I won't change it again on my own.";
    case HELD_FAILED:
      return "An earlier change here didn't go through, so this one is yours to approve.";
    case HELD_FAILED_NOW:
      return "A lineup change just didn't go through on ESPN, so for the rest of the week I'll ask before every move.";
    case HELD_FAILED_WEEK:
      return "A lineup change didn't go through on ESPN earlier this week, so for the rest of the week I'll ask before every move.";
    case HELD_JUDGMENT:
      return "Something about this option has changed since I said I'd do it, so I won't do it on my own. It's your call.";
    case HELD_UNPROVEN:
      return "I haven't yet seen a change from RosterBots go through on ESPN in this league. Do the test swap on the What we read from ESPN screen, or approve this one, and then I can make moves like this on my own.";
    default:
      return "I won't do this one on my own.";
  }
}

export function proposal(f: Finding, c: Candidate, held: { reason: string; autoAt?: string } | undefined, now: Date, aside?: string): Notice {
  // With a shift, "instead" would read as attaching to the shifted starter: say who sits.
  const ask = c.via?.length ? `${changeOf(f, c)}?` : `${startText(f, c)}${f.starter ? " instead" : ""}?`;
  const why = held ? heldText(held, now) : aside;
  return { type: "ACTION_RECOMMENDED", title: problemOf(f), body: [ask, "Tap to approve.", why].filter(Boolean).join(" ") };
}

/** notify, wait and ask_user: things to know, nothing to approve. */
export function inform(step: Extract<Step, { do: "notify" | "wait" | "ask_user" }>, now: Date): Notice {
  const f = step.finding;
  const title = problemOf(f);
  const slot = slotName(f.slot);
  const kick = f.starter?.game?.kickoff;
  const by = f.deadline ?? kick;
  const before = by ? ` before ${clock(by, now)}` : "";
  // A shift option names where the bench player lands, since it is not the hole: "J.K.
  // Dobbins at FLEX (Nabers moves to WR)", under "Ways to fill WR".
  const names = (cs: Candidate[]) =>
    list(
      cs.map((c) =>
        c.via?.length
          ? `${c.player.name} at ${slotName(lands(c, f, c.player.id))} (${list(c.via.map((p) => `${shortName(p.name)} moves to ${slotName(lands(c, f, p.id))}`))})`
          : c.player.name,
      ),
    );
  const intro = (cs: Candidate[]) => (cs.some((c) => c.via?.length) ? `Ways to fill ${slot}` : `Bench options at ${slot}`);

  if (step.do === "wait") {
    const plays = kick ? `He plays at ${clock(kick, now)}. ` : "";
    return { type: "PREGAME_WARNING", title, body: `${plays}News can change until inactives, so I'll look again at ${clock(step.until, now)}.` };
  }
  if (step.do === "ask_user") {
    const lead = f.hard ? "" : "He might play. ";
    // Hard and still a judgment: no ranking data, the best option has a doubt of his own, or
    // his kickoff could not be read, which is worth saying, since it is ESPN's gap, not his.
    const top = step.candidates[0];
    const rank = !f.hard
      ? ""
      : top && top.player.game === undefined
        ? ` I couldn't read ${shortName(top.player.name)}'s kickoff time, so I'm not sure enough to pick one for you.`
        : " I'm not sure enough to pick one for you.";
    return {
      type: "ACTION_REQUIRED",
      title,
      body: `${lead}${intro(step.candidates)}: ${names(step.candidates)}.${rank} Your call${before}: swap in the app or in ESPN.`,
    };
  }

  const r = f.resolution;
  if (r.type === "deterministic") {
    const fix = r.candidate.via?.length ? `The fix: ${changeOf(f, r.candidate)}.` : `${r.candidate.player.name} is your best bench option at ${slot}.`;
    return { type: "ACTION_REQUIRED", title, body: `${fix} You're on Alerts, so I haven't changed anything.` };
  }
  if (r.type === "judgment") {
    return {
      type: f.hard ? "ACTION_REQUIRED" : "STATUS_CHANGED",
      title,
      body: `${intro(r.candidates)}: ${names(r.candidates)}. You're on Alerts, so I haven't changed anything.`,
    };
  }
  if (f.kind === "starter_status_unknown") {
    return { type: "STATUS_CHANGED", title, body: `ESPN sent a status I don't recognize, so I'm leaving him where he is. Check him in the ESPN app${before}.` };
  }
  if (f.hard) {
    // Some can play the slot but none is set to (out, projected for zero, or already played): say that, not "nobody".
    const who = r.why === NOBODY_ELIGIBLE ? `Nobody on your bench can play ${slot}.` : `Everyone on your bench who can play ${slot} is out, projected for zero, or already playing.`;
    return { type: "ACTION_REQUIRED", title, body: `${who} Fix it in the ESPN app${before}.` };
  }
  return { type: "STATUS_CHANGED", title, body: `Nobody healthy on your bench can replace him at ${slot}, so he stays in.` };
}

// ---- receipts

/** "Moved Jaylen Wright from bench to RB. Achane is on your bench." */
export function movesText(moves: Move[], who: Lookup): string {
  const full = (id: string) => who(id)?.name ?? "a player";
  const lines = moves.filter((m) => isStarting(m.to)).map((m) => `Moved ${full(m.playerId)} from ${slotName(m.from)} to ${slotName(m.to)}.`);
  for (const m of moves) if (!isStarting(m.to)) lines.push(`${shortName(who(m.playerId)?.name ?? "A player")} is ${where(m.to)}.`);
  return lines.join(" ");
}

/** The move that puts the incoming player in: from the bench into a starting slot, else the first starting move (the test swap). */
function lead(moves: Move[]): Move | undefined {
  return moves.find((m) => m.from === BENCH && isStarting(m.to)) ?? moves.find((m) => isStarting(m.to));
}

/**
 * The line on the receipt for the change that unlocks automatic moves in a league: the
 * first one the user made through RosterBots that ESPN then showed.
 */
export const PROVED = "That's the first change from RosterBots that ESPN has shown in this league, so Bench Protection may now make moves here on its own.";

export function receipt(reason: string | null, moves: Move[], who: Lookup, now: Date, proof?: string): Notice {
  const m = lead(moves);
  const title = m ? `${who(m.playerId)?.name ?? "A player"} is in at ${slotName(m.to)}` : "Lineup updated";
  const body = [reason ? reason + "." : "", movesText(moves, who), `Done at ${clock(now, now)}.`, proof ?? ""].filter(Boolean).join(" ");
  return { type: "ACTION_COMPLETED", title, body };
}

/** A write that a fresh read did not confirm. Says what ESPN shows now, when we know. */
export function failure(reason: string | null, moves: Move[], who: Lookup, after: Roster | undefined, deadline: string | null, now: Date): Notice {
  const m = lead(moves);
  const full = (id: string) => who(id)?.name ?? "a player";
  const name = m ? full(m.playerId) : "";
  // The whole change, so a shift that did not land is not read as the shifted starter being benched.
  const shifts = moves.filter((x) => x !== m && isStarting(x.to));
  const title = m ? `Couldn't start ${name} at ${slotName(m.to)}` : "A lineup change didn't go through";
  const asked = m
    ? `I asked ESPN to start ${name} at ${slotName(m.to)}${shifts.length ? ` and move ${list(shifts.map((x) => `${full(x.playerId)} to ${slotName(x.to)}`))}` : ""}`
    : "I asked ESPN to change your lineup";
  const slotOf = (id: string) => after?.entries.find((e) => e.player.id === id)?.slot;
  const state = after
    ? `ESPN now shows ${list(moves.map((x) => `${shortName(who(x.playerId)?.name ?? "a player")} ${where(slotOf(x.playerId))}`))}.`
    : "I couldn't read your lineup back to check.";
  const fix = deadline && Date.parse(deadline) > now.getTime() ? `Fix it in the ESPN app before ${clock(deadline, now)}.` : "Check your lineup in the ESPN app.";
  const body = [reason ? reason + "." : "", `${asked}, but it didn't go through, and I won't try it again on my own.`, state, fix];
  return { type: "ACTION_FAILED", title, body: body.filter(Boolean).join(" ") };
}

export function signIn(teamName: string | null, wrongTeam: boolean): Notice {
  const team = teamName ?? "your team";
  const body = wrongTeam
    ? `The ESPN account you're signed in with doesn't manage ${team}. Sign in to ESPN again with the account that does.`
    : `ESPN signed RosterBots out, so I can't watch ${team} right now. Open the app and sign in to ESPN again.`;
  return { type: "ACTION_REQUIRED", title: "Sign in to ESPN again", body };
}

export const SIGN_IN_AGAIN = "ESPN signed RosterBots out. Sign in to ESPN again, then try once more.";

/** A proposal whose problem ESPN no longer shows. */
export const NOT_NEEDED = "This isn't needed any more: ESPN no longer shows the problem it was for. Nothing was changed.";
/** A proposal whose problem is still there but whose fix has changed. */
export const OUT_OF_DATE = "Things have changed since I suggested this, so it's out of date. Nothing was changed. I'll look again on the next check.";

/** Said once, when a pending proposal is withdrawn because ESPN no longer shows its problem. */
export function withdrawn(summary: string): Notice {
  return {
    type: "STATUS_CHANGED",
    title: "No change needed",
    body: `I've dropped "${summary}". ESPN no longer shows the problem it was for, so nothing needs changing.`,
  };
}

/** Said once a period, on the third incomplete read in a row from ESPN. */
export function incompleteRead(): Notice {
  return {
    type: "STATUS_CHANGED",
    title: "ESPN's data looks incomplete",
    body:
      "The last few reads of your team from ESPN came back incomplete, so I'm not judging your lineup by them " +
      "and won't make a move on my own until a read looks right. Check your lineup in the ESPN app for now.",
  };
}

/** Why an action can no longer be approved or declined. */
export function notPending(status: ActionStatus): string {
  switch (status) {
    case "approved":
      return "That change is already on its way to ESPN.";
    case "declined":
      return "You already turned that one down.";
    case "done":
      return "That's already done.";
    case "failed":
      return "That change was tried and didn't go through. Check your lineup in the ESPN app.";
    case "expired":
      return "That one expired at kickoff.";
    case "superseded":
      return "That suggestion was replaced by a newer one. Check Activity.";
    case "pending":
      return "That one is still waiting for you.";
  }
}
