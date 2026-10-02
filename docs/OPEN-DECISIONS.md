# Open decisions

The brief leaves these open on purpose. The code is shaped so each can be decided later
without a rewrite; where it had to assume something, the assumption is named here.

| Decision | Owner | What the code assumes until then |
|---|---|---|
| Final product name | Product | `HangoverBot` in user-facing copy (`packages/ui/src/copy.ts`), `rosterbots` in code. Renaming is a copy change plus app identifiers. |
| Pricing and plans | Product | Nothing gated. `profiles.plan` exists and defaults to `free`. |
| Football data provider (inactives, kickoff times, news) | Product + Eng | ESPN's own injury status and pro schedule, read through the connector. `packages/football-data` defines the `GameDayFeed` interface a paid provider would implement. **ESPN alone is weak on game-day inactives**, which is the headline use case; see below. |
| Platforms beyond ESPN (Sleeper, Yahoo, NFL, CBS) | Product | `Connector` interface in `packages/connectors`. Only ESPN is built. |
| Authority level names and exact semantics | Product | Four levels, `alert`, `confirm`, `autopilot`, `full` (see ARCHITECTURE). Stored as text so they can be renamed. |
| How close to kickoff `full` may act on an AI call without asking | Product | Never without a confidence of at least 0.7, and only after `confirm` has had its chance. Configurable per connection. |
| AI model | Eng | `OPENAI_MODEL` env, no default baked into business logic. |
| Scheduled-job service vs persistent worker | Eng | A persistent Node worker with an internal scheduler. Every unit of work is a single idempotent `runConnection` call, so moving to a job service changes only `apps/worker/src/main.ts`. |
| Push beyond Expo | Eng | Expo push service. The sender is one function. |

## Risks worth deciding early

1. **ESPN cookies expire and cannot be refreshed by us.** `espn_s2` lasts months, not
   forever, and a password change kills it. Every lapsed session is a user who thinks they
   are insured and is not. The connection status and a push on `needs_reauth` are built;
   how hard to nag is a product call.
2. **Game-day inactives.** ESPN flips a player to OUT, but its timing against the 90-minute
   inactive list is not something we have measured. If HangoverBot's promise is "we caught
   the inactive", a dedicated feed may be required, not optional.
3. **The ESPN write is unproven.** See `MEGACAST-AUDIT.md`. Nothing that executes a move
   should ship to users until one real swap has been verified end to end.
4. **Acting on someone's account is a trust product.** Every action is logged with the
   rule or AI reason that caused it and the authority that allowed it, and the user is told.
