# HangoverBot: product brief

Received 2026-10-02. Status: ready for engineering architecture and initial build. Several
product, pricing, data-provider and naming decisions are deliberately still open; they
are tracked in `docs/OPEN-DECISIONS.md`, not decided in code.

| | |
|---|---|
| Working product name | HangoverBot |
| Working internal/system name | RosterBots (package scope `@rosterbots/*`) |
| Parent brand | TurboLabs |
| Season naming | "2026 Season" is fine in product and marketing. The product name stays evergreen: never HangoverBot2026. |
| Core promise | Connect your fantasy league. Tell HangoverBot how much authority it has. Go live your life. |
| Positioning | AI-enabled fantasy lineup protection. |
| Consumer tagline | Fantasy help for real life. |
| Campaign concept | QUESTIONABLE. Injury Status. Life Decisions. |

## 1. Product thesis

HangoverBot is not another full fantasy analytics suite. It is a narrow utility whose
primary purpose is preventing users from losing matchups because they were unavailable,
asleep, busy, forgot to check an injury, missed inactives, or otherwise failed to manage
a time-sensitive roster problem.

It should feel closer to **roster insurance** than a research dashboard.

The basic job:

1. Monitor the user's roster.
2. Detect something requiring attention.
3. Solve obvious situations with deterministic software.
4. Invoke AI only when actual judgment is required.
5. Act only within the authority the user granted.
6. Tell the user exactly what happened.

**The rules engine is in charge. AI is a specialist that gets called when needed.**

## 2. Launch surfaces

Required at launch: iOS, Android, responsive web app / desktop experience.

Likely supporting surface: a Chrome / Edge extension, for integrations that benefit from
browser-session authentication or syncing.

Not required initially: native Windows or Mac apps, Apple Watch, Wear OS. Desktop is the
web app unless evidence later shows a native client solves a specific problem.

Monorepo, TypeScript throughout, Expo + React Native for mobile, Next.js for web:

```
apps/       mobile  web  extension  worker
packages/   core  ai  connectors  football-data  ui  config
```

## 3. Existing Megacast work

`rr-draft-megacast` is a source of reusable ESPN integration knowledge, **not** the
HangoverBot application. It has experience with ESPN authentication and session handling,
league identification, team/player normalization, live data, login/session capture,
local credential handling, resilient event processing and state reconciliation.

HangoverBot is a new application. Megacast components are extracted or adapted where
useful. **No local secrets are copied from it.** The audit is `docs/MEGACAST-AUDIT.md`.
