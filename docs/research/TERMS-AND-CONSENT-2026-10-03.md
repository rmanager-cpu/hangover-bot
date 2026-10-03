# HangoverBot: research brief on consent screens, Terms and Privacy

**For:** the owner of HangoverBot (TurboLabs), to pass to a lawyer
**Date:** October 3, 2026. First research pass October 2, 2026. Adversarial fact-check October 3, 2026.

**This is not legal advice.** It is research and draft wording for a lawyer to review and correct.

## How to read this

- **FantasyPros and Dynasty Nerds pages were never opened directly.** Every fetch was blocked on Oct 2 and again on Oct 3. What they say comes from search results gathered on Oct 2 that quoted or summarised their pages. **The Oct 3 fact-check could not re-confirm any of it.** The search budget was used up and every competitor domain, plus apps.apple.com, play.google.com and chromewebstore.google.com, returned EGRESS_BLOCKED. Treat every FantasyPros, Dynasty Nerds and store-listing claim in this brief as **unverified**.
- **Disney's wording comes from a ToS;DR archive copy that is now at least two years old.** The ToS;DR snapshot repository recorded its last change of any kind on **Sept 11, 2024**, so it cannot show any 2025 or 2026 revision. The live Disney page could not be reached.
- **Google Play wording comes from OpenTermsArchive copies.** On Oct 3 the files were downloaded raw, and their dates were checked against the archive's git history. The User Data policy was recorded Oct 2, 2026; the program policies were last changed Aug 26, 2026.
- **Apple's pages were read on Apple's own site on Oct 3.** The fetch tool summarises pages, so check the Apple quotes word for word before reusing them.
- **Quotation marks** mean the exact words as the source showed them. Anything not seen word for word is marked **(paraphrased)** or is our own reading.
- **Tags:**
  - **[snippet]**: search-result text (Oct 2)
  - **[mirror]**: a third-party copy of the official page
  - **[live]**: the official page
  - **[recall]**: from memory, not checked
  - **[inference]**: our reading
  - **[rechecked Oct 3]**: wording seen again at the cited source on Oct 3
- **Check every quote against the live page before reusing it.**
- **The research on other automation tools found nothing.** That covers host features such as "start active players", scripts and extensions: the search budget ran out. Section 3 therefore draws only on FantasyPros and Dynasty Nerds.
- **Facts about HangoverBot** come from the project repo as of Oct 2–3, 2026: `/home/user/hangover-bot/docs/BETA.md`, `docs/DECISIONS.md`, `docs/HANDOFF-2026-10-02.txt` and the app screens in `apps/mobile/app/`. They were rechecked in the repo on Oct 3.

## The short version

1. **Both competitors appear to change ESPN lineups, but their legal documents don't seem to cover it** (unverified on Oct 3). As far as we could find, neither company's Terms:
   - authorise acting on a user's league account,
   - say who is responsible when a move goes wrong,
   - say they are not affiliated with ESPN, or
   - tell users to follow their league's rules.

   The documents look old for these features:
   - FantasyPros' Terms date from 2010 per a snippet.
   - FantasyPros' Privacy Policy dates from November 2020. That is *after* the July 2020 ESPN extension sync described in section 1, so it is not older than every feature.
   - Dynasty Nerds' app privacy policy dates from July 2021, before its ESPN sync (late 2024).

   Use them as a warning, not a template.
2. **We are about as far as FantasyPros' Auto-Pilot goes, not further.**
   - FantasyPros' Auto-Pilot in "Auto-Submit" mode (as reported, unverified) also changes lineups with nobody watching, including in the hour before games.
   - Bench Protection is narrower: hard problems only, roster players only.
   - But it has **no undo**, where Auto-Pilot emails a "Revert" button.
   - It also runs on an ESPN session taken from the phone.

   Our consent, receipts and liability terms should be at least as strong as theirs, and stronger where we lack an undo.
3. **The biggest risk is Disney's Terms of Use, not the app stores.**
   - Without "express written permission", Disney forbids automated access and any "commercial or business-related use", including enabling third parties to do either (§2.B.viii, §2.B.x).
   - Apple and Google both bring the other service's terms into their own review.
   - If Disney enforces, it can suspend or terminate the *user's* access (§1.H). It could also block HangoverBot or act against TurboLabs directly [inference; see *Power Ventures*, recall]. Our screens should tell users their ESPN account is at risk.
4. **The app is missing what the stores require.**
   - Google's in-app disclosure and tap-to-agree rule applies when collection is outside the user's "reasonable expectation", for example in the background. Taking the ESPN session for scheduled server-side use almost certainly qualifies [inference].
   - Apple and Google both require account deletion inside the app. Google also requires a deletion route outside the app, linked in Play Console. Apple says automatically created "guest" accounts should be deletable too.
   - Today's app has no consent step, no "Disconnect ESPN", no "Delete account", no links to Terms or Privacy, and no "not affiliated" line (rechecked in `apps/mobile/app/` on Oct 3).

   Add these before anyone other than the owner uses the app.
5. **Never touch money.** No dues, prizes, betting words or gambling ads. Gambling and fantasy-contest laws then probably don't reach us [inference]. Paid leagues still raise a liability question for the lawyer.

**Settle one number first.** As the task asked, this brief uses the window "90 to 4 minutes before kickoff". The beta code and the current Protection screen both say **90 to 10 minutes** (rechecked Oct 3):

- `BETA_AUTOMATION = { autoFromMinutes: 90, autoUntilMinutes: 10, maxAutoMovesPerDay: 3 }` in `docs/BETA.md`
- "Only between 90 and 10 minutes before that game kicks off" in `apps/mobile/app/protection.tsx`

The screen is a promise to the user, so it must state the number that actually ships.

---

## 1. What FantasyPros and Dynasty Nerds actually do

**Nothing in the FantasyPros and Dynasty Nerds columns was re-verified on Oct 3.** It all rests on Oct 2 search results.

