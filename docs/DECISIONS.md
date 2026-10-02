# Decisions

What has been decided since the handoff (`HANDOFF-2026-10-02.docx`), and what is still open.
The handoff's own section 29 list of open questions still stands; this file adds to it.

## Decided

| Date | Decision | Where it lives |
|---|---|---|
| 2026-10-02 | **ESPN only at launch.** Sleeper, Yahoo, CBS and NFL appear in the provider picker as "coming soon". The connector interface stays provider-neutral. | `packages/connectors/src/types.ts` `PROVIDERS` |
| 2026-10-02 | **No unattended writes for an anonymous user.** Until the account is claimed (Apple, Google, email), Bench Protection and AI Rescue behave as Ask Me. Settles handoff Q "exact moment an anonymous user must claim an account" for writes; the purchase threshold is still open. | `core` `effectiveAuthority()` |
| 2026-10-02 | **Football data: start with MySportsFeeds** for schedule, injuries, inactives and depth charts. Ask RotoWire for a news-licensing quote later. ESPN stays the source for the user's own roster only. | `packages/football-data` `GameDayFeed` |
| 2026-10-02 | **AI provider: Anthropic, not OpenAI.** Tiers: Claude Haiku 4.5 for classification and simple ranking, Claude Sonnet 5.5 for real roster decisions, Claude Opus 5.5 for rare escalation. The handoff (sections 12, 21, 25, 29, 30, B) carries these as tracked changes. Model ids and prices stay configuration. | `docs/HANDOFF-2026-10-02.docx`, `STACK.md` |
| 2026-10-02 | Stack as in `STACK.md` (handoff section 21), with Sentry as the crash reporter. | `STACK.md` |

## Engineering readings of the handoff

Places where the handoff is ambiguous and the code had to pick. Each is the cautious
reading; the owner may overrule any of them.

| Topic | Reading | Why |
|---|---|---|
| AI below AI Rescue | Judgment calls at Ask Me and Bench Protection go to the **user** with the options laid out, not to AI. AI is an AI Rescue feature. | Section 4 puts AI in level 4 only; section 23 makes AI the paid upgrade. |
| Bench swaps with no data | Order: user's replacement order, then highest projection (section 9). With neither, it is a judgment call, not a coin flip. | "Do not fake" (section 9). |
| Questionable starters | No action until 100 minutes before his kickoff, then a judgment call. | The news changes until inactives. |
| `refreshConnection()` | Not in the connector. ESPN sessions cannot be refreshed by us. A rejected cookie marks the connection as needing reconnect and tells the user. | `MEGACAST-AUDIT.md` |
| `connect()` | Not in the connector. ESPN sign-in happens in the extension, which hands the session to the backend. | A server cannot sign a consumer in to ESPN. |

## Open, with the cautious default the code uses meanwhile

| Question | Default until decided |
|---|---|
| **Season-ending auto-drop: what confirms it?** Section 7 allows a cheap AI classification of unstructured text. A drop is the one irreversible action. | Only a **structured** data-provider flag can trigger an automatic drop. An AI-classified report becomes an Ask Me proposal. |
| **Season-ending auto-drop: at which authority?** Section 7 says "automation-enabled mode"; section 4 says Bench Protection uses roster players only. | AI Rescue, with the Drops permission on. Not built yet (Phase 2). |
| **Kickoff checks.** Section 6 suggests T-180/90/30/10. Inactives post about 90 minutes out, so T-90 lands before them and the next look is T-30. | Add T-85 and T-75. Measure how late ESPN's own status flips. |
| **One model or three?** The handoff routes across three Claude tiers. A single model at low effort may match the cascade and keeps one prompt cache. | The Phase 5 benchmark measures both before routing is built. |
| Minimum AI confidence for unattended action | 0.8, per user setting. |
| Last-minute scratch source (the Odunze case: news at T-5, after he was declared active) | Not chosen. Candidates: RotoWire news (quote pending) and an X reporter watch on pay-per-use. A benchmark of real Sundays decides. |

## Risks

1. **ESPN cookies expire and only the user can renew them.** A lapsed session is a user
   who thinks they are covered and is not.
2. **The ESPN lineup write is unproven.** It is declared `unverified` in the connector's
   capabilities and must stay behind a feature flag until one real swap is verified.
3. **Inactives timing** on ESPN is unmeasured.
