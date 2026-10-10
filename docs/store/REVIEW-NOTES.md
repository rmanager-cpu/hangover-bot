# RosterBots: Play Console declarations draft (2026-10-09, corrected)

Scope: the four content items the task asked for. Everything else in App content (privacy policy URL, Data safety, account deletion, target audience) is listed in the other agents' research and is only cross-referenced here. Package `com.turbolabs.hangoverbot`, version 0.1.0, Expo SDK 57, branch `claude/vigilant-fermat-qooyqm` at `ec56b08`.

Play Console path for every section below: **Play Console > (your app) > Policy and programs > App content** (Google's pages print it as both "Policy > App content" and "Policy and programs > App content"; the Dashboard "Set up your app" checklist links to the same forms).

Corrections in this version were checked against the app code on `ec56b08` (`apps/mobile/app/*`, `src/lib/*`, `packages/service/src/decide.ts`, `supabase/functions/espn-connect`, the migration) and against support.google.com answers 14151465, 9859455, 9859655, 9845334, 9867159, 13849271, 14738291 and docs.expo.dev/eas/json, all fetched 2026-10-09. Anything still unsettled carries [VERIFY].

---

## (a) App access ("Sign-in details")

### What Google needs and why it matters here

Play's app-access rule: if all or part of the app sits behind a login, credentials or other authentication, you give the reviewer working access details for each login scenario (up to five sets) plus an "Any other instructions" field (Google names this field for one-time passwords, MFA and unusual logins). Without them the reviewer cannot reach the ESPN-gated screens (What we read, Home, Activity, Settings) and the submission can be rejected; after fixing, you resend from Publishing overview > "Send for review". [VERIFY: the exact rejection wording; Google's page does not print one.]

RosterBots has two gates:

1. **ESPN sign-in** (required to reach anything past Welcome and the provider list). This is ESPN's own login page (`https://www.espn.com/login`, Disney's sign-in) in a WebView; RosterBots never reads the password. Welcome also offers "Already claimed an account? Sign in", which the reviewer should ignore.
2. **Email code** (optional: claiming the account, and signing in to a claimed account). "Fix it automatically" (Bench Protection) is the only feature behind it; an unclaimed account that picks it works as "Ask me first".

So: declare that some functionality is restricted [VERIFY: the radio-option wording on the live form], add **one instruction set for ESPN**, and explain the email-code gate in "Any other instructions" with a reviewer-reachable mailbox or an explicit "you may skip this".

### Do NOT use the owner's real ESPN account

The sign-in details are visible to Google's review staff and are stored in Play Console for the life of the listing. A real ESPN login gives whoever holds it the power to change the owner's real lineups, drop players and read the owner's Disney profile. Provide a **dedicated throwaway ESPN account that is a member of a league built for review**.

Accepted risk, recorded: Disney's terms (§1.F, per `docs/research/TERMS-AND-CONSENT-2026-10-03.md` 4.1-4.2) forbid sharing account credentials, and handing a password to Google's reviewers is sharing. The beta has no sample-league or demo mode, and Google disallows reviewer-only behaviour, so the throwaway account is the only route; the exposure is limited to that account.

### Test account setup (do this before the first closed-testing release)

ESPN league-creation mechanics were not verified against ESPN's site; treat the bullets as the owner's checklist, not ESPN documentation.