| | FantasyPros | Dynasty Nerds | HangoverBot today (for contrast) |
|---|---|---|---|
| **Company** | Marzen Media LLC d/b/a FantasyPros.com, Las Vegas, NV ([Terms](https://www.fantasypros.com/about/legal/)) [snippet] | Dynasty Media, LLC, described as "an Ohio Corporation" ([affiliate agreement](https://support.dynastynerds.com/article/20-affiliate-program)) [snippet]. An LLC called a corporation: check the entity before relying on it. | TurboLabs |
| **League hosts** | About 14, including ESPN, Yahoo, Sleeper, CBS and NFL.com ([sync FAQ](https://support.fantasypros.com/hc/en-us/articles/115000414167-My-Playbook-League-Sync-FAQs)) (paraphrased) | Sleeper, MFL, Fleaflicker, FFPC and ESPN "as of August 2025". ESPN was added in app v2.3.35, Oct or Nov 2024 ([hosts](https://support.dynastynerds.com/article/56-league-host-support)) (paraphrased) | ESPN only |
| **ESPN sync on a computer** | Since July 2020 a browser extension picks up the ESPN session already in your browser. Users are told to allow third-party cookies ([help](https://support.fantasypros.com/hc/en-us/articles/360051313453-How-do-I-add-my-ESPN-fantasy-league-to-my-account-Why-do-I-need-your-browser-extension-to-sync-my-league)) (paraphrased) | Not documented | No computer path |
| **ESPN sync on a phone** | "enter your ESPN credentials (username and password) and tap Log In" [snippet, same help page]. Nothing says whether that is ESPN's own page or a FantasyPros form. | The same steps for every host: "select your league host, and enter your login credentials" ([help](https://support.dynastynerds.com/article/51-league-sync-error)) [snippet]. Nothing ESPN-specific. | ESPN's login page (`https://www.espn.com/login`, which hosts Disney's sign-in) in an in-app browser. The app takes ESPN's two session cookies (SWID, espn_s2), sends them to our server, and clears them from the phone (`apps/mobile/app/connect/espn.tsx`). |
| **What the user sees before connecting** | No consent screen found, only buttons: "Start League Sync", "Sync Leagues". Help says syncing is discreet: league mates and the commissioner aren't told ([help](https://support.fantasypros.com/hc/en-us/articles/30748609723035-Will-Syncing-My-League-Alert-My-League-Mates-or-Commish)). Paraphrased: the phrase "completely discreet" was not confirmed word for word. The extension's store listing treats installing as agreeing to the Terms ([listing](https://chromewebstore.google.com/detail/fantasypros-win-your-fant/gfbepnlhpkbgbkcebjnfhgjckibfdfkc)) (paraphrased) | No consent screen or permission wording found | One line on the sign-in screen: "HangoverBot keeps the sign-in ESPN gives this screen, encrypted on its server. It never sees your password." (rechecked Oct 3). No consent step, no Terms link. |
| **What they store** | ESPN: "a copy of your encrypted ESPN cookie is securely stored on our servers", used "to periodically sync your ESPN league"; "This cookie does not contain any human-readable or personally identifiable information" ([help](https://support.fantasypros.com/hc/en-us/articles/115001316727-Do-you-store-my-password-when-syncing-my-league)) [snippet]. CBS, MFL, RSO and RTSports logins are stored "as encrypted values in our secure database" [snippet]. A 2019 blog, written before the 2020 ESPN cookie sync, said "we never keep any of your private account information" ([blog](https://blog.fantasypros.com/9-30-2019-my-leagues-2-0-sync-and-access-leagues-like-never-before/)) [snippet]. | Nothing disclosed. Background sync and lineup writes suggest a stored session [inference]. Snippets crediting Dynasty Nerds with "never storing espn_s2/SWID" came from unrelated projects ([example](https://github.com/maurerFPG/dynasty-league)). Don't cite them. | SWID and espn_s2, encrypted in Supabase Vault. The database row holds only a pointer to the secret. |
| **Where the storage is disclosed** | Help center only. It does not appear in Privacy Policy snippets. | Nowhere found | One in-app line. No policy yet. |
| **Retention and removing the session** | No period stated. "Delete League" and account deletion exist, but neither says the stored cookie is purged ([delete league](https://support.fantasypros.com/hc/en-us/articles/25698325385755-How-do-I-delete-a-league-from-my-account), [delete account](https://support.fantasypros.com/hc/en-us/articles/360042689914-How-do-I-delete-my-account)) (paraphrased) | No period stated. A host can be removed (Accounts, Edit, Delete). Account deletion is by email only ([help](https://support.dynastynerds.com/article/68-deleting-account)) (paraphrased) | Deleting a credential deletes its Vault secret (built). The app has no Disconnect ESPN or Delete account control yet. |
| **Do they change lineups?** | **Yes, in several ways (all paraphrased):**<br>• "Submit Lineup" and "Submit all Lineups" on a tap ([FAQ](https://support.fantasypros.com/hc/en-us/articles/115000414827-Start-Sit-Assistant-FAQs))<br>• Auto-Pilot, which runs unattended (next row)<br>• Waiver Planner, which submits waiver claims and FAAB bids ([help](https://support.fantasypros.com/hc/en-us/articles/40901168902811-What-is-Waiver-Planner-and-How-Does-it-Work))<br>• Co-Pilot, which makes an ESPN draft pick with 10 seconds left ([help](https://support.fantasypros.com/hc/en-us/articles/115001216934-What-is-the-Live-Sync-Draft-Assistant-Co-Pilot-)) | **Yes, on a tap; no unattended feature found.** "Submit Lineup" lists "all of the changes you agree for the Lineup Optimization Tool to make", and "Send" "will send these changes to Sleeper/ESPN, updating your rosters" ([page](https://www.dynastynerds.com/app/fantasy-football-lineup-optimization-tool/)) [snippet]. Marketing also claims "adds/drops"; the help center doesn't confirm it. | **Yes.** Ask Me: one-tap Approve. Bench Protection: unattended, claimed accounts only. |
| **Unattended changes** | **Auto-Pilot**, turned on per league ([help](https://support.fantasypros.com/hc/en-us/articles/115001832073-What-is-My-Playbook-Auto-Pilot-and-how-does-it-work-NFL), [schedule](https://support.fantasypros.com/hc/en-us/articles/360018590474-When-will-Auto-Pilot-check-for-my-optimal-lineup-NFL)). Labels as the snippets quoted them; the rest paraphrased.<br>• Modes: "Swap Inactive Players Only" (the default) or "Full Auto-Pilot".<br>• Delivery: "Confirm by Email" (approve first), or "Auto-Submit", which acts and then emails with a "Revert Lineup Changes" button. Which delivery option is the default was not found.<br>• Checks about every 12 hours, and several times in the hour before games.<br>• Does nothing if the best lineup hasn't changed since the last notice, so it doesn't undo the user's own edits. | None found | **Bench Protection.**<br>• Only hard problems: OUT, IR, suspended, bye, empty slot.<br>• Uses the user's replacement order, then projection.<br>• Beta window T-90 to T-10, at most 3 automatic moves a day per league.<br>• Fresh ESPN read before and after each move, a receipt, never retried. |
| **Undo** | "Revert Lineup Changes" in the email sent after a move | n/a | None. A benched player is not put back automatically. |
| **Paid-league limits** | Yahoo blocks FantasyPros from submitting lineups or transactions in paid Yahoo Public Prize leagues ([FAQ](https://support.fantasypros.com/hc/en-us/articles/115000414827-Start-Sit-Assistant-FAQs)) (paraphrased) | None found | None |
| **Dates of the legal documents** | Terms: 2010 per a snippet, no later revision seen. Privacy: "last updated November 20, 2020" ([policy](https://www.fantasypros.com/about/privacy/)) [snippet]. That is after the July 2020 ESPN extension sync. | Purchase Terms: no date ([terms](https://www.dynastynerds.com/purchase-terms-of-service/)). App privacy policy: "effective as of 2021-07-01" ([policy](https://www.dynastynerds.com/dynasty-nerds-app-privacy-policy/)) [snippet], which is before ESPN sync and lineup writes existed | None yet |

**The pattern (unverified):** both companies explain league access only in help articles. As far as we found, neither company's Terms deals with acting on the user's league account.

---

## 2. Clause comparison

"Lawyer first" marks the clauses that most need a lawyer to draft. **The FantasyPros and Dynasty Nerds columns are unverified (Oct 2 snippets, not rechecked).**

| Topic | FantasyPros | Dynasty Nerds | What HangoverBot needs, and why ours must go further |
|---|---|---|---|
| **Who is bound** | Site users, under the Terms ([Terms](https://www.fantasypros.com/about/legal/)) (paraphrased) | The Purchase Terms bind you "by purchasing a membership". A separate combined "Privacy Policy/Terms" page covers site users ([page](https://www.dynastynerds.com/privacy-policy/)) (paraphrased). So not only buyers are bound, but the buyer terms are the detailed ones. | One set of Terms for every user, free or paid, accepted with a tap before ESPN sign-in. Free users get automation too. |
| **Age** | Under-18s "not eligible"; it is unclear which document says so (paraphrased) | Only "under 13" wording, in the app policy (paraphrased) | 18 or older. Contracts, and money in paid leagues. Lawyer: should it be 21 anywhere? |
| **Permission to act on your league account** | None found | None found | **Lawyer first.** An express grant: you authorise us to use your ESPN session to read your team and, at the level you choose, change your lineup. It must state the limits (no adds, drops, waivers, FAAB, trades or IR) and that you can withdraw it at any time. FantasyPros' Auto-Submit also acts unattended, so this is needed whatever they do. |
| **Holding a sign-in to another service** | Help center only | Not disclosed | State it in the Terms, the Privacy Policy and on screen:<br>• what we hold: a session that lets us act as you on ESPN<br>• how it is encrypted and who can reach it<br>• that it is deleted on Disconnect<br>Don't call it "not personally identifiable" as FantasyPros does. It works like a key, and SWID is itself an account identifier [inference]. |
| **League rules** | None found; only the Yahoo help note | None found | **Lawyer first.** The user confirms they manage the team and that their league allows outside tools, or that they checked with the commissioner. |
| **ESPN's terms** | None found | None found | **Lawyer first.** Say plainly that:<br>• ESPN's terms restrict automated access<br>• ESPN could limit the user's account<br>• we stop if ESPN objects, and the service can end suddenly for that reason |
| **Not affiliated** | None found; only "FantasyPros is a registered trademark" | None found | "Not affiliated with, endorsed by or sponsored by ESPN, Disney or the NFL." Neither store strictly requires a disclaimer. But Google forbids implying an app "is related to or authorized by someone that it isn't", Apple forbids misleading use of others' trademarks (4.1(c), 5.2.1), and Disney forbids use that "suggests an association" (§2.B.vii). A disclaimer is the usual way to stay clear of all three [inference]. |
| **No guarantee** | "AS IS" and "AS AVAILABLE"; no warranty that results will be "effective, accurate or reliable" [snippet] | "AS IS" and "AS AVAILABLE" [snippet] | The same, plus specifics:<br>• statuses change after our last check<br>• ESPN data can be wrong or late<br>• ESPN can reject or delay a change<br>• we can miss a problem<br>"Checked before and after" describes how we work; it is not a promise of success. |
| **Limit on liability** | No dollar cap seen, a full exclusion: "IN NO EVENT SHALL WE OR OUR AFFILIATES BE LIABLE ... FOR ANY ... DAMAGES WHATSOEVER" [snippet] | Section exists; text and cap not seen | **Lawyer first.** A cap, for example what you paid in the last 12 months, or a fixed small sum for free users. Also an express exclusion of lost prize money, league fees, side bets and standings, as far as the law allows. A total exclusion may not hold against consumers [inference]. |
| **Indemnity** | User defends and indemnifies against "all liabilities, claims and expenses, including attorneys' fees" from use or misuse (paraphrased, near-verbatim) | "You agree to indemnify and hold the Company ... harmless from any loss, liability, claim, or demand, including reasonable at[torneys' fees]" [snippet, cut off] | Narrow: misuse, or breaking league rules or ESPN terms the user told us they had checked. Lawyer: is a consumer indemnity worth having? |
| **Subscriptions and refunds** | Help center only:<br>• auto-renews<br>• cancelling stops renewal<br>• 30-day refund on 6- and 12-month web plans, none on monthly<br>• "Multiple uses of the Draft Assistant" rules out a refund ([help](https://support.fantasypros.com/hc/en-us/articles/115001318267-What-is-your-premium-subscription-refund-policy)) (paraphrased) | • Auto-renews monthly or yearly<br>• 7-day full refund, "no questions asked"<br>• Possibly a "[monthly/annual]" template placeholder left in the live text (unconfirmed) ([help](https://support.dynastynerds.com/article/40-purchase-terms-and-refund-policy)) (paraphrased) | Not needed for the free beta. The handoff calls the planned product a "Base purchase around $4.99" and leaves pricing "intentionally unresolved" (`docs/HANDOFF-2026-10-02.txt`), so it may not be a subscription. If it renews, put renewal, cancellation and refund terms in the Terms themselves, plus the app-store billing rules. |
| **Gambling and paid contests** | No gambling clause in the main Terms. Sportsbook and prediction-market deposit offers that grant a subscription, 21+ ([help](https://support.fantasypros.com/hc/en-us/articles/360034183814)) (paraphrased) | No gambling disclaimer. Underdog and FastDraft deposit promos give a free year ([promo](https://www.dynastynerds.com/underdog-promotion-free-year/)) (paraphrased) | Say we are not a fantasy host, contest or betting service, never handle dues or prizes, and run no gambling promotions. This should keep us outside the stores' real-money rules [inference]. |
| **Arbitration and class waiver** | None in the main Terms. Contest rules use JAMS arbitration in Nevada with a class waiver ([contest terms](https://www.fantasypros.com/nfl/perfect-draft/contest-terms/)) (paraphrased) | AAA arbitration in Ohio, no class waiver seen (paraphrased) | Lawyer's call: arbitration with a class waiver, small-claims carve-out and opt-out, or courts. |
| **Governing law** | Nevada, Nevada courts (paraphrased) | Ohio (paraphrased) | TurboLabs' home state |
| **Changing the terms** | "expressly reserves the right to change these Terms of Use from time to time without notice to you" [snippet] | Posted on the page; continuing to use the service means accepting (paraphrased) | In-app notice before material changes. Fresh consent for anything that widens what we do on the user's account. |
| **Termination** | "at any time, in its sole discretion", for violations (paraphrased) | Any time, any reason, without notice (paraphrased) | Either side can end it. When either does, we delete the ESPN session at once. We may pause automation immediately if ESPN changes or objects. |
| **Data collected** | Name, email, password, IP; California categories including "league information" (paraphrased) | Site: name, email, address, phone, payment. App: email and "Log Data" (paraphrased) | An exact list (5c), including what ESPN shows us about other league members. |
| **Retention** | None found | "while your account is active or as needed" (paraphrased) | A period for each kind of data. Both stores require the policy to state retention and deletion (Apple 5.1.1(i); Google's privacy-policy rule) [rechecked Oct 3]. The ESPN session is deleted on disconnect and soon after it stops working. |
| **Selling, ads, tracking** | "We will never sell your information to third parties" [snippet]. Yet it has a California "Do Not Sell" link, and its Apple label lists identifiers used to track ([App Store](https://apps.apple.com/us/app/fantasypros-fantasy-advice/id1141119371)) [snippet; listing blocked Oct 3] | No "we don't sell" statement. Its Play label says device IDs are shared ([Play](https://play.google.com/store/apps/details?id=com.dynastynerds.mockdraft)) (paraphrased; listing blocked Oct 3) | "We don't sell your data, share it for advertising, or track you." The handoff rules out banner and interstitial ads in V1, so this can be true. Store labels must match. |
| **Deletion** | Web form; transaction history kept, unlinked from the user (paraphrased) | Email only (paraphrased) | In-app "Delete account" and a web page. Google requires both, with the web link entered in Play Console; Apple requires in-app deletion (section 4). It must remove the ESPN session, rosters, activity and push tokens. |
| **State privacy laws** | California section only | None | Lawyer: which state laws apply at our size. Honour access and deletion requests everywhere anyway. |
| **Children** | Under 18 not eligible (paraphrased) | Under 13 (paraphrased) | Not for anyone under 18. Delete the data if found. |
| **Security** | Nothing specific seen | "commercially acceptable means"; "no method of transmission over the internet, or method of electronic storage is 100%" secure [snippet] | Describe:<br>• Vault encryption<br>• no logging of requests to ESPN (they carry the user's cookies)<br>• limited staff access<br>• breach notice<br>Lawyer: is the ESPN session a "security credential" under breach laws? |

---

## 3. What automation tools disclose, and the lessons for us

**What we have (all from Oct 2 snippets, unverified on Oct 3):**
- FantasyPros: Submit Lineup, Auto-Pilot, Waiver Planner, Co-Pilot.
- Dynasty Nerds: Submit Lineup.

**What we don't have:** anything verified about host-run automation (Yahoo, ESPN, Sleeper, Fantrax, MFL, CBS), third-party auto-lineup scripts or extensions, or what commissioners think of them. Both research runs hit their search limit. Those are listed at the end as leads only.

| Feature | Trigger | How the user is told | Where it is explained |
|---|---|---|---|
| FantasyPros Submit Lineup / Submit all Lineups | User taps | In the feature | Help center |
| FantasyPros Auto-Pilot, "Confirm by Email" | Schedule | Email before any change, with a link to review and submit | Help center |
| FantasyPros Auto-Pilot, "Auto-Submit" | Schedule | Email after the change, with "Revert Lineup Changes" | Help center |
| FantasyPros Co-Pilot (draft) | 10 seconds left on the clock | Green strip, on/off slider, "Skip auto-pick" link (paraphrased) | Help center |
| FantasyPros Waiver Planner "Submit Plan" | User taps | In the feature | Help center |
| Dynasty Nerds Submit Lineup, then Send | User taps | Full list of changes before Send | Marketing page, in-app |

As far as we found, none of these appear in either company's Terms.

**Lessons:**

1. **Turn automation on per league, separately from connecting.** Auto-Pilot is per league. Bench Protection already is too; keep it that way.
2. **Offer approve-first next to act-first.**
   - FantasyPros has Confirm by Email and Auto-Submit. Ours is Ask Me and Bench Protection.
   - Keep Ask Me the default. The schema already defaults `authority` to `ask_me` (`docs/BETA.md`).
3. **Keep the automatic default narrow.** FantasyPros reportedly defaults to "Swap Inactive Players Only". Ours is narrower still: hard problems, roster players only.
4. **Show every change in full.** Dynasty Nerds lists every change before Send. Our receipt should name:
   - each player and slot
   - the trigger and the time
   - the result of the after-check on ESPN
5. **Give a way back.** FantasyPros' after-email carries "Revert Lineup Changes". We have no undo.
   - Consider a one-tap Undo on the receipt while the slots are still unlocked.
   - Then never redo a move the user undid.

   This is a product decision, but it also helps the liability story.
6. **Don't fight the user's own edits.** Auto-Pilot does nothing if the best lineup hasn't changed since its last notice. We re-read ESPN before every write; say so on screen.
7. **Make the on/off state obvious.**
   - Co-Pilot has a green strip and a slider.
   - Show "Bench Protection on" and the next check time on Home.
   - Show a loud "Signed out of ESPN: not protected" state. `DECISIONS.md` risk 1 is "a user who thinks they are covered and is not" (rechecked Oct 3).
8. **Say when it acts.** FantasyPros publishes its check schedule. State our window in the app.
9. **Put it in the Terms, not only the help center.** This appears to be the weakest point for both competitors.
10. **Don't overclaim.**
    - FantasyPros' 2019 "never keep" line predates its 2020 ESPN cookie storage. An old statement left standing next to a newer practice is the trap to avoid. The 2019 blog is not proof that FantasyPros misdescribes its current practice.
    - FantasyPros calls the stored cookie free of "personally identifiable information", but a working session acts as the user.
    - Dynasty Nerds' marketing promises "adds/drops" that its help pages don't describe.

    Our wording must match the code exactly, including the window number.
11. **Don't sell secrecy.** FantasyPros reportedly presents syncing as discreet (league mates aren't told). We should do the opposite and suggest telling the commissioner. Regulators of paid daily-fantasy contests treat "scripts" as a fairness issue (section 4.4). Those rules bind licensed contest operators, not private ESPN leagues [inference].
12. **Hosts restrict writes in paid leagues.** Yahoo reportedly blocks FantasyPros in its prize leagues. Whether ESPN has anything similar is unknown; check ESPN's fantasy rules.
13. **Verify writes, and say it carefully.** As far as we found, neither competitor says it reads the lineup back after a change. We do. Present that as how we work, not as a guarantee.

**Leads not researched (all [recall]; no wording seen):**
- Yahoo's "Start Active Players" button (medium confidence it exists).
- Any ESPN or Sleeper auto-set feature (low).
- Commissioner-enabled automatic substitution on Fantrax, MFL, Fleaflicker or CBS (low to medium).
- Chrome extensions and GitHub scripts that press "start active" on a schedule (medium that they exist).
- r/fantasyfootball and r/FFCommish threads on whether these are allowed (unknown).

These are worth a second pass. If ESPN itself offers anything like auto-start, that changes the "automated gameplay" argument in 4.1 [inference].

---

## 4. Platform and legal rules that shape our screens

### 4.1 ESPN and Disney Terms of Use

**Source:** the ToS;DR snapshot showing "Last Updated: May 24, 2024" ([mirror](https://github.com/tosdr/tosdr-snapshots/blob/main/The%20walt%20disney%20company/Terms%20of%20Service.html); raw file re-read Oct 3).

- **The copy is stale.** The snapshot repository's last commit of any kind is Sept 11, 2024, so it shows nothing about 2025–2026 revisions.
- **The official page could not be reached.** [disneytermsofuse.com/english](https://disneytermsofuse.com/english/) was blocked Oct 2 and Oct 3. Pull the live text before relying on any section number below. [mirror, rechecked Oct 3 against the same copy]

- **They cover ESPN.** Disney Products are products "which may be branded Disney, ABC, ESPN, Marvel, Pixar…".
- **§2.A:** the licence is "for your personal, noncommercial use only".
- **§2.B opening words:** "you will not nor permit another person to do any of the following without our express written permission, and that these restrictions are a condition to your license". The user promises not to let *us* do the listed things.
  - **§2.B.x:** "access, monitor, copy or extract the Disney Products using a robot, spider, script, or other automated means…". Our scheduled reads and writes are exactly this. This is the core conflict.
  - **§2.B.viii:** "use the Disney Products for any commercial or business-related use or build a business utilizing the Disney Products, or engage in any activity to enable third parties to engage in any of the foregoing activities, in each case whether or not for profit". This covers any paid product, or a free one meant to become a business. The "enable third parties" words reach the user who connects us [inference].
  - **§2.B.vii:** "access or use the Disney Products in a manner that suggests an association with our products, services or brands". So: no ESPN logos or look-alike branding.
  - **§2.B.ix and xi:**
    - ix: "bypass, modify, defeat, tamper with or circumvent any of the functions or protections of the Disney Products"
    - xi: "damage, disable, overburden or impair the Disney Products"

    Keep request volume low and never work around a login or bot check.
- **§3.H** ("Commercial, Marketing, or Branding Use Prohibited"): "we do not allow uses of the Disney Products, or other Disney intellectual property, that are commercial or business-related". This reinforces §2.B.viii.
- **§1.F** ("Passwords and Security"):
  - "You agree that you will not share your account or account information with others."
  - The user is also "responsible for all activities under your account that you can reasonably control".

  Giving us the session is arguably sharing [inference].
- **§1.E:** the user must not "impersonate or misrepresent your affiliation with any person or entity, including using another person's username, password or other account information". This binds the user, who uses their own account. Whether our use on the user's behalf falls under it is a grey area [inference].
- **§3.I** (headed "Malware"): "You agree not to use any software or device that allows automated gameplay, expedited gameplay, or other manipulation of gameplay or game client and you agree not to cheat or otherwise modify a Disney Product or game experience to create an advantage for one user over another."
  - The previous draft spliced these into one clause with "[or]". They are two separate promises.
  - Automatic lineup moves could be read as "automated gameplay" [inference], though the "Malware" heading makes this a weaker hook than §2.B.x.
- **§1.H:** Disney "may terminate or suspend your access to any Disney Products … if we have objective reason to believe you have used the Disney Products in violation of any provision of this Agreement". **The user's ESPN account is at risk.**
  - Disney could also act against HangoverBot directly, by blocking our servers or by a demand letter or claim [inference].
- **Changes:** "If we make a material change to this Agreement, it will be effective thirty (30) days following either our dispatch of a notice to you or our posting of the amended terms".

**Notes:**
- **Co-managers.** ESPN supports co-managers: two accounts on one team. This was seen in the owner's own league in Sep 2026, per `/home/user/rr-draft-megacast/CLAUDE.md`. A HangoverBot account invited as co-manager would avoid holding the user's session. But it would be visible to the league, and the automated and commercial use would then be HangoverBot's own, directly under §2.B.viii and §2.B.x [inference].
- ***Facebook v. Power Ventures*** [recall, not checked], 844 F.3d 1058 (9th Cir. 2016).
  - After a cease-and-desist, continuing to access a site with users' permission was held to be "without authorization" under the federal computer-access law.
  - Later cases (*Van Buren*, 2021; *hiQ v. LinkedIn*, 9th Cir. 2022) narrowed the law in other respects. Our recall is that they left this point standing for password-protected data. Unverified.
  - If Disney objects in writing, we must stop [inference].

### 4.2 Google Play

**Sources:**
- OpenTermsArchive copy of Google's [User Data policy](https://github.com/OpenTermsArchive/vlopses-us-versions/blob/main/Google%20Play/Privacy%20Policy.md): last recorded Oct 2, 2026; the Oct 2 change was cosmetic.
- OpenTermsArchive copy of its [program policies](https://github.com/OpenTermsArchive/vlopses-us-versions/blob/main/Google%20Play/Community%20Guidelines.md): last changed Aug 26, 2026.
- Both dates were confirmed from the archive's git history on Oct 3. The [official User Data page](https://support.google.com/googleplay/android-developer/answer/10144311) was not reachable. [mirror, rechecked Oct 3]

- **The session counts as sensitive.** Personal and sensitive user data includes "authentication information".
- **When a prominent disclosure is required:** when collection "may not be within the reasonable expectation of the user of the product or feature in question (for example, if data collection occurs in the background when the user is not engaging with your app)". Our scheduled reads fit [inference].
- **The disclosure:**
  - "Must be within the app itself, not only in the app description or on a website"
  - "Must be displayed in the normal usage of the app and not require the user to navigate into a menu or settings"
  - "Must describe the data being accessed or collected"
  - "Must explain how the data will be used and/or shared"
  - "Cannot only be placed in a privacy policy or terms of service"
  - "Cannot be included with other disclosures unrelated to personal and sensitive user data collection"
- **The consent:** it must be "immediately preceded by an in-app disclosure", and:
  - "Must present the consent dialog clearly and unambiguously"
  - "Must require affirmative user action (for example, tap to accept, tick a check-box)"
  - "Must not interpret navigation away from the disclosure (including tapping away or pressing the back or home button) as consent"
  - "Must not use auto-dismissing or expiring messages as a means of obtaining user consent"
  - "Must be granted by the user before your app can begin to collect or access the personal and sensitive user data"
- **Google's model sentence:** "[This app] collects/transmits/syncs/stores [type of data] to enable ["feature"], [in what scenario]."
- **Privacy policy:** required "in the designated field within Play Console, and a privacy policy link or text within the app itself".
  - It must include "Developer information and a privacy point of contact or a mechanism to submit inquiries", the data types and the parties it is shared with, "Secure data handling procedures", and "The developer's data retention and deletion policy".
  - The listed entity or the app must be named in it.
  - It must sit on "an active, publicly accessible and non-geofenced URL (no PDFs)".
- **Account deletion:**
  - "If your app allows users to create an account from within your app, then it must also allow users to request for their account to be deleted."
  - This is needed in the app and "outside of your app (for example, by visiting your website)".
  - "A link to this web resource must be entered in the designated URL form field within Play Console."
  - Freezing is not deletion.
  - Data may be kept only "for legitimate reasons such as security, fraud prevention, or regulatory compliance", and users must be told.

  Claiming an account by email creates one [inference]. Whether an anonymous session counts for Google is a question for the lawyer. Apple's answer is in 4.3.
- **Data safety form:** "you alone are responsible for making complete and accurate declarations in your app's Play store listing". SDK collection must be reflected too ([developer.android.com](https://developer.android.com/privacy-and-security/declare-data-use); the old `/guide/topics/data/collect-share` URL now redirects there) [live, rechecked Oct 3].
- **Credentials and phishing:**
  - Malware objectives include "Transmit personal data or credentials off the device without adequate disclosure and consent".
  - Phishing is "Code that pretends to come from a trustworthy source, requests a user's authentication credentials or billing information, and sends the data to a third-party. This category also applies to code that intercept the transmission of user credentials in transit." Its "Common targets" include "online account credentials for social networks and games".
  - Google advises "Use official APIs and secure methods to handle user credentials and payment information", and "Don't intercept or collect user credentials or sensitive information without consent."

  Lifting espn_s2 out of a login page (and, in the fallback, by injected script) and sending it to our server looks like this pattern to a scanner or reviewer [inference]. Our defences:
  - the disclosure and consent screen
  - never reading the password fields
  - showing the real Disney page
- **Device and Network Abuse:**
  - The listed examples include "Apps that access or use a service or API in a manner that violates its terms of service." Read with Disney §2.B.x, this is the main Play risk [inference].
  - They also include "Game cheating apps that affect the gameplay of other apps". This aims at on-device game cheats, but a reviewer could read fantasy-lineup automation through it [inference].
  - Keep the in-app browser to https Disney and ESPN sign-in pages only, because our cookie-reading fallback injects script [inference].
- **Impersonation and metadata:**
  - "Don't imply that your app is related to or authorized by someone that it isn't."
  - "Don't use a celebrity's name or a brand's logo without permission."
- **Real money:**
  - Daily fantasy apps must complete Google's DFS application, hold "a valid license for each US state or US territory in which a license is required", and be "rated AO (Adult Only) or IARC equivalent".
  - Google does not allow services "that enable or facilitate users' ability to wager, stake, or participate using real money (including in-app items purchased with money) to obtain a prize of real world monetary value".
  - Apps with gambling ads may not provide "support or companion functionality (for example, functionality that assists with wagering, payouts, sports score/odds/performance tracking, or management of participation funds)".

  We stay out by never touching money and showing no gambling ads [inference].
- **Reviewer access [recall]:** reviewers need a working login.
  - An ESPN demo account is awkward: emailed codes, an in-season league, and giving reviewers the password is itself "sharing" under Disney §1.F.
  - A "Try a sample league" mode open to everyone avoids this.
  - Google's riskware guidance says "Don't make your app's behavior different for reviewers versus regular users", so a reviewer-only mode is out.

### 4.3 Apple App Store

**Source:** the [Review Guidelines](https://developer.apple.com/app-store/review/guidelines/) [live, rechecked Oct 3]. The page shows no revision date. On [Apple's news page](https://developer.apple.com/news/) on Oct 3:

- The last guideline change listed is Feb 6, 2026 (anonymous-chat apps under 1.2).
- The Nov 13, 2025 update added 4.1(c) and the third-party AI wording in 5.1.2(i).

- **5.2.2:** "If your app uses, accesses, monetizes access to, or displays content from a third-party service, ensure that you are specifically permitted to do so under the service's terms of use. Authorization must be provided upon request." This is the highest App Store risk: we hold no permission from Disney [inference].
- **5.1.1(v), credentials:** "An app may not store credentials or tokens to social networks off of the device and may only use such credentials or tokens to directly connect to the social network from the app itself while the app is in use."
  - The examples Apple gives of social networks are "Facebook, WeChat, Weibo, X". Whether App Review treats ESPN as a "social network" is **unsure**.
  - If it does, server-side storage and acting while the app is closed both conflict.
- **5.1.1(v), revoking access:** "The app must also include a mechanism to revoke social network credentials and disable data access between the app and social network from within the app". So, at minimum, a Disconnect ESPN control.
- **5.1.1(v), deletion:** "If your app supports account creation, you must also offer account deletion within the app".
  - [Apple's deletion guidance](https://developer.apple.com/support/offering-account-deletion-in-your-app/) [live, Oct 3] adds: "Users should have the option to delete automatically generated accounts (sometimes called "guest" accounts) and the data associated with those accounts."
  - Deletion removes data "that the developer isn't legally required to maintain".
  - Temporary deactivation alone "is insufficient".
- **5.1.1(i) and (ii):** a privacy policy in the app and in App Store Connect.
  - The policy must explain "data retention/deletion policies and describe how a user can revoke consent and/or request deletion".
  - It must confirm that third parties receiving data give "the same or equal protection".
  - Users need consent, and "an easily accessible and understandable way to withdraw consent".
- **5.1.1(vi):** "Developers that use their apps to surreptitiously discover passwords or other private data will be removed from the Apple Developer Program." Never touch the password field. Be open about taking the session.
- **5.1.1(viii):** "Apps that compile personal information from any source that is not directly from the user or without the user's explicit consent, even public databases, are not permitted". Showing league mates' team and manager names that ESPN shows the user is probably not "compiling" [inference], but keep that data minimal and say so in the policy.
- **5.1.1(ix):** apps in "highly regulated fields (such as … gambling …) or that require sensitive user information should be submitted by a legal entity that provides the services, and not by an individual developer". Holding ESPN sessions is arguably "sensitive user information" [inference], so submit as TurboLabs the company.
- **5.1.2(i):** "You must clearly disclose where personal data will be shared with third parties, including with third-party AI, and obtain explicit permission before doing so." Not needed in the beta (no AI calls). Needed before AI Rescue.
- **5.1.2(ii):** "Data collected for one purpose may not be repurposed without further consent unless otherwise explicitly permitted by law".
- **4.1(c):** "You cannot use another developer's icon, brand, or product name in your app's icon or name, without approval from the developer." So no "ESPN" in the name or icon. Under 2.3.7, metadata must not be packed with "trademarked terms" and subtitles must not "reference other apps", so keep it out of the subtitle and keywords too. 5.2.1 also bars trademarks "without permission".
- **2.3.1(a), 2.1(a):**
  - New features "must be described with specificity in the Notes for Review", so describe the server-side automation there.
  - Provide "demo account info". A built-in demo mode in place of a demo account needs "prior approval by Apple".
  - "placeholder text, empty websites, and other temporary content should be scrubbed", so the "coming soon" provider rows could draw a rejection [inference].
- **4.8 Login Services (correction):** the current rule no longer names Sign in with Apple.
  - An app that uses a third-party or social login for the user's primary account must also offer "another login service" that limits data to name and email, lets users keep their email private, and does not collect interactions for advertising without consent.
  - No such option is needed if the "app exclusively uses your company's own account setup and sign-in systems".
  - So it is not needed while sign-in is our own email code. If Google sign-in is added, an equivalent privacy-focused option is needed; Sign in with Apple is one way to meet it.

### 4.4 Fantasy-sports and gambling law

- **Federal (UIGEA).** "Bet or wager" excludes certain fantasy games under §5362(1)(E)(ix) ([mirror](https://github.com/legalize-dev/legalize-us/blob/main/us/USC-T31-S5362.md), release point 119-73, updated Mar 26, 2026; [official](https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title31-section5362), not reached). [mirror, rechecked Oct 3]
  - The conditions:
    - no fantasy team "based on the current membership of an actual team"
    - prizes "established and made known to the participants in advance" and not set by the number of participants or fees
    - "All winning outcomes reflect the relative knowledge and skill of the participants and are determined predominantly by accumulated statistical results of the performance of individuals … in multiple real-world sporting or other events"
    - no outcome based on a single real-world team's score or performance, or "solely on any single performance of an individual athlete"
  - The law neither legalises nor bans fantasy: "No provision of this subchapter shall be construed as altering, limiting, or extending any Federal or State law or Tribal-State compact prohibiting, permitting, or regulating gambling within the United States" (§5361(b)). [mirror]
  - It concerns game operators and payment processors, not a tool that takes no entries and pays no prizes [inference; recall].
  - A tool that follows the user's own replacement order arguably still reflects the user's skill. **No authority was found either way.**
- **State operator laws** regulate contests run for the public with entry fees:
  - [Virginia §59.1-556](https://github.com/openva/va-decoded/blob/master/output/59.1-556.xml) defines an operator as "a person or entity that offers fantasy contests for a cash prize to members of the public". [mirror, rechecked Oct 3; section history shows 2016]
  - Missouri: a definition of "Script" ("a list of commands that a fantasy-sports-related computer program can execute to automate processes on a fantasy sports contest platform") and a duty on licensed operators to "prohibit the use of scripts… that give players an unfair advantage" ([revisor.mo.gov §313.920](https://revisor.mo.gov/main/OneSection.aspx?section=313.920)).
    - **Unverified.** The wording came from Oct 2 snippets. revisor.mo.gov is the official site (not a mirror) and was blocked Oct 3.
    - The section numbers are unconfirmed. The definition may sit in §313.900, the chapter's definitions section [recall], not "§313.905(15)".
  - Maryland COMAR 36.09.03.04: "Scripts shall be available to all fantasy competition players". **Unverified** [snippet only].
  - These bind licensed operators on their own contest platforms, not private ESPN leagues. Missouri's definition speaks of a "fantasy sports contest platform", which ESPN private leagues are probably not [inference]. They do show regulators treat scripts in paid contests as a fairness issue.
- **Private leagues where friends pool money** fall under general state gambling and social-gambling rules, which vary [inference]. Some states, Washington historically, have treated paid fantasy as gambling [recall, unsure].
- **Practical line:** never collect, hold, track or pay dues or prizes. Never say "bet", "wager", "odds", "cash" or "win money".

### 4.5 Other law for the lawyer (not researched, [recall])

- **Computer-access laws:** the federal anti-hacking statute (CFAA) and California Penal Code 502.
- **State breach-notification laws** that treat online-account credentials as personal information.
- **State privacy-law thresholds.**
- **Automatic-renewal laws**, if the paid tier renews.
- **Advertising:** the handoff says the product "should feel more like roster insurance than a fantasy research dashboard" (`docs/HANDOFF-2026-10-02.txt`). Calling a product "insurance" in marketing may draw insurance regulators [inference]. Clear that word before marketing uses it.

### 4.6 This weekend versus a public launch

- **Sideloaded beta:**
  - A sideloaded Android APK skips Play review.
  - Google's developer-verification requirement for sideloaded apps on certified devices began Sept 30, 2026 only in Brazil, Indonesia, Singapore and Thailand. It expands globally in 2027 ([developer.android.com](https://developer.android.com/developer-verification)) [live, Oct 3, via fetch summary]. It does not block a US sideload this weekend, but it will matter for any 2027 sideloaded beta.
  - TestFlight: internal testers are up to 100 team members with an Account Holder, Admin, App Manager, Developer or Marketing role, and no review is mentioned for them. External testers need "your first build already approved by App Review for TestFlight" ([developer.apple.com/testflight](https://developer.apple.com/testflight/)) [live, Oct 3].
- **Disney's terms bind whoever connects an account**, however the app is distributed. This weekend that is the owner's own ESPN account.
- **Everything else in this brief** is needed before a public store listing, or before anyone other than the owner connects an account.

---

## 5. Draft up-front screens

**Rules for all three screens** (from 4.2 and 4.3):
- Show each one as its own screen in the normal flow, never in Settings.
- Nothing pre-ticked. Back, swipe-away or "Not now" means no.
- No timers.
- Store a record each time: wording version, time, account, league, and each box ticked.
- Use the same words in the Terms and Privacy Policy.

**Terms acceptance goes on the Welcome screen, not on screen (a).** This keeps the data disclosure on its own, as Google asks. Add under "Sync a League" (the existing Welcome button, rechecked Oct 3):

> By tapping **Sync a League** you agree to the [Terms] and [Privacy Policy].
> HangoverBot is made by TurboLabs. It is not affiliated with or endorsed by ESPN or Disney.

(Lawyer: should this be a checkbox instead? See question 21.)

### (a) Before ESPN sign-in

**Title:** Before you sign in to ESPN

**Body:**

> HangoverBot works by using your ESPN sign-in. Here is exactly what that means.
>
> **What we keep**
> • Your ESPN sign-in session: two cookies ESPN gives this screen after you sign in. We do not read or keep your ESPN password.
> • Your league, team and roster as ESPN shows them, including other teams' names in your league, and your HangoverBot settings.
>
> **Where**
> Encrypted on our servers (run by our hosting provider, Supabase). Not on this phone: we clear ESPN's sign-in from this screen as soon as we have it.
>
> **Why**
> To check your lineup on a schedule, including when the app is closed. If you later turn on Bench Protection, it is also used to change your lineup on ESPN for you.
>
> **What it allows**
> Until ESPN ends it, this session lets whoever holds it act as you in ESPN Fantasy. We use it only to read your league and to make the lineup changes you allow.
>
> **How to stop**
> Settings › Disconnect ESPN deletes the session from our servers straight away. Deleting your HangoverBot account does the same. [Verify before shipping: whether changing your ESPN password also ends it.]
>
> **About ESPN**
> HangoverBot is not made, endorsed or supported by ESPN or Disney. ESPN's terms limit automated use of ESPN accounts, and ESPN could restrict or suspend an account it thinks breaks them. [Wording for counsel.]

**Buttons:** **[Agree and sign in to ESPN]**  **[Not now]**

**Small print:** "Not now, or going back, means nothing is connected."

**Notes:**
- The current sign-in screen says "It never sees your password". The password is typed into a page running inside our app, so "we do not read or keep your ESPN password" is the accurate claim. Change it.
- Show the Disney address on the sign-in page so people can see it is the real one.
- The "About ESPN" paragraph could arguably be an "unrelated" disclosure under Google's rule. It is tied to how the session is used, so we kept it here. Counsel may move it to the Welcome screen.
- **Disconnect ESPN does not exist in the app yet.** Build it before this screen promises it. Apple 5.1.1(v) asks for a revoke mechanism in the app anyway.

### (b) Before turning on automatic swaps

**Title:** Turn on Bench Protection?

**Body:**

> With Bench Protection on, HangoverBot changes your ESPN lineup by itself, without asking first. Please read this once.
>
> **What it will do**
> • Step in only when a starter is ruled OUT, on IR, suspended or on bye, or a starting slot is empty.
> • Use only players already on your roster: the first eligible player in your replacement order, or, if you haven't set one, the player with ESPN's highest projection.
> • Act only from 90 minutes before kickoff until [4 — the beta code says 10; this must match what ships] minutes before. If the move involves two games, it goes by the earlier kickoff. Before that window it tells you what it plans to do and when.
> • Make at most 3 automatic moves a day in each league. After that, it asks you.
> • Check your lineup on ESPN right before each move and again right after. If ESPN doesn't show the change, it tells you and does not try again.
> • Leave a receipt in Activity for every move, and send an alert if alerts are on.
> • Ask you instead of acting if anything looks wrong: an odd read from ESPN, or an unknown kickoff time.
>
> **What it won't do**
> • Questionable and doubtful players: always your call.
> • No adds, drops, waiver claims, FAAB bids, trades or IR moves. Ever, at this level.
> • If a player it benched is later cleared to play, it won't put him back.
> • It can't act on news that breaks after its last check, or when ESPN is slow to update a status.
> • It stops working if ESPN signs HangoverBot out. You'll need to sign in to ESPN again.
> • AI never makes these moves.
>
> **You're still the manager**
> HangoverBot can miss a problem, make a move you wouldn't have, or fail to make one. Some leagues don't allow outside tools to set lineups: check your league's rules, and tell your commissioner if they'd want to know.
>
> **Leagues with money on them**
> HangoverBot has nothing to do with entry fees or prizes and doesn't promise any result. A move it makes or misses could cost you points, games or prize money. [Liability wording for counsel.]

**Checkboxes** (all required, none pre-ticked):

- [ ] I manage this team on ESPN and I'm allowed to set its lineup.
- [ ] My league's rules allow a tool to set my lineup, or I've checked with my commissioner.
- [ ] I understand HangoverBot can make or miss a move, including in a league with money on it, and that my team is still my responsibility. [counsel]

**Buttons:** **[Turn on Bench Protection]** (greyed out until all three are ticked)  **[Use Ask Me instead]**

**Small print:**

> Bench Protection works only after you've added your email (claimed your account), so every automatic move is tied to you. You can switch back to Ask Me, or pause this league, any time in Settings.

**Sample receipt** (times in ET, as the beta writes them; `packages/service/src/words.ts` formats in America/New_York with an "ET" suffix):

> **Bench Protection · Sun 12:32 PM ET**
> Player A was ruled OUT at 12:31 PM ET.
> Moved Player B from bench to RB2. Moved Player A to bench.
> Checked on ESPN at 12:32 PM ET: done.

**Notes:**
- **Window:** match the code. The beta says 10 minutes, not 4.
- **3-a-day cap:** delete that line if the cap is removed after the first weekend.
- **Fourth checkbox (optional):** if counsel wants it, add "I understand ESPN doesn't endorse HangoverBot and could restrict my ESPN account."

### (c) Data safety and privacy summary

**In-app screen.** Title: **Your data**

| What | Why | Where | How long | How to remove it |
|---|---|---|---|---|
| ESPN sign-in session (SWID, espn_s2) | Read your league; change your lineup if you allow it | Encrypted in Supabase Vault | Until you disconnect or delete your account. If ESPN rejects it: [proposed: deleted after 30 days] | Disconnect ESPN, or Delete account |
| League, team and roster (including other teams' names in your league) | Watch your lineup | Our database (Supabase) | [proposed: end of season plus 90 days] | Delete account |
| Your settings: protection level, replacement order | Do what you chose | Our database | While your account exists | Delete account |
| Activity and receipts | Show you what we did; look into problems | Our database | [proposed: 2 years, for disputes] | Delete account. Lawyer: keep an unlinked copy? Apple's guidance allows keeping only data "the developer isn't legally required to maintain" to be deleted, so anything kept must be truly unlinked or legally required. Google allows retention "for legitimate reasons" if disclosed. |
| Email address (only if you claim your account) | Sign-in codes; important notices | Supabase, which also sends the codes | While your account exists | Delete account |
| Alert token for this phone | Send alerts | Expo; delivered by Google or Apple | Until you turn alerts off or delete your account | Delete account |
| Technical logs (never the content of requests to ESPN) | Keep the service running | Supabase | [proposed: 30 days] | Automatic |

**Below the table:**

> **We don't:** sell your data, share it for advertising, show ads, or track you across other apps. This version sends nothing to any AI service; if a future feature does, we'll ask first.
> **Who helps us:** Supabase (hosting, database, sign-in emails), Expo (alerts), Google and Apple (alert delivery).
> **Your controls:** Pause · Disconnect ESPN · Delete account (also at [web URL]) · Contact [email]

**Button:** **[Read the full Privacy Policy]**

**Draft store answers (to verify):**

| Data | Google Play Data safety | Apple App Privacy | Note |
|---|---|---|---|
| Email | Personal info › Email address; optional | Contact Info › Email Address; linked to you | |
| ESPN session | **Unsure.** SWID fits Personal info › User IDs ("an account ID, account number, or account name") [live definition; our reading]. espn_s2 possibly "Other info". | **Unsure.** SWID fits Identifiers › User ID ("other user- or account-level ID that can be used to identify a particular user or account") [live definition; our reading]. espn_s2 possibly Other Data. | Neither form's published category list has a "credentials" or "password" type (rechecked Oct 3). Ask counsel, and describe it fully in the policy either way. |
| HangoverBot user id | Personal info › User IDs | Identifiers › User ID | |
| Push token | Device or other IDs (Google's examples include "Firebase installation ID") | Identifiers › Device ID ("other device-level ID") | [inference] |
| League, roster, settings, receipts | App activity › "Other actions" (Google's example: "gameplay information") or "Other user-generated content" | User Content › "Gameplay Content" ("multiplayer matching or gameplay logic, or user-generated content in-game") or "Other User Content" | [inference]; definitions [live] |
| Crash data | None today | None today | Add when Sentry is added |
| Answers for every row | Encrypted in transit: yes. Deletion request: yes, once built. Shared: no. Google's User Data policy lets data be transferred "as necessary to service providers" and links that to the Data safety "sharing" help [mirror]. The form's exact service-provider exemption wording was not seen; check it. | Used to track you: no. Purpose: app functionality. | Must match the Privacy Policy |

---

## 6. Terms of Service and Privacy Policy outline

"**LAWYER FIRST**" marks the clauses a lawyer most needs to write.

### Terms of Service

| # | Clause | Why |
|---|---|---|
| 1 | Who we are; how you accept | One binding agreement for free and paid users. Dynasty Nerds' detailed terms reportedly bind only buyers, with a thinner combined page for site users [unverified]. |
| 2 | Eligibility: 18+, US only at launch | Contracts, paid leagues, and state law that varies |
| 3 | What HangoverBot is and isn't: a lineup tool, not a fantasy host, contest or betting service; never handles money | Keeps us outside gambling and contest rules |
| 4 | **LAWYER FIRST.** Not affiliated with ESPN, Disney or the NFL; trademarks belong to their owners | Disney §2.B.vii; Apple 4.1(c), 5.2.1; Google impersonation rule |
| 5 | **LAWYER FIRST.** Your authorisation: you appoint us to use your ESPN session to read your team and, at the level you choose, change your lineup. Scope limits. Revocable any time. | Neither competitor appears to have this, and we act unattended |
| 6 | **LAWYER FIRST.** ESPN's terms and your ESPN account: the risk of restriction; we stop if ESPN objects; the service may end without notice for that reason | Disney §1.F, §2.B, §1.H (2024 archive copy); *Power Ventures* [recall] |
| 7 | **LAWYER FIRST.** Authority levels and automatic moves: what each level does, the window, the safeguards, receipts; consent recorded; how we change safeguards (with notice) | Ties the Terms to the screens; limits what users can claim we promised |
| 8 | **LAWYER FIRST.** Liability for automatic moves: no guarantee, a cap, and exclusion of lost points, standings, fees and prize money as far as the law allows | The largest money exposure. FantasyPos' reported total exclusion may not hold [inference]. |
| 9 | **LAWYER FIRST.** Paid leagues: we don't handle money; your league's money is between you and your league; no promised results | Users may be in paid private leagues |
| 10 | Your responsibilities: follow league rules, manage only your own team, keep an eye on your lineup | Puts compliance with league rules on the user, who knows them |
| 11 | No guarantee about data: ESPN and data providers can be wrong or late; statuses change | Injury news moves faster than any check |
| 12 | Receipts are the record; a window to report a problem | Makes disputes answerable |
| 13 | AI (future): AI only recommends, from options the rules engine gives it; separate consent before any AI feature | Product rule; Apple 5.1.2(i) |
| 14 | Fees, renewal, cancellation, refunds, store billing (when paid, and renewal only if it is a subscription) | Auto-renewal laws [recall]; FantasyPros and Dynasty Nerds reportedly keep this in help pages |
| 15 | Beta terms: features may break; feedback licence | The current state of the product |
| 16 | Acceptable use: no connecting accounts that aren't yours; no reverse engineering or abuse | Protects other league members and us |
| 17 | Suspension and termination by either side; ESPN session deleted when it ends | Data hygiene; Disney exposure |
| 18 | Changes to the service and the Terms: in-app notice; re-consent for anything that widens what we do | Better than "without notice" |
| 19 | Disputes: arbitration with class waiver and opt-out, or courts; governing law; small claims | Must be decided before launch |
| 20 | Indemnity, narrow | Lawyer to decide whether to include one |
| 21 | Intellectual property and licence to use the app | Standard |
| 22 | App store terms Apple and Google require in a custom licence agreement [recall] | Store compliance |
| 23 | Notices and contact | Standard |

### Privacy Policy

| # | Clause | Why |
|---|---|---|
| 1 | Who we are, contact, effective date; labelled "Privacy Policy"; names TurboLabs as on the store listing; public, non-geofenced URL, not a PDF | Required by both stores; Google lists these explicitly [mirror] |
| 2 | **LAWYER FIRST.** What we collect, naming the ESPN session for what it is: a sign-in that lets us act as you | Honest where FantasyPros' "not … personally identifiable" isn't. It may be a "security credential" under breach laws [recall]. |
| 3 | Data about other people: other teams' and managers' names that ESPN shows us | They never agreed to anything; Apple 5.1.1(viii) |
| 4 | How we use it; no new uses without asking | Apple 5.1.2(ii) |
| 5 | Service providers (Supabase, Expo, Google and Apple push); Anthropic and Sentry only when added; providers give equal protection | Google's privacy-policy contents rule; Apple 5.1.1(i) |
| 6 | No selling, no advertising, no tracking | Must match the store labels |
| 7 | Security: encryption, Vault, no logging of ESPN requests, staff access | Google requires "Secure data handling procedures" in the policy |
| 8 | Retention, per data type, including anything kept after deletion and why | Both stores require it; neither competitor appears to state one for stored sessions |
| 9 | Your controls: pause, disconnect, delete (in app and on the web), withdraw consent, access and correction | Apple 5.1.1(i), (ii), (v); Google account deletion |
| 10 | **LAWYER FIRST.** Breach notification, including for ESPN sessions | State laws [recall] |
| 11 | State privacy rights, as they apply | Lawyer to set the scope |
| 12 | Children: under 18 not allowed; deletion if found | |
| 13 | Push notifications | |
| 14 | AI (future): what would be sent, and the consent | Apple 5.1.2(i) |
| 15 | Changes and notice | |

---

## 7. Open questions for the lawyer

**ESPN and Disney**

1. Using a user's own ESPN session, at their request, to read and change their own lineup on a schedule: does it break any of these Disney terms? Who bears that risk: the user, us, or both?
   - §2.B.x (automated means)
   - §2.B.viii (business use, including "enable third parties")
   - §1.F (sharing account information)
   - §3.I (automated gameplay)
2. Should we ask ESPN or Disney for written permission before a public launch? What is our exposure under computer-access laws (federal and state) before and after any objection from Disney?
3. Does a clause in our Terms appointing us as the user's agent help, or does it make things worse given ESPN's terms?
4. Must we tell users their ESPN account could be restricted? Is the draft wording right?
5. Would our own invited co-manager account change the analysis?

**Automatic moves**

6. How far can we limit liability for a move made, missed or failed, including where prize money is at stake? Which cap is enforceable for free users and for paid users?
7. Do statements like "checked on ESPN before and after" or "you're covered" create a warranty? What wording avoids that?
8. Is the checkbox set in screen (b) enough consent? Should Bench Protection be re-confirmed each season?
9. If we add an Undo, does that change our duty when a move is wrong?

**Paid leagues and gambling**

10. Does helping users in private leagues with entry fees expose us under state gambling or social-gambling laws? Should we exclude any states?
11. Could Missouri- or Maryland-style "script" rules ever reach a tool used in private ESPN leagues? Does automation affect the "skill" analysis?
12. Should we ask users whether their league is paid, and act differently if it is?

**App stores**

13. Apple 5.2.2 ("Authorization must be provided upon request") and 5.1.1(v): does ESPN count as a "social network"? Is an iOS launch realistic without Disney's permission?
14. Google Play's Device and Network Abuse policy: how do we answer "violates its terms of service" (and "game cheating")? How do we answer the phishing definition, which covers code that intercepts credentials?
15. How do we give reviewers access without breaking Disney §1.F? Is a public sample-league mode enough? (Apple accepts a built-in demo mode in place of a demo account only "with prior approval by Apple".)

**Privacy and security**

16. Is the ESPN session "personal information" or a "security credential" under state breach laws? What security standard and insurance should we have?
17. Which state privacy laws apply to us at launch?
18. How do we cover other league members' data that ESPN shows us, including under Apple 5.1.1(viii)?
19. Can we keep receipts after a deletion request, to handle disputes, if they are unlinked from the user? Apple's guidance contemplates keeping only data we are "legally required to maintain"; Google allows disclosed retention "for legitimate reasons such as security, fraud prevention, or regulatory compliance".
20. Does an anonymous, unclaimed session count as an "account" for Google's deletion rule? Apple's guidance says automatically generated "guest" accounts should be deletable, so plan for it on iOS.

**Contracts and company**

21. Should Terms acceptance be a checkbox or "by tapping you agree"? What consent records should we keep?
22. Arbitration with a class waiver, or courts? Which governing law and venue for TurboLabs? Is TurboLabs a registered entity that can submit to the stores?
23. Minimum age: 18 everywhere, or 21 in some states because of paid leagues?
24. Trademarks: can the listing say "works with ESPN Fantasy Football"? Has "HangoverBot" been cleared? Can marketing use "insurance"?
25. Before the paid tier: auto-renewal law requirements, if it renews.
26. Before AI Rescue: Anthropic's data terms and Apple 5.1.2(i) consent. Also confirm the owner's pending decision that adds, drops and IR stay recommendation-only (`DECISIONS.md`).
27. The beta: the owner tests on their own league this weekend. Should their league mates be told?

**What to give the lawyer with this brief:**
- the current live Disney Terms of Use. Pull it fresh: we only saw a "Last Updated: May 24, 2024" archive copy, from a repository that stopped recording in Sept 2024.
- screenshots of the app's sign-in, Protection and Settings screens
- the automation rules in `docs/BETA.md`
- the data list in 5(c)

---

## Fact-check notes (Oct 3, 2026)

**How this pass worked.**

- **No new searches were possible.** The session's WebSearch budget (200) was already used, so no claim could be re-searched.
- **Direct fetches were blocked for most sources:** fantasypros.com, support.fantasypros.com, dynastynerds.com, support.dynastynerds.com, apps.apple.com, play.google.com, chromewebstore.google.com, support.google.com, disneytermsofuse.com, revisor.mo.gov, uscode.house.gov, web.archive.org.
- **What could be read:** Apple's developer pages (via WebFetch), developer.android.com, and raw GitHub mirror files with their git history.

**Corrections made (source; saw wording or inferred):**

1. **"We go further than either" was overstated** (short version 2; section 2 permission row).
   - The brief's own FantasyPros row describes Auto-Pilot "Auto-Submit" acting unattended, several times in the hour before games.
   - Corrected to: comparable to Auto-Pilot, narrower in scope, but with no undo.
   - Source: internal inconsistency; FantasyPros wording unverified.
2. **"Their legal documents are older than these features" was wrong for FantasyPros' Privacy Policy.** Nov 2020 is after the July 2020 ESPN extension sync the brief itself cites. Internal inconsistency; both dates unverified snippets.
3. **"Dynasty Nerds binds only buyers" contradicted the brief's own note** that a combined Privacy Policy/Terms page covers site users. Reworded. Source unverified.
4. **The Disney archive is staler than stated.** The ToS;DR repo's last commit of any kind is 2024-09-11, and the Disney file's last recording is the same day (git history of github.com/tosdr/tosdr-snapshots; saw).
5. **The Disney §3.I quote was spliced with "[or]".** Replaced with the full sentence, and noted the section heading is "Malware" (raw ToS;DR file; saw).
6. **Disney §2.B.viii was truncated.** It includes "or engage in any activity to enable third parties to engage in any of the foregoing activities". Added §2.A "personal, noncommercial use only" and §3.H. The changes clause is now quoted verbatim (raw ToS;DR file; saw).
7. **"If Disney enforces, the user's ESPN account is what gets restricted" was incomplete.** Disney could also act against HangoverBot (inference; *Power Ventures* recall).
8. **Google's disclosure rule is conditional** ("reasonable expectation" test). The short version now says so (OpenTermsArchive raw User Data file; saw).
9. **Google consent bullets.** Added the omitted "Must present the consent dialog clearly and unambiguously" and the full "as a means of obtaining user consent" ending (same file; saw).
10. **Google deletion and privacy-policy rules.** Added the Play Console web-link requirement, the retention allowance, and the privacy-policy content and URL rules (same file; saw).
11. **Google phishing and game cheating.** Added the phishing definition (credentials "intercept[ed]"), "Game cheating apps that affect the gameplay of other apps", and the full gambling-ads companion-functionality wording (OpenTermsArchive raw program-policies file; saw).
12. **Google Play snapshot dates confirmed:** User Data Oct 2, 2026; program policies Aug 26, 2026 (git history of OpenTermsArchive/vlopses-us-versions; saw).
13. **Data safety URL moved.** developer.android.com `/guide/topics/data/collect-share` now redirects to `/privacy-and-security/declare-data-use`. The quote was confirmed; data-type definitions were added (live page via curl; saw).
14. **Apple 4.8 was outdated.** It no longer requires "Sign in with Apple" by name; it requires an equivalent privacy-focused login, with an exemption for the company's own sign-in (developer.apple.com/app-store/review/guidelines; saw via fetch summary).
15. **Apple additions:**
    - 2.1(a): a demo mode needs Apple's prior approval.
    - 5.1.1(ix) also covers apps "that require sensitive user information".
    - 5.1.1(viii) on compiling personal information is now cited.
    - 5.1.1(i) privacy-policy contents.
    - Apple's news page lists the Nov 13, 2025 update (4.1(c), 5.1.2(i)) and Feb 6, 2026 as the latest.

    Same source, plus developer.apple.com/news; saw via fetch summary.
16. **Apple account deletion: guest accounts.** Apple says automatically generated "guest" accounts should be deletable, and that deletion covers data the developer "isn't legally required to maintain". Questions 19 and 20 and table 5(c) were updated (developer.apple.com/support/offering-account-deletion-in-your-app; saw via fetch summary).
17. **TestFlight confirmed.** External testers need the first build approved by App Review for TestFlight; internal testers are up to 100 team members with listed roles (developer.apple.com/testflight; saw via fetch summary).
18. **Android sideloading.** Added the developer-verification timeline: Sept 30, 2026 in four countries, global in 2027 (developer.android.com/developer-verification; saw via fetch summary).
19. **UIGEA conditions were incomplete.** Added the "current membership of an actual team" condition, the prize-value rule and the "predominantly by accumulated statistical results" wording (legalize-dev mirror, release point 119-73; saw).
20. **Missouri.**
    - Tagged [mirror], but revisor.mo.gov is the official site and was never reached. Retagged as an unverified snippet.
    - The "§313.905(15)" location is doubtful; it may be §313.900 [recall].
    - "That describes us" was replaced with an inference that the statute targets licensed contest platforms.
21. **"Both stores' impersonation rules expect" a disclaimer was overstated.** They forbid implying a relationship; a disclaimer is one way to comply (Google program-policies mirror and Apple guidelines; saw; conclusion inferred).
22. **"completely discreet" was in quotation marks but tagged paraphrased.** It is now paraphrased without the quote.
23. **2019 "never keep" vs 2020 cookie storage** is now presented as an outdated statement, not a contradiction (unverified snippets; inference).
24. **"$4.99 product" was described as a subscription.** The handoff calls it a "Base purchase" and says pricing is "intentionally unresolved", so renewal terms apply only if it renews (`/home/user/hangover-bot/docs/HANDOFF-2026-10-02.txt`; saw).
25. **"Roster insurance" is internal positioning,** not yet marketing copy (same file; saw).
26. **Store data categories refined.** SWID maps to "User ID" in both forms; league data to "Other actions" or "Gameplay Content" (developer.android.com and developer.apple.com/app-store/app-privacy-details; saw definitions; mapping inferred).

**Confirmed unchanged:**

- **Disney** §1.E, §1.F, §1.H, §2.B opening, vii, ix, x, xi and the ESPN product definition (raw ToS;DR copy).
- **Google** (raw mirror): "authentication information", all six disclosure bullets, the model sentence, the privacy-policy field rule, the deletion wording, the malware objective, "Use official APIs…", the Device and Network Abuse ToS example, the impersonation and metadata lines, the reviewer line, the DFS AO rating and licence rules, and the "wager, stake" sentence.
- **Apple** (live): 5.2.2, 5.1.1(v), (vi), 5.1.2(i), (ii), 4.1(c), 2.3.7, 2.3.1(a).
- **Statutes** (mirrors): Virginia §59.1-556 and UIGEA §5361(b).
- **Repo facts:**
  - the 90/10 window in `docs/BETA.md` and `apps/mobile/app/protection.tsx`
  - the sign-in line in `apps/mobile/app/connect/espn.tsx`
  - no consent, disconnect, deletion, Terms, Privacy or affiliation strings in `apps/mobile/app/`
  - `DECISIONS.md` risk 1
  - ET receipts in `packages/service/src/words.ts`
  - co-managers in `/home/user/rr-draft-megacast/CLAUDE.md`

**Still unverified:**

- **Competitors and store listings:** every FantasyPros and Dynasty Nerds claim, including company names, hosts, Auto-Pilot modes, defaults and schedule, Co-Pilot, Waiver Planner, document dates, liability, indemnity, refund and arbitration terms, and the Yahoo paid-league block. Also the FantasyPros App Store label, the Dynasty Nerds Play label and the Chrome Web Store listing.
- **Disney:** the current live Disney Terms, and whether any revision since May 24, 2024 changed the sections cited.
- **State law:** the Missouri and Maryland wording and section numbers; Washington's treatment of paid fantasy.
- ***Power Ventures*** and its later treatment.
- **Google Data safety:** the service-provider exemption wording, and Play's reviewer-access requirements.
- **ESPN:** whether ESPN has paid-league write limits or its own auto-start feature.
- **Apple quotes** came through a summarising fetch tool and need a word-for-word check before reuse.