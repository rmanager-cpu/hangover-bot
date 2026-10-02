# HangoverBot (RosterBots)

The spec is `docs/HANDOFF-2026-10-02.docx` (searchable as `.txt`). `docs/DECISIONS.md` is
what has been decided since and where the code reads the handoff cautiously. Read both
before changing behaviour. `docs/ARCHITECTURE.md` is how it fits together.

The stack is fixed: read `docs/STACK.md` before adding anything. Do not bring in a
framework, database, AI provider or push service that is not listed there.

## Where it is (Oct 2 2026): Phase 0, domain spike

Built and tested (`npm test`, `npm run typecheck`, no network needed):

- `packages/core`: domain types, the rules engine, authority and the account gate.
- `packages/connectors`: the connector interface with capability flags, and ESPN
  (leagues, my team, roster, lineup write). Hand-built fixtures only.
- `packages/football-data`: NFL facts and the `GameDayFeed` seam.
- `scripts/espn-check.ts`: the end-to-end ESPN read, which writes nothing.

**Not yet proven against ESPN.** The cloud session that built this could not reach ESPN.
The first thing to do once one can: `npm run espn:check` with real cookies, then replace
the hand-built fixtures with captured ones, cookies stripped.

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
