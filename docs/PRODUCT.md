# RosterBots: product

**The spec is `HANDOFF-2026-10-02.docx`** (TurboLabs product + engineering handoff, Oct 2
2026). `HANDOFF-2026-10-02.txt` is a plain-text extraction of it for searching. Where
this repository departs from the handoff, or the owner has since decided something, it
is in `DECISIONS.md`. The handoff itself is not edited.

The short version:

- **Name** RosterBots: Hangover Protection (`@rosterbots/*`; renamed from HangoverBot:
  Roster Protection Oct 10 2026, `DECISIONS.md`). **Parent** Turbo Devs (TurboLabs until Oct 25). The product name
  stays evergreen; "2026 Season" is marketing, not a name.
- **Promise:** connect your league, choose authority, go live your life.
- **Position:** AI-enabled fantasy lineup protection. Roster insurance, not a research
  dashboard. **V1 is reactive:** it rescues a roster from a time-sensitive problem; it
  does not run the team.
- **Rules first, AI second.** Deterministic code handles eligibility, locks, IR, clear
  bench swaps and permissions. AI is event-driven and called only for real judgment. A
  separate permission check decides what may execute. Every write is revalidated,
  verified by a fresh read, and receipted.
- **Surfaces:** iOS and Android (Expo), responsive web (Next.js), a Manifest V3 extension
  where the browser session helps, one Node worker.
- **Launch provider: ESPN only.** Everything else shows as "coming soon".
- **Megacast** is a source of ESPN knowledge, not the foundation. See `MEGACAST-AUDIT.md`.