1. **Create a new email mailbox** the owner controls, e.g. a second Gmail address such as `hangoverbot.review@gmail.com`. It receives Disney's account emails and, if you choose, the RosterBots claim codes for the reviewer.
2. **Create a Disney/ESPN account** on that email at `espn.com/login` (Create account). [VERIFY: Disney's minimum age; use an adult birthdate regardless.] **Do not turn on two-step verification / MFA** on this account; the reviewer cannot receive codes. Keep the password in a password manager, never in the repo.
3. **Create a free ESPN Fantasy Football league** with that account as commissioner at `fantasy.espn.com`. Smallest allowed size [VERIFY: ESPN's minimum, believed to be 4 teams], standard scoring and roster, free. Run an **autodraft** so every team has a full roster [VERIFY: that a commissioner can fill and autodraft unowned teams]. Name the league plainly ("RosterBots Review League").
4. **Optional:** join the same league with the owner's personal ESPN account (or a second throwaway) so one other real manager keeps it active and the owner can watch from the other side. Not required: the autodrafted dummy teams are enough for the app to work.
5. **Keep that league and account alive**: ESPN rolls leagues over each season; the account must still open the app in the next season's review too. Set a calendar reminder for August. [VERIFY: what "What we read" and `connection-setup` show for that league once the 2026 NFL season has ended; the app reads the current season by default.]
6. **Do NOT sign in with the throwaway on the owner's own RosterBots install.** `credentials` is unique per (user, provider) and `store_credential` replaces the existing Vault secret, so a second ESPN sign-in on the owner's account overwrites the owner's real ESPN session and the owner's league then reads "wrong team" (`supabase/functions/espn-connect/index.ts:82-88`). Also, the test swap's receipt and `write_verified_at` belong to the connection of the user who ran it (`packages/service/src/decide.ts:214-222`); the reviewer's install starts a fresh anonymous Supabase user, so nothing pre-run by the owner carries over unless the reviewer signs in to that claimed account by email code. If a populated Activity screen matters: use a second phone or a fresh install, claim that account with the review mailbox, run the test swap and swap back there, and tell the reviewer to use "Already claimed an account? Sign in" with the review mailbox (needs the mailbox shared and Supabase email delivery working, see section d). Otherwise skip the pre-run; the reviewer can run "Test swap" themselves.
7. Caveat: **Disney may challenge sign-ins from unfamiliar IPs** (Google's reviewers sit on Google IPs, often outside the US). [VERIFY: not observed; a possibility from the research notes.] If Disney emails a "verify it's you" code, the reviewer can only read it if the ESPN account's mailbox is the one you share in "Any other instructions". If you would rather not share the mailbox, say explicitly that Disney may email a code and ask the reviewer to retry; expect a possible rejection cycle.

### Play Console form: field by field

**App content > App access** (Google's page calls the section "Sign-in details")

- The restricted-access answer: choose the option saying some or all functionality is restricted. [VERIFY exact wording.]
- "+ Add new instructions" > name the set `ESPN fantasy account (required to use the app)` [VERIFY: whether the form has a separate name field]
- **Username / email**: `<throwaway ESPN email>`
- **Password**: `<its password>`
- **Any other instructions**: the long version below. [VERIFY: character limits; Google's page states none. The short version is there in case the long one is truncated.]

**Short version:**

> Tap "Sync a League" > "ESPN" > sign in on ESPN's own page (opens inside the app) with the email and password above. Pick the league "RosterBots Review League" and tap "This is my team". On "What should RosterBots do if a starter is ruled OUT?" pick "Ask me first", then "Continue". On "Claim your account" tap "Skip for now". Home, Activity and Settings are then available.

**Long version ("Any other instructions"):**

> RosterBots is a companion app for ESPN Fantasy Football. It needs an ESPN account that belongs to a fantasy league; it cannot be used without one. Use the test account above; it belongs to the developer and is a member of a free test league created for review. You may change its lineup freely.
>
> Steps:
> 1. Open the app. Welcome screen > tap "Sync a League". (Ignore "Already claimed an account? Sign in".)
> 2. Choose "ESPN" (other providers are shown as "Coming soon").
> 3. ESPN's sign-in page (Disney login, hosted by ESPN) opens inside the app. Enter the email and password above. The app does not read the password; when ESPN finishes signing in, the app continues automatically after a few seconds. If ESPN shows an "is this you" / verification-code prompt, retry sign-in [VERIFY and, if the mailbox is shared: "the code is sent to the same email address"].
> 4. Pick the league "RosterBots Review League" (if the list is empty, paste the league link or type the league ID into "League link or ID" and tap "Watch this league"). League ID: `<id>`.
> 5. "What we read from ESPN" shows the roster the app sees. Tap "This is my team" to continue. "Start a test swap" swaps any two players whose games have not started (for example a WR and the FLEX) on ESPN, reads the team back to check, and offers "Swap back"; it is safe to try on this account.
> 6. "What should RosterBots do if a starter is ruled OUT?": pick "Ask me first" (or "Tell me"), then "Continue". "Fix it automatically" requires claiming the account by email code (see 7) and is not needed for review.
> 7. "Claim your account" (email + 6-digit code) is OPTIONAL. Tap "Skip for now" to continue. If you want to test it, use the email `<review mailbox>`; the 6-digit code arrives there within a minute, or we can read it for you on request via the contact email in Store settings. [Delete this sentence if the mailbox is not shared.]
> 8. Home shows "You're covered" or "Action needed" (or "Signed out of ESPN" / "Paused"), the next kickoff and the watched starters. Activity lists receipts and proposals with Approve / Decline. Settings has "Watch this league", Protection, Replacement order, "Sign in to ESPN again", "Watch another league", "Forget my ESPN sign-in", Claim / Sign in, Alerts and About.
>
> Notes for review:
> - The app changes the ESPN lineup on demand only when you tap "Swap them" in the test swap or "Approve" on a proposal. Automatic moves exist only for a claimed account set to "Fix it automatically", only between 90 and 4 minutes before an NFL kickoff, only to fill a hole (a starter who is OUT, on IR, suspended, on bye, projected for zero points, or an empty slot), and only after one change made through the app has been seen on ESPN. On "Ask me first" nothing changes on ESPN without your tap. Outside game windows the Home screen simply reports the next check.
> - The app asks for notification permission once on first reaching Home (for lineup alerts). Declining it does not block anything; everything also appears in Activity.
> - No purchases, no ads, no chat, no user-generated content shared with other users.
> - RosterBots is not affiliated with ESPN or The Walt Disney Company.

Fill in `<id>` (ESPN league ID from the league URL, `leagueId=...`), the throwaway email and the password before saving. Re-check this form whenever the ESPN account's password changes; a stale password means the reviewer cannot get in.

### Store listing lines that back this up

- Full description must say: requires an ESPN Fantasy Football account and league; not affiliated with ESPN or Disney. Names only, never the ESPN logo (brand rule, `docs/brand/README.md`).
- Store settings > contact email: the address Google and users can reach; it is shown publicly. Use the same support mailbox the privacy policy names.

---

## (b) Content rating questionnaire (IARC)

Path: **App content > Content rating > Start**. Enter the email IARC will use, select a category, answer, review the Summary, Submit. Redo it when an update changes content or features in a way that affects the answers; misrepresentation can get the app rejected, removed or suspended (answer/9859655). Google re-words questions from time to time; the answers below are by topic.

| Step / question (topic) | Answer | Why |
|---|---|---|
| Email address | the developer contact email | IARC correspondence goes there |
| App category | **Utility, Productivity, Communication, or Other** | Not a game, not social, not entertainment/media. [VERIFY: Google's page does not list the categories; pick this one unless the live form offers a closer fit.] |
| Violence (realistic, cartoon, fantasy, towards humans/animals, blood, gore) | **No** to all | No depicted violence; American football appears only as player names, teams and kickoff times, with no video or imagery |
| Fear / horror content | No | |
| Sexuality / nudity / suggestive content | No | |
| Language (profanity, crude humour) | No | In-app copy checked (`apps/mobile/app`, `apps/mobile/src`); avoid any added "hangover" jokes with swearing |
| Controlled substances: references to or use of alcohol, tobacco, drugs | **No** | The product name "RosterBots" is the only hint. A grep of `apps/mobile/app`, `apps/mobile/src`, `docs/brand/README.md`, `docs/PRODUCT.md`, `docs/BETA.md` for alcohol/drink/beer/drunk/hungover finds nothing beyond the name. Keep it that way: a "references to alcohol" Yes raises the rating (ESRB Teen / PEGI 12-class), and this is the answer most likely to be queried. If the store listing or screenshots ever show drinking imagery, change this answer. |
| Gambling: real-money gambling, or facilitating betting | **No** | The app places no bets, takes no money, holds no prize pool and pays nothing out. Fantasy league membership and lineup management are not wagers; RosterBots has no knowledge of league entry fees and does not handle them |
| Simulated gambling (casino-style, in-app chips) | **No** | Nothing of the kind |
| Humour: crude / mature humour | No | |
| Miscellaneous: does the app share the user's current location? | **No** | Location is never requested; no location permission |
| Does the app allow users to purchase digital goods? | **No** | No IAP in the beta (if a paid tier ships later, redo the questionnaire) |
| Does the app allow users to interact or exchange content with other users (chat, UGC)? | **No** | No chat, no posting, nothing is shown to other users. The ESPN lineup change is sent to ESPN as the user's own action |
| Does the app contain advertising? | No | |
| Does the app promote or glorify any illegal activity? | No | |
| Does the app contain news/current affairs content? | No | |
| Anything from the categories above not covered? | No | |

Expected outcome: **ESRB Everyone / PEGI 3 / USK 0 / IARC 3+** (the Australian Classification Board and GRAC rate games only, so no ACB rating for this app). Expected, not guaranteed: review the Summary page before Submit; anything above Everyone means an answer was mis-ticked.

---

## (c) Other App content declarations

Each is a one-page form under **App content**. Suggested answers (option wording checked against Google's pages where noted):

| Form | Answer | Notes |
|---|---|---|
| **Ads** | **No, my app does not contain ads** | No ad SDKs in `apps/mobile/package.json`; keep it that way or redo the declaration. Must also match the Data safety form (no "Advertising or marketing" purpose) |
| **Advertising ID** | **No**, the app does not use the advertising ID | Its own App content declaration, required for apps targeting API 33+ (SDK 57 targets 36). [VERIFY: location in the console; Google's advertising-ID help page does not describe the form.] No ads/analytics SDKs |
| **Government apps** | **No** | Not made for or by a government entity |
| **Financial features** | **"My app doesn’t provide any financial features"** (tick that, certify, leave everything else blank) | Wording per answer/13849271; applies to closed testing, open testing and production. No payments, loans, crypto, trading, banking, money transfer. RosterBots never touches league fees. A future paid tier through Google Play Billing is still not a "financial feature" under this form |
| **Health apps** | **"My app doesn’t provide any health features"** | Wording per answer/14738291; applies to closed testing, open testing and production. Despite the name, nothing in the app concerns health, hangovers, medicine, fitness or wellbeing. Do not add health-flavoured listing copy (e.g. "cure your hangover"); it invites the Health declaration and a medical-claims review |
| **News** | **No, my app is not a news app** | Fantasy roster data is not news content |
| **Target audience and content** | Select **18 and over** only | The consent research (`docs/research/TERMS-AND-CONSENT-2026-10-03.md` lines 94, 114) sets 18+ as the eligibility rule; not yet recorded in `docs/DECISIONS.md`. Choosing any under-18 group pulls the app into the Families policy. Google's page (answer/9867159) has no "appeal to children" question; it says a listing whose graphics use "youthful animation or young characters" can be rejected unless the app targets under-13s. The brand mascot is a cartoon robot, so keep it small in store graphics, lead with the wordmark, and put "For adults 18+" in the listing. Optional on the same screen: "Restrict Minor Access" so users Google judges under 18 cannot find or install the app |
| **Data safety** and **Privacy policy** | Required before closed testing; see the other agents' research (`policies` and `audit` fact lists) for row-by-row answers | Not in this task |
| **Account deletion URL** (inside Data safety > Data deletion) | Required because the email claim creates an OTP-verified account | Not in this task; blocks closed testing, not internal testing |

[VERIFY: whether a COVID-19 declaration still appears on the App content page; no current help page for one was found. If it does, answer No.]

Consistency rule Google enforces: Ads = No, Advertising ID = No, Data safety has no advertising purpose, and the app binary contains no ad SDK. Any one contradicting the others triggers a policy query.

---

## (d) Closed testing: the requirement and a plan for 12 testers

**The rule in one paragraph.** A personal Play developer account created after 13 Nov 2023 cannot publish to production until it has run a **closed test with at least 12 testers opted in continuously for the 14 days before applying** (answer/14151465: "a minimum of 12 testers who have been opted in continuously for at least 14 days"; testers who opt in, test for fewer than 14 days and opt out do not count, and the days must be consecutive), after which the owner files "Apply for production" from the Dashboard and waits "seven days or less, but can occasionally take longer". "Complete app setup" (store listing, privacy policy, Data safety, content rating, App access) must be done before the closed test can start, and the Data safety, Financial features and Health declarations apply to closed testing (only the internal track is exempt). "Opted in" means the tester followed the opt-in link and accepted (Google: "testers receive an explanation of tester responsibilities and a link to opt in") and has not opted out since. [VERIFY: the button label; "Become a tester" is not on Google's page.] Google requires opt-in, not installs, but the application form asks how testers used the app and what feedback they gave, and accounts with little engagement may be told to keep testing, so each tester should also **install from Play and open the app at least a couple of times** (ideally sign in to ESPN, pick their league, see Home). Opting in needs a Google account; installing needs an Android phone. [VERIFY: whether a Google account that opts in but never installs counts toward 12; Google's page does not say, so recruit Android users.] Google's page does not say which closed track counts, so use one closed track and keep every tester on it.

Realistic calendar from today (Oct 9), best case: register and verify identity (up to 5 days) by ~Oct 14; the closed-test build cannot go live until the app changes below exist (privacy link, consent screen, delete account, email delivery), so first `.aab` upload and closed-test rollout ~Oct 16-17 at the earliest; 14 clean days takes you to ~Oct 31; apply; production decision by ~Nov 7. [VERIFY: NFL week numbering; if Week 1 was Sept 13, Nov 8 is Week 9, leaving weeks 10-14 plus playoffs.] The owner's own Sunday use via the sideloaded preview APK does not depend on any of this.

**Recruiting plan: aim for 15 opt-ins so 12 survive.**

1. **Pool 1, the owner's ESPN league.** A 10- or 12-team league gives 9-11 managers who already have ESPN accounts and want lineup protection. Ask in the league chat with the opt-in link and a two-line pitch: "Beta of the app that benches your injured starters before kickoff. Tap this link, opt in, install from Play, stay opted in through Nov 1. Takes two minutes." Expect 60-80% uptake and some Android-less people.
2. **Pool 2, friends and family with Android phones** (3-5 people). They do not need an ESPN league to opt in; they can stop at the Welcome screen. Say that plainly so nobody feels they must play fantasy (but see the engagement note above).
3. **Pool 3, a second league or a work/group chat** for the remainder. Anyone with a Google account and an Android phone.
4. Do not count the owner's developer account as a tester; it may or may not be counted and it is not worth the ambiguity.

**Mechanics in Play Console (phone browser works).**

- Testing > **Closed testing**. Use the default closed track (Google's page just calls it "Closed testing"; the API id is `alpha`) if you will ever upload through EAS: `build_submit` / `eas.json` `track` only accepts `production | beta | alpha | internal`, so a custom-named track such as "Beta" cannot be targeted from EAS, and EAS `beta` is the open-testing track. [VERIFY: the alpha = closed / beta = open mapping on Google's Play Developer API docs.] A custom closed track is fine if you upload the `.aab` by hand.
- **Testers** tab > Create email list "RosterBots beta" > paste the Google account emails (the address each person uses on their phone's Play Store, not their ESPN email) > Save. Alternative: a Google Group (`name@googlegroups.com`); the email list is simpler for 15 people.
- Create a release on the track > upload the production `.aab` (from `build_run` with the `production` profile and `gitRef` = this branch, or `build_submit` with `track: "alpha"` once a service-account key is on EAS) > roll out.
- Copy the **opt-in URL** (shown once the release is published) [VERIFY: which tab] and send it to the pool. Each tester: open link > accept the opt-in > "Download it on Google Play" > install.
- Keep a short feedback log (a note on the phone is enough): who installed, what they saw, anything that broke, and any Activity-screen receipts. The "Apply for production" form asks for exactly this (how recruiting went, whether testers used all features, feedback summary, what changed as a result).
- Check the tester list regularly [VERIFY: where Play Console shows the opted-in count]; if it dips below 12, recruit replacements immediately because the 14-day window is measured at the moment you apply.

**Things to have ready before the first closed-test release goes live, or the testers' first run fails or breaches policy** (none of these exist in the code on `ec56b08`):

- Privacy policy URL in Play Console and a tappable link in the app (Welcome and Settings), because closed testers will sign in with **real ESPN accounts** and the app will hold their real cookies and can change their real lineups (`docs/brand/README.md:98`: "No Terms/Privacy line yet").
- The prominent-disclosure/consent screen before the ESPN WebView (research doc section 4 and 5(a)).
- In-app "Delete my account" plus the web deletion URL ("Forget my ESPN sign-in" deletes credentials, connections, actions and activity but not the auth user or the `devices` row).
- Data safety, Financial features, Health, Advertising ID and content rating forms; App access credentials (section a).
- Supabase custom SMTP (or every tester's email invited to the Supabase organisation), otherwise the claim code never arrives and "Fix it automatically" cannot be turned on by anyone but the owner (`docs/DEPLOY.md`).
- An `.aab`, not the preview APK: new apps must upload an Android App Bundle.

**Application day (day 15+).** Dashboard > "Apply for production" > three sections (About your closed test, About your app, About your production readiness); answers save only on Next/Apply. Keep the ESPN review account and password current in App access at that moment, because the review that follows will use it.

---

## Open items for the owner (not decisions this draft can make)

1. Whether to share the throwaway ESPN account's mailbox with the reviewer (recommended: yes, it is a mailbox created only for this) or to rely on "retry sign-in".
2. Confirm "18 and over" as the target audience (it follows the consent research; it is not recorded in `docs/DECISIONS.md`).
3. The support/privacy contact email that will be public on the listing, in the privacy policy and in the IARC questionnaire.
4. The relayed message "Wait change my second answer. Use October 4 app side fixes." contains no numbered answers that this task asked, so it was not applied here; whichever workflow step asked the owner a second question should re-ask. For the record, the Oct 4 app-side fixes are two commits on this branch: `34af318` (`app/(tabs)/home.tsx`: Home says the first check is still to come instead of "no move") and `5c25887` (`src/lib/roster.ts`: Home lists a zero-projection starter as a problem); every other Oct 4 commit is engine/service/`_shared`. `main` is still the Sept 29 initial commit (`958a3ad`), 40 commits behind, so a build that must carry the Oct 4 fixes has to use `gitRef` = `claude/vigilant-fermat-qooyqm` (head `ec56b08`) or follow a merge to main. If the "second answer" was which branch/commit to build, that is the likely intent. [VERIFY with the owner.]

--- ASSUMPTIONS ---
Corrections were made from the code on `ec56b08` and from these official pages fetched 2026-10-09: support.google.com/googleplay/android-developer answers 14151465 (closed testing), 9859455 (App access / privacy policy), 9859655 (content rating), 9845334 (testing tracks), 9867159 (target audience), 13849271 (financial features), 14738291 (health apps), 6048248 (advertising ID), and docs.expo.dev/eas/json. The remaining Google/Expo facts come from the research JSON supplied by the other agents. Exact Play Console and IARC question wording changes over time, so answers are given by topic and option wording is quoted only where a page printed it.
ESPN league-creation mechanics (minimum team count, commissioner autodraft of unowned teams, league ID in the URL, season rollover, the Disney account minimum age) were not verified against ESPN's site.
Whether Disney challenges sign-ins from Google's review IPs is a possibility from the research notes, not a verified behaviour.
Target audience 18+ follows docs/research/TERMS-AND-CONSENT-2026-10-03.md (lines 94 and 114); it is not an owner decision in docs/DECISIONS.md.
Content rating answer 'no references to alcohol' rests on a grep of apps/mobile/app, apps/mobile/src, docs/brand/README.md, docs/PRODUCT.md and docs/BETA.md that found nothing beyond the product name; store listing text and screenshots do not exist yet and must keep to the same rule.
IARC rating outcome (Everyone / PEGI 3) is the expected result of the listed answers, not a guarantee; ACB and GRAC rate games only.
The timeline assumes registration today, no rejections, and that the privacy link, consent screen, delete-account path and email delivery are built before the closed-test release; it is built from Google's stated maxima (5 days verification, 14 days testing, ~7 days review). NFL week numbers are not in the repo and are marked [VERIFY].
Play Console character limits for the App access fields, the radio-option wording, the opt-in button label, the opted-in tester counter and the EAS alpha/beta track mapping were not confirmed on an official page and are marked [VERIFY].
