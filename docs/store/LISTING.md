# RosterBots: Google Play store listing draft (v0.1.0)

Drafted 2026-10-09 and re-checked against the code the same day: `docs/PRODUCT.md`, `docs/BETA.md` (Mobile section and automation rule), `docs/DECISIONS.md` (through the Oct 4 decisions), `docs/brand/README.md`, `apps/mobile/README.md`, `apps/mobile/app.config.ts`, the in-app copy in `apps/mobile/app/protection.tsx`, `apps/mobile/app/(tabs)/settings.tsx`, `apps/mobile/app/(tabs)/home.tsx`, `apps/mobile/app/(tabs)/activity.tsx`, `apps/mobile/src/Proposals.tsx`, and the service paths `packages/service/src/decide.ts` and `protect.ts`. Every claim below is one the beta code keeps; nothing promises AI, free agents, other hosts, or iOS. Character counts were measured by script (ASCII only, so Play's count will match).

Package: `com.rosterbots.app` · versionName `0.1.0` · Expo SDK 57 · Free · no ads · no in-app purchases.

Play limits confirmed on 2026-10-09 from support.google.com/googleplay/android-developer: app name 30, short description 80, full description 4,000 (answer/9859152); release notes 500 Unicode characters per language (answer/9859348); icon 512x512 32-bit PNG max 1024 KB, feature graphic 1024x500 JPEG/24-bit PNG no alpha and **required**, screenshots 320-3840 px per side with the long side at most 2x the short side, 2 minimum, 8 per device type, at least four at 1080 px recommended (answer/9866151); five tags maximum and Sports is an application category with "fantasy team management" as an example (answer/9859673); title "must be 30 characters or less", no emoji or repeated special characters, no ranking or deal wording, no anonymous testimonials (metadata policy, answer/9898842).

---

## 1. App name (limit 30)

**`RosterBots: Hangover Protection`** — 31 characters. **This is one character over Play's
30-character limit** (renamed from `HangoverBot: Roster Protection`, which fit exactly at
30; the new tagline does not). Google Play will reject this string in the App name field.
Use the fallback below for that field, or shorten the tagline (owner's call; "Hangover
Protect" and "RosterBots: Hangovers" were both considered and rejected as worse than just
using the fallback).

This is the owner's official line (`docs/brand/README.md:7`: "RosterBots: Hangover
Protection"), for the app's own UI, the store description and marketing; it does not need
to fit 30 characters anywhere except the one Play Console field below. For that field,
fall back to:

`RosterBots` — 10 characters

Developer name field: `Turbo Devs` (10). [VERIFY] the developer-name character limit (not on the pages fetched; commonly 50). Google still shows the owner's legal name on a personal account.

---

## 2. Short description (limit 80)

**Primary:**

`Fixes a ruled-out starter in your ESPN fantasy lineup. Bench only, receipted.` — 77 characters

**Alternate (fits exactly):**

`Keeps ruled-out starters out of your ESPN fantasy lineup. Bench only, receipted.` — 80 characters

---

## 3. Full description (limit 4,000; plain text, no markup)

**3,941 characters with LF line endings (Play counts Unicode characters, so paste with LF).** 59 characters of room remain; cut before adding.

```
RosterBots: Hangover Protection, by Turbo Devs.

Fantasy help for real life. RosterBots watches the starters on your ESPN fantasy football team and makes sure a player who cannot play is not still in your lineup when his game kicks off.

WHAT IT DOES
- You sign in to ESPN inside the app, on ESPN's own login page. RosterBots never sees your ESPN password.
- It shows you exactly what it read from ESPN: starters, bench and IR, injury tags, kickoffs, byes, locks and projections, so you can check it line by line against the ESPN app.
- You can make one test swap from the app and swap it back, so you have seen a change of yours land on ESPN before anything automatic happens.
- You choose how much it may do:
  Alerts: it watches and tells you. It never changes your lineup.
  Ask Me: when a starter cannot play, it finds the replacement and sends it to you. Nothing changes until you tap Approve.
  Bench Protection: from 90 to 4 minutes before that game kicks off, it starts the first eligible player from your bench, in your replacement order or else by ESPN's projection, and sends you a receipt. Earlier than that it announces the scheduled move, which you can approve early or decline.
- Every receipt, proposal and failure lands in Activity. Push alerts are optional.

WHAT IT FIXES
A starter ESPN projects for zero points, or who is OUT, on IR, suspended or on bye, or an empty starting slot. That is the whole list of what it fixes. A starter who is only questionable or doubtful is pointed out with the options, and the call is yours.

WHAT IT NEVER DOES ON ITS OWN
- Never benches a starter who is playing. A lineup with no hole is not touched.
- Never starts a player ESPN projects for zero points.
- Never makes trades, never bids FAAB, never drops a player, never picks up a free agent. Replacements come from your bench, only.
- Never moves anyone earlier than 90 minutes or later than 4 minutes before kickoff. Outside that window it asks, or waits.
- Never makes more than three automatic moves a day in a league, and never retries a move ESPN did not accept. It tells you.
- Never moves a player for an account you have not claimed. Claiming is an email address and a six-digit code, nothing more.
- Never acts on a read that looks wrong, or when ESPN has not sent a kickoff time.
- Never shows or logs your ESPN sign-in, and keeps none of it on the phone after sign-in. It is kept encrypted on the server, and "Forget my ESPN sign-in" in Settings deletes it along with every league, move and receipt RosterBots kept.

A move you approve yourself in the app is your call: it is made when you tap, at any protection level.

HOW IT CHECKS ITSELF
Every automatic move is checked against a fresh read of ESPN just before it is made and again just after. A move is not reported done until ESPN shows it. The first automatic move in a league waits until one change you made through RosterBots, the test swap or an approved proposal, has shown up on ESPN.

One thing to know: with Bench Protection on, a hole is filled even if you put the ruled-out player back in the ESPN app. To stop that, decline the move when RosterBots announces it, or switch the league to Ask Me or Alerts, or pause it, in Settings.

ESPN ONLY, FOR NOW
This beta supports ESPN fantasy football leagues. Other fantasy hosts are shown as coming soon and do not work yet. RosterBots is not affiliated with, endorsed by or sponsored by ESPN or The Walt Disney Company. ESPN is a trademark of its owner. You sign in on ESPN's own pages and your ESPN account stays yours.

NOT A RESEARCH APP
RosterBots does not run your team, rank players or work the waiver wire. It does one thing: it keeps a player who cannot play out of your lineup when you are not looking.

EARLY ACCESS
Version 0.1.0 is a beta, first used in a single league. Things can go wrong; every outcome is receipted and nothing is hidden from you. Questions and feedback: support@rosterbots.com.
```

Where each claim comes from (so the text can be re-checked when the code changes):

| Claim | Source |
|---|---|
| Sign-in inside the app, password never seen | `apps/mobile/README.md` step 3; `settings.tsx:167` About copy |
| "What we read" line by line, test swap and swap back (optional) | `docs/BETA.md` Mobile flow; README step 5; `app/read/[id].tsx:176,191,289` |
| Alerts / Ask Me / Bench Protection wording | `apps/mobile/app/protection.tsx` `LEVELS`; `src/lib/format.ts` `AUTHORITY` |
| Scheduled move announced before T-90, approve early or decline | BETA guardrail 1 (`autoAt`); `src/Proposals.tsx:55-79` |
| Problem list: zero projection, OUT/IR/suspended/bye, empty slot; questionable/doubtful starter shown with options | `docs/BETA.md` automation rule; DECISIONS 2026-10-03 "zero is the source of truth"; `packages/core/src/engine.ts:286-289,349` judgment / `ask_user` |
| Starter's own questionable/doubtful is the user's call | DECISIONS 2026-10-04 "A starter's own doubt ... is still judgment only" |
| Never benches a playing starter, never touches a lineup with no hole | CLAUDE.md rules; DECISIONS 2026-10-03 |
| Never starts a zero-projection player on its own (the user's test swap is the exception) | DECISIONS 2026-10-03 `viable()` |
| No trades, FAAB, drops, free agents | `protection.tsx` `RULES`; BETA scope table "Out" |
| T-90 to T-4 window for automatic moves; an approval is written whenever the user taps | `core.guard` `BETA_AUTOMATION`; `packages/service/src/decide.ts:93-151` (no window, cap or claim check on approve) |
| Max 3 automatic moves per league per UTC day, never retried | BETA automation rule item 2 and the failed-write paragraph |
| Needs Google sign-in to move a player on its own | DECISIONS 2026-10-02 "No unattended writes for an anonymous user" |
| Not on a bad read or an unknown kickoff | BETA guardrails 3 and 4 |
| Sign-in never shown/logged; none kept on the phone after sign-in; encrypted on server; Forget deletes leagues, moves, receipts | README steps 3 and "Forget my ESPN sign-in"; `app/connect/espn.tsx:117-119` (one post, then `clearAll`); migration cascade and Vault trigger; `settings.tsx:23-29` |
| Fresh read before and after, first move waits for the user's proof | BETA guardrail 5; `write_verified_at`; `decide.ts:145-148` |
| Hole refilled after an undo in the ESPN app; what stops it | DECISIONS 2026-10-04; `protect.ts:395-401` `userHold` (a `declined` row, which needs a proposal to exist); pause via `settings.tsx:95` |
| ESPN only; others "coming soon" (names left to the app's own list) | DECISIONS 2026-10-02; `app/connect/provider.tsx:9-13`; `packages/connectors/src/types.ts:86-92` (the two lists differ: app says Yahoo/Sleeper/MyFantasyLeague, connectors say Sleeper/Yahoo/CBS/NFL Fantasy) |

[VERIFY] with the owner: DECISIONS 2026-10-04 names the user's Decline as the one thing that stops a refill, but the app only offers Decline on a pending proposal. A hole found inside the window, or refilled after an undo, is written with no proposal, so there is nothing to decline afterwards. Either add a Decline on a done automatic fill before the listing goes up, or keep the description's wording above, which matches the code as it is.

[VERIFY] `protection.tsx:38` still reads "Questionable and doubtful players are always your call", which the Oct 4 decisions outgrew (a questionable bench player ESPN still projects can be the automatic fill). The description above avoids that claim; the Protection screenshot (6c, #3) would not.

---

## 4. What's new (release notes for 0.1.0; limit 500 Unicode characters per language, confirmed)

`First beta: in-app ESPN sign-in, roster check, test swap, bench protection before kickoff.` — 89 characters

Alternates: `First beta: in-app ESPN sign-in, roster check, test swap, Sunday bench protection.` (82; automation runs before every kickoff, not only Sunday, so prefer the first) and `First beta: ESPN sign-in in the app, roster check, test swap, bench protection with receipts.` (93).

---

## 5. Category and tags

- **App category:** Sports (Application, not Game). Confirmed: Google's category list gives "fantasy team management" as a Sports example.
- **Tags** (maximum five, confirmed): pick from whatever the Console offers. [VERIFY] the names: "Fantasy sports", "Football", "Sports", "Tools", "Productivity" are guesses; Google's page lists no tag names and the last three appear there only as categories.
- **Store listing contact email (required, shown on the listing: confirmed):** `support@rosterbots.com` (forwards to the owner; never the personal Gmail).
- **Website (optional but recommended):** the same host as the privacy policy page once it exists (none exists today: `docs/brand/README.md:98`).
- **Privacy policy URL:** required before any closed/open/production track; not in the repo yet. Out of scope of this draft but blocks the listing.
- **Ads:** No. **In-app purchases:** None. **Contains ads declaration:** No.

---

## 6. Graphic assets needed

Measured on 2026-10-09 (`System.Drawing`): every file in `docs/brand/icons/` and `docs/brand/mascot/` is 24-bit RGB with no alpha; every file in `docs/brand/logos/` is 32-bit RGBA on transparent; the seven numbered mockups are 941x1672 24-bit and `00-sheet-lead.png` is 1536x1024 24-bit. `apps/mobile/assets/icon.png` is byte-identical to `docs/brand/icons/icon-1024.png`, and `adaptive-icon.png` to `adaptive-icon-1024.png` (SHA-256 compared).

**Tooling note:** no Python exists on this PC (`python`, `python3` and `py` all resolve to the Microsoft Store stub), so the Pillow commands below cannot run here as written; `apps/mobile/scripts/brand-assets.py` was evidently run elsewhere. Install Python + Pillow, use a phone image editor, or use `System.Drawing` from PowerShell.

### 6a. App icon — 512 x 512, 32-bit PNG, max 1024 KB

| | |
|---|---|
| **Source** | `C:\Users\Chef\hangover-bot\docs\brand\icons\icon-1024.png` (1024x1024, 24-bit RGB, 1,520 KB). Same bytes as `apps/mobile/assets/icon.png`. |
| **Work** | Resize to 512x512 (Lanczos), convert to RGBA but keep it fully opaque, save PNG. Google's icon spec: "Shape: Full square – Google Play dynamically handles masking", "Don't round the edges of your final asset", and transparent areas show the Play UI background, so keep the square and no transparency. [VERIFY] the exported file is under 1024 KB (expected roughly a quarter of 1,520 KB). |
| **Do not use** | `adaptive-icon-1024.png` (padded to Android's safe zone, so the art would sit small inside Play's 30% radius mask) or `icon-art.png` (1254x1254, includes the drawn neon frame that `icon-1024.png` is cropped 5.5% inside; Play would show the frame edge). |
| **Pillow one-liner** (where Python + Pillow exist) | `python -c "from PIL import Image; Image.open(r'docs/brand/icons/icon-1024.png').convert('RGBA').resize((512,512), Image.LANCZOS).save('play-icon-512.png')"` |

The icon carries the HANGOVERBOT wordmark and ROSTER PROTECTION ribbon (`docs/brand/README.md:23-24`). Google's spec forbids text that indicates ranking, deals or Play programs, not brand text, so this is fine.

### 6b. Feature graphic — 1024 x 500, JPEG or 24-bit PNG, no alpha (required, confirmed)

Nothing at this size exists; it must be composed. Recipe:

| Layer | Source | Treatment |
|---|---|---|
| Background | Midnight `#070A24` (brand palette) | Fill the 1024x500 canvas. |
| Wordmark | `C:\Users\Chef\hangover-bot\docs\brand\logos\hangoverbot-by-turbolabs.png` (2172x724, RGBA transparent) | Scale to about 720 px wide (720x240), place left with roughly 48 px margin, vertically centred. Transparent background composites cleanly on Midnight. |
| Robot | `C:\Users\Chef\hangover-bot\apps\mobile\assets\brand\robot-flying.png` (600x589, RGBA cut-out, made for Midnight) | Scale to about 300 px tall, place at the right edge. Fallback: `docs/brand/mascot/pose-flying.png` (768x512, opaque on brand navy; the navy does not exactly match Midnight, so crop tight or leave a navy block). |
| Export | Flatten to RGB (`.convert('RGB')`), save as PNG-24 or JPEG quality 90. No alpha channel. No text other than the wordmark; no "ESPN", no store badges. |

Avoid `hangoverbot-roster-protection.png` for this: its right edge is cropped to the canvas (`docs/brand/README.md:17-18`); use it only after a padded re-export.

### 6c. Phone screenshots — 2 to 8, JPEG or 24-bit PNG, no alpha, each side 320-3840 px, long side at most 2x the short side; at least 4 portrait at 1080 x 1920 or larger (9:16) recommended for featuring (all confirmed on answer/9866151)

No usable source exists today: the app has never been built or run on a phone, and the mockups are too small (941x1672) and wrong for Play as they stand: `00-sheet-lead.png` shows the ESPN, Yahoo, Sleeper and MFL marks and reads "HANGOVER BOTS"; `02-sync-provider.png` shows the four hosts as plain names (no logos) but as four live rows plus a "Manual setup instead" link, which the app does not have. Do not upload anything from `docs/brand/mockups/`.

Plan: take them on the phone from the preview APK (step 2 of CLAUDE.md "Next, in order"), then crop.

| # | Screen | Why |
|---|---|---|
| 1 | Home: "You're covered" headline (`home.tsx:222`; [VERIFY] whether the Headline style renders it in caps), the "Protection: ON · Bench only" line, "Next lock <time>", watched starters with status pills | The promise |
| 2 | "What we read from ESPN" with starters, injury tags, projections and the Test swap section | Transparency |
| 3 | Protection screen with the three levels and the fixed "Keep it safe" checkmarks. [VERIFY] first: `protection.tsx:38` still says "Questionable and doubtful players are always your call", stale against the Oct 4 decisions; reword before shooting | The limits, in the app's own words |
| 4 | Activity with a receipt and a "Waiting for you" proposal showing Approve / Decline (`src/Proposals.tsx`) | The receipt |
| 5 (optional) | Settings with "Forget my ESPN sign-in" | Deletion control |

Cropping rule: a modern Android phone screenshot is 1080x2400 (20:9), which breaks Play's "long side at most 2x the short side" rule. Crop each to 1080x1920 (drop the empty bottom of the screen, or the status bar plus a strip) or place it on a 1080x1920 Midnight canvas. Save as 24-bit PNG or JPEG with no alpha. Blur or avoid any screenshot that shows a real player roster you do not want public; the owner's own league name and team name will be visible on Home and should be checked.

Tablet 7"/10" screenshots: optional for a phone-first app; skip for 0.1.0.

### 6d. Not needed for 0.1.0

Promo video (YouTube URL): optional ("not required", confirmed), skip. TV / Wear / Chromebook assets: not applicable.

---

## 7. Play Console fields outside the listing that this draft touches

- **Developer name:** Turbo Devs.
- **Contact email:** `support@rosterbots.com` (public, confirmed).
- **App access / Sign-in details:** the listing says sign-in happens on ESPN's own page inside the app; the reviewer will need an ESPN account with a league (not covered here).
- **Privacy policy and Data deletion URL:** not in the repo; required before closed testing. The full description's "Forget my ESPN sign-in" line describes credential deletion (credentials, leagues, moves, receipts and the Vault secret), not account deletion: the push-token row and the auth user survive. Do not reword it to claim account deletion until that control exists.

## 8. Notes for the owner

- **Contact email** is `support@rosterbots.com`, in the description too.
- **"A beta, first used in a single league"** in the full description is written for the
  moment of upload, after your own league has used the app on a phone. As of this draft the
  app has never run on a real phone (an emulator build exists); reword if you list before that.
- **ESPN/Disney wording.** The description says "ESPN is a trademark of its owner" rather
  than naming the registrant, and the not-affiliated line names ESPN and The Walt Disney
  Company, matching `docs/research/TERMS-AND-CONSENT-2026-10-03.md`. Yahoo, Sleeper and
  MyFantasyLeague are left out of the description on purpose: the app's "coming soon" list
  and the connector code disagree on which hosts are actually planned, and naming other
  hosts' brands in a store description reads as keyword stuffing under Play's metadata
  policy. Flag if you want them back in.
Play tag names are suggestions; the Console's tag list was not fetched and Google's category page names none.
Character counts were measured with PowerShell String.Length on ASCII-only text: 3,937 (LF) / 3,978 (CRLF) for the full description, 77/80 for the short descriptions, 89/82/93 for the release notes. Play counts Unicode characters, which for ASCII is the same.
Image dimensions and pixel formats were read from the files with System.Drawing on 2026-10-09; the "24-bit no alpha" and "32-bit RGBA" statements come from those reads; the icon copies were compared by SHA-256. Python/Pillow is not installed on this PC (checked); the one-liners are for a machine that has it.
Screenshot guidance assumes a 1080x2400 phone; if the owner's phone has another resolution, the same 2:1 rule applies and the crop target of 1080x1920 (or a Midnight canvas) still works.
Web pages fetched on 2026-10-09: support.google.com/googleplay/android-developer answer/9866151 (assets), answer/9898842 (metadata policy), answer/9859152 (listing), answer/9859348 (releases), answer/9859673 (categories and tags), and developer.android.com/distribute/google-play/resources/icon-design-specifications. The policy research supplied in the task JSON was used for everything else (registration, closed testing, data safety, account deletion).
