# HangoverBot brand

Owner-supplied, Oct 3 2026. This is the brand; the app matches it, not the other way round.

**Official line:** **HangoverBot: Roster Protection**. "Roster Protection" is the subtitle.
The one-word product name is HangoverBot. "by TurboLabs" sits under the wordmark.

## Marks

- **Wordmark:** HANGOVER in purple chrome over BOT in orange chrome, italic, fast; the
  robot head trails orange speed lines to the right. "by TURBOLABS" beneath, small.
- **Mascot:** a white and purple robot with a round dark visor, two orange
  upturned-crescent eyes (a smile), an orange ball antenna, and orange speed streaks.
  It is the app icon.
- **Source files** (`logos/`, owner-supplied Oct 3, PNG 2172×724, transparent):
  `hangoverbot.png` (wordmark + robot), `hangoverbot-by-turbolabs.png`,
  `hangoverbot-roster-protection.png` (the official lockup; its right edge is cropped
  to the canvas, so re-export with padding when possible), `turbolabs.png`.
- **Mascot** (`mascot/`, owner-supplied Oct 3, on the brand navy, not transparent):
  `flying-thumbs-up.png` (1254×1254) is the app icon and splash figure; `poses-sheet.png`
  and its four cut-outs (`pose-flying`, `pose-thumbs-up`, `pose-relaxing`, `pose-laptop`)
  are for empty states and the Home header.
- **Icon** (`icons/`): `icon-art.png` is the owner's icon art (Oct 3): the robot carrying
  a football, the HANGOVERBOT wordmark and ROSTER PROTECTION ribbon inside a neon frame.
  `icon-1024.png` is it cropped 5.5% inside the drawn frame, because the phone rounds the
  corners itself; `adaptive-icon-1024.png` pads the same crop to Android's safe zone on
  `#010420`. The app's `assets/icon.png` and `adaptive-icon.png` are copies. The flying
  robot (`mascot/flying-thumbs-up.png`) is the splash figure, not the icon.

## Palette (from the mockups; matches the handoff's section 24)

| Token | Hex | Use |
|---|---|---|
| Midnight | `#070A24` | screen background |
| Deep navy | `#0C102F` | dark cards, inputs |
| Turbo purple | `#6726E8` | wordmark, accents |
| Electric purple | `#7B2FF7` | highlights, gradients |
| Turbo orange | `#FF7A00` | **primary buttons**, selected state, speed lines, warnings |
| Paper | `#F6F7FB` | light cards on the dark background |
| Healthy green | `#22C55E` | "You're covered", Healthy pills |
| Questionable amber | `#F59E0B` | Questionable pills |

Buttons are orange, pill-shaped, full width, white bold label with a trailing arrow.
Selected options get an orange outline. Cards are white with large radii on dark. Type is
big and bold (SF/Inter-style), white headlines, muted lavender body text.

## Lead reference: `mockups/00-sheet-lead.png`

The six-screen sheet (Oct 3) is the tightest version and the one to match: the
"ROSTER PROTECTION" ribbon under the wordmark, bigger cards, tighter spacing, the robot
peeking in from the right on Home, pill status chips.

Two deliberate departures from the sheet:

- **Spelling.** The sheet reads "HANGOVER BOTS" (plural). The owner's official line is
  **HangoverBot: Roster Protection**, singular. The app uses the singular until the
  owner says otherwise.
- **No third-party logos.** The sheet shows the ESPN, Yahoo, Sleeper and MFL marks on the
  provider rows. Those are their trademarks; Apple 4.1(c)/5.2.1, Google's impersonation
  rule and Disney §2.B.vii all bite on them (see `docs/research/TERMS-AND-CONSENT-2026-10-03.md`).
  Provider rows are name-only with our own small icons, as in the first mockup set.

## Screens (`mockups/`)

| File | Screen | Notes against the beta contract (`docs/BETA.md`) |
|---|---|---|
| 01-welcome | Wordmark, "Fantasy help for real life.", robot, **Sync a League**, Supports ESPN / Yahoo / Sleeper / MyFantasyLeague, How it works | Beta is ESPN only: the other three are shown as "coming soon", not hidden. Terms/Privacy line goes under the button. |
| 02-sync-provider | "Sync a league. Choose where your team lives." provider cards, Manual setup | Same: ESPN active, others coming soon. |
| 07-choose-league | "Choose your league. We found 2 leagues on ESPN." cards with teams / format / record | Record and format come from ESPN; show what the fan profile gives. |
| 04-choose-team | "Choose your team." | Only when ESPN does not say which team is the member's. |
| 03-authority | "What should HangoverBot do if a starter is ruled OUT?" Tell me / Ask me first / Fix it automatically; Replacement source: Bench only / Bench + free agents | Maps to Alerts / Ask Me / Bench Protection. "Bench + free agents" is AI Rescue scope: shown disabled, "coming soon", in the beta. |
| 06-keep-it-safe | "Keep it safe." toggles: only OUT/inactive, never trades, never FAAB without asking, never drop without asking; Sunday lineup alerts | In the beta these are statements of fact, not switches: the beta cannot trade, bid or drop at all. Render them as fixed checkmarks with the same copy, plus the notifications toggle. |
| 05-home | "You're covered", Protection ON · Bench only, team card with week and next lock, watched starters with status pills, Last action, View activity / Manage protection; tabs Home · Team · Activity · Settings | Matches the contract's Home. Add the "What we read from ESPN" entry under Team. |

Not in the mockups, required by the beta: the pre-sign-in disclosure, the ESPN sign-in
WebView, "What we read from ESPN" with the test swap, claim-by-email, Activity with
Approve/Decline, Settings with replacement order. Style them from the same system.

## As built in the app (Oct 3)

Where the beta and the sheet differ, the app went this way; change here before changing it there.

- **Tabs stay Home · Activity · Settings**, the beta contract. The sheet's Team tab is the
  "What we read from ESPN" row on Home's team card, and again under League in Settings.
- **"Keep it safe" and "Replacement source" sit on the Protection screen**, not a step of their
  own: fixed orange checkmarks with the sheet's copy, "Bench only" selected and "Bench + free
  agents" dimmed "Coming soon", and the "Send Sunday lineup alerts" switch bound to the phone's
  notification permission (once on, it is turned off in the phone's Settings, and the app says so).
- **Choose team (04) is not a screen**: `connection-setup` finds the member's team. Its button,
  "This is my team", is the confirm on "What we read from ESPN" during setup.
- **Provider rows** are ESPN, Yahoo, Sleeper and MyFantasyLeague, each with our own one-letter
  disc; only ESPN opens. Welcome's "How it works" unfolds the three promises in place.
- **Icons** are `icons/icon-1024.png` and `adaptive-icon-1024.png` as this file says. The
  **splash is the lockup on Midnight**, not the flying robot.
- **The mascots** ship cut out against the brand navy (`apps/mobile/assets/brand/robot-*.png`,
  made by `apps/mobile/scripts/brand-assets.py`), which only reads right on Midnight: the
  flying robot on Welcome, the head peeking in beside "You're covered" on Home.
- No Terms/Privacy line yet: there is no page to link to.
