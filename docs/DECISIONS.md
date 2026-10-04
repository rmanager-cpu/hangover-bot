# Decisions

What has been decided since the handoff (`HANDOFF-2026-10-02.docx`), and what is still open.
The handoff's own section 29 list of open questions still stands; this file adds to it.

## Decided

| Date | Decision | Where it lives |
|---|---|---|
| 2026-10-02 | **ESPN only at launch.** Sleeper, Yahoo, CBS and NFL appear in the provider picker as "coming soon". The connector interface stays provider-neutral. | `packages/connectors/src/types.ts` `PROVIDERS` |
| 2026-10-02 | **No unattended writes for an anonymous user.** Until the account is claimed (Apple, Google, email), Bench Protection and AI Rescue behave as Ask Me. Settles handoff Q "exact moment an anonymous user must claim an account" for writes; the purchase threshold is still open. | `core` `effectiveAuthority()` |
| 2026-10-02 | **Football data: start with MySportsFeeds** for schedule, injuries, inactives and depth charts. Ask RotoWire for a news-licensing quote later. ESPN stays the source for the user's own roster only. | `packages/football-data` `GameDayFeed` |
| 2026-10-02 | **Phone beta this weekend in the owner's own league. Android first; iPhone too if Apple's enrollment clears in time.** Scope and the build contract: `BETA.md`. | `BETA.md` |
| 2026-10-02 | **No desktop anywhere in the user's path.** ESPN sign-in happens inside the phone app (an in-app ESPN login; the app reads the resulting session and hands it to the server). The browser extension becomes an optional desktop route, not the primary one. The separate cookie-based `espn:check` test is replaced by the in-app "What we read from ESPN" screen and a user-chosen test swap. | `apps/mobile`, `BETA.md` |
| 2026-10-02 | **Sunday automation is on, deterministic only:** Bench Protection makes automatic swaps for hard problems (OUT, IR, suspended, bye, empty slot) using the user's replacement order, then projection. First-weekend guardrails: only between T-90 and the cutoff below, at most 3 a day, never on a read that looks wrong, never for an unclaimed account; each write re-validated, verified and receipted, never retried. | `core.guard`, `BETA.md` |
| 2026-10-03 | **The automation window ends at T-4, not T-10** (owner), to catch late scratches like Odunze's, which ESPN shows after T-10. The checker looks every minute inside the last 10. Nothing here sees news before ESPN shows it. | `core.guard` `BETA_AUTOMATION`, `service.nextCheckAt` |
| 2026-10-03 | **No feature flag on the lineup write.** Automatic writes are allowed before the write has been proven in general; the owner accepts that because the Saturday test swap is the proof and happens before Sunday. Instead, per league, **the first automatic move waits until one change the user made through HangoverBot (the test swap, or an approval) has shown on ESPN**, and the receipt for that change says so. Replaces risk 2 below. | `service` `writeUnproven`, `connections.write_verified_at` |
| 2026-10-03 | **A player ESPN projects for zero points is never moved into the lineup** (owner, on seeing Josh Jacobs, day-to-day and suspended, read as `unknown` on the first live read): not as an automatic move, not as a proposal, not as an option. ESPN's zero is its own "not playing" signal and covers statuses the mapping has not seen. A missing projection is not zero. The one exception is the user's own swap on "What we read from ESPN": that is his hand, not HangoverBot's. | `core.engine` `viable()` |
| 2026-10-03 | **Zero is the source of truth for movement, and a hole is fixed by reshuffling, never by optimizing** (owner). A starter ESPN projects for zero points is a hole whatever his status says; OUT, IR, suspended and bye stay holes even before the projection drops. The engine fills a hole by any chain of shifts among active starters with a kickoff still ahead (up to three) plus one bench player in, chosen by replacement order then projection, sent to ESPN in one write. A starter with a non-zero projection is never taken out of the lineup on HangoverBot's own initiative, and a lineup with no hole is never touched. Questionable and doubtful starters with a projection keep the judgment path. First used live Oct 4. | `core.engine` `classify`, `candidatesFor`, `Candidate.via` |
| 2026-10-04 | **A hole is never left in the lineup, and never needs a tap** (owner, after putting Jefferson back in the ESPN app as a test: "Fix it so that's never a situation in which an injured player with a 0 projection is in your starting lineup. I don't want to have to approve it or not"). Inside the T-90 to T-4 window, Bench Protection fills a hole even if the same fix was made before and undone in the ESPN app; an earlier approval or automatic move no longer stops it. What still stops it: the user's Decline in the app, a write for it under way, a failed write this week, a league with no proven write, and the daily cap of 3. A questionable starter ESPN still projects counts as playing, so he can slide to make room (McConkey FLEX to WR, Dobbins in at FLEX). | `service.protect` `userHold`, `core.engine` `shiftable` |
| 2026-10-03 | ESPN's `DAY_TO_DAY` ("DTD") reads as **questionable**: a doubt, judgment only, never an automatic move. Seen on the first live read. | `connectors` `statusOf` |
| 2026-10-03 | **Edge Functions check the caller themselves; the gateway's `verify_jwt` is off for all six.** The project uses the newer API keys, and the gateway check knows only the legacy JWT secret. | `supabase/config.toml`, `_lib/auth.ts`, `DEPLOY.md` |
| 2026-10-03 | **A claimed account can be signed back into by email code, and an ESPN sign-in can be forgotten from Settings.** Otherwise a reinstall left the old account running under cron with no way to stop it. | `apps/mobile/app/signin.tsx`, `credentials` delete policy |
| 2026-10-02 | **Owner direction on autonomy: stay well short of autonomous agents running rosters in possibly-paid leagues.** Questionable players get an AI **strategy** (waivers, game timing), never an AI execution. A benched player is **not** put back automatically. Remaining confirmation: that adds, drops and IR are recommendation-only too. | `DECISIONS.md` |
| 2026-10-02 | **Scheduled checker = Supabase Cron + Edge Functions** (the stack's "reliable scheduled-job service"), so the beta needs no separate server. | `supabase/` |
| 2026-10-02 | Beta app id `com.turbolabs.hangoverbot` (Android package and iOS bundle id). It is permanent once in App Store Connect; the display name can change. | `apps/mobile` |
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
| **Kickoff checks.** Section 6 suggests T-180/90/30/10. Inactives post about 90 minutes out, so T-90 lands before them and the next look is T-30. | The beta checks every 2 minutes inside T-100 and every minute inside T-10, so no fixed stops are needed. Measure how late ESPN's own status flips. |
| **One model or three?** The handoff routes across three Claude tiers. A single model at low effort may match the cascade and keeps one prompt cache. | The Phase 5 benchmark measures both before routing is built. |
| Minimum AI confidence for unattended action | 0.8, per user setting. |
| Last-minute scratch source (the Odunze case: news at T-5, after he was declared active) | Not chosen. Candidates: RotoWire news (quote pending) and an X reporter watch on pay-per-use. A benchmark of real Sundays decides. |

## Risks

1. **ESPN cookies expire and only the user can renew them.** A lapsed session is a user
   who thinks they are covered and is not.
2. **The ESPN lineup write is unproven.** It is declared `unverified` in the connector's
   capabilities. There is no feature flag (owner, Oct 3): the Saturday test swap is the
   proof, and until a league has seen one change of the user's land, its automatic moves
   are proposals. Once a real swap has been seen, take `WRITE_LINEUP` out of `unverified`.
3. **Inactives timing** on ESPN is unmeasured.
