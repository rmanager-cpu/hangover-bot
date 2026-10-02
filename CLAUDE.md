# HangoverBot (RosterBots)

The spec is `docs/HANDOFF-2026-10-02.docx` (searchable as `.txt`). `docs/DECISIONS.md` is
what has been decided since and where the code reads the handoff cautiously. Read both
before changing behaviour. `docs/ARCHITECTURE.md` is how it fits together.

The stack is fixed: read `docs/STACK.md` before adding anything. Do not bring in a
framework, database, AI provider or push service that is not listed there.

## Where it is (Oct 2 2026): Phase 0, domain spike. AI provider: Anthropic (see DECISIONS)

Built and tested (`npm test`, `npm run typecheck`, no network needed):

- `packages/core`: domain types, the rules engine, authority and the account gate.
- `packages/connectors`: the connector interface with capability flags, and ESPN
  (leagues, my team, roster, lineup write). Hand-built fixtures only.
- `packages/football-data`: NFL facts and the `GameDayFeed` seam.
- `scripts/espn-check.ts`: the end-to-end ESPN read, which writes nothing.

**Not yet proven against ESPN.** The cloud session that built this could not reach ESPN.
The first thing to do once one can: `npm run espn:check` with real cookies, then replace
the hand-built fixtures with captured ones, cookies stripped.

**Next session, first steps** (the owner is adding these to the environment):
`ESPN_SWID` and `ESPN_S2` (the Mega Cast co-manager on team #2 of league 36784699) and
network access to `fantasy.espn.com` and `fan.api.espn.com`. Then:

1. `npm install && npm test`, then `npm run espn:check -- 36784699`. It only reads.
2. Report what it printed. Capture real roster, schedule and fan-profile payloads as
   fixtures, **cookies and SWIDs stripped**.
3. Only with the owner's explicit go-ahead: one harmless lineup write (e.g. swap a WR and
   the FLEX when no games are locked), verified by a fresh read, then swap it back.

**Pending owner decisions** (see the end of the Oct 2 session; record answers in
`docs/DECISIONS.md`): the autonomy line ("automatic only for the user's own rules: their
replacement order and game-day plans they approved; AI recommends everything else, including
questionable-player strategy, adds, drops and IR"), the kickoff-check cutoffs, and whether
"live" means using it in the owner's own league this season (recommended) or a public launch
this season. Do not change AI Rescue's execution behaviour until the autonomy line is confirmed.

Not started: `packages/ai`, `packages/ui`, all of `apps/`, Supabase schema. Phase 1 next.

## Rules

- **ESPN only at launch.** Other providers are "coming soon" entries, not code.
- **No unattended write for an anonymous account.** Enforced in `core`, not the UI.
- **The rules engine decides; AI only picks from the candidates core gives it.**
- **A write is not a success until a fresh read shows it.**
- **Never log a request to ESPN.** It carries the user's cookies.
- **Team ids are not 1..N, and a negative player id is real** (every D/ST).
- An ESPN status we have not mapped is `unknown`, and `unknown` never moves a player.
- Runs on Node 22.18+ with native TypeScript type stripping: import with `.ts`
  extensions, and no enums, namespaces or parameter properties (`erasableSyntaxOnly`).
