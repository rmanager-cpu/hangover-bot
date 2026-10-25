# RosterBots: Hangover Protection

Fantasy help for real life, by Turbo Devs. RosterBots watches your ESPN fantasy football
lineup on game day and fixes a starter who can't play before his game kicks off.

The beta is an Android app for ESPN leagues, first used in the owner's own league.

## What it does

1. **Sign in to ESPN inside the app.** ESPN's own login page opens in the app; RosterBots
   never sees the password and keeps no ESPN credentials on the phone.
2. **Pick a league,** then check **What we read from ESPN** against the ESPN app, and make one
   **test swap** to prove RosterBots can change your lineup.
3. **Choose how much it may do:**
   - **Alerts:** tells you when a starter is in trouble.
   - **Ask Me:** proposes the fix; one tap approves it.
   - **Bench Protection:** makes the fix itself, between 90 and 4 minutes before kickoff.
     Needs a claimed account (email code) and one change of yours already seen on ESPN.
4. **Before every kickoff the server reads your lineup.** A *hole* is a starter who is
   ruled out, injured, suspended, on bye, in an empty slot, or projected for zero points.
   The fix is one bench player in, with playing starters shifted along to make room. A
   playing starter is never benched, and a lineup with no hole is never touched.
5. **Every move is checked against a fresh read of ESPN** and lands in Activity as a
   receipt, with a push notification.

## How it fits together

```
 Phone app (Expo)
   │  its own rows, under Row Level Security
   ├────────────────────────────▶ Supabase Postgres
   │                               5 tables · ESPN sessions in Vault
   │  user calls                          ▲
   └──▶ Edge Functions ───────────────────┤
        espn-connect · connection-setup   │
        read · decide · swap · delete-account
                                          │
 pg_cron, every minute ──▶ check ─────────┘
                             │
                             ├──▶ ESPN: read the lineup, write a swap
                             └──▶ Expo push ──▶ phone
```

- **The phone never talks to ESPN** and never keeps an ESPN credential. It reads and writes
  its own rows in Supabase and calls the Edge Functions.
- **The rules engine decides** (`packages/core`): roster in, problems and fixes out, with no
  I/O. The beta makes no AI calls.
- **One check of one league** (`packages/service`) is the same code in Node tests and in
  the Deno Edge Functions, which run committed copies of it (`supabase/functions/_shared`).
- **ESPN cookies live in Supabase Vault.** Only the server can read them, and they are
  never logged.

More in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Repository

| Path | What it is |
|---|---|
| `apps/mobile` | The Expo app. [Its README](apps/mobile/README.md) covers screens and builds. |
| `packages/core` | Domain types, the rules engine, authority levels, game-day guardrails |
| `packages/connectors` | The connector interface and ESPN (leagues, team, roster, lineup write) |
| `packages/football-data` | NFL facts and the game-day data seam |
| `packages/service` | One check of one league: read, judge, act, tell the user |
| `supabase/` | Migration, Edge Functions, auth email templates, `config.toml` |
| `scripts/` | Edge Function build and bundle scripts, and the cookie-based ESPN check |
| `legal/` | Public pages (account deletion). Nothing from `docs/` is ever published. |
| `docs/` | Spec, decisions, contract, deploy, brand, Play Store drafts |

## Commands

Node 22.18 or newer (TypeScript runs natively).

```sh
npm install
npm test                 # engine, ESPN connector and service, no network
npm run typecheck
npm run functions:build  # after changing packages/*/src: refresh the Edge Functions' copies
npm run espn:check       # a real ESPN read from cookies (ESPN_SWID, ESPN_S2); writes nothing
```

The app builds on EAS from GitHub; see [apps/mobile/README.md](apps/mobile/README.md). The
backend deploy is [docs/DEPLOY.md](docs/DEPLOY.md).

## Read next

- [CLAUDE.md](CLAUDE.md): where the project stands and the rules every change keeps
- [docs/BETA.md](docs/BETA.md): the beta's contract (change it before changing an interface)
- [docs/DECISIONS.md](docs/DECISIONS.md): what was decided after the spec, and what is open
- [docs/brand/README.md](docs/brand/README.md): the brand. Some artwork still reads
  HangoverBot, the old name.
- [docs/store/](docs/store/): Google Play listing, privacy policy, data safety drafts
