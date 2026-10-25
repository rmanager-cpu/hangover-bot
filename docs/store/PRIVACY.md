<!--
NOT LEGAL ADVICE. This is a working draft written from a code audit of the RosterBots
repository (branch claude/vigilant-fermat-qooyqm, HEAD ec56b08, re-checked against the code
and the Google Play, Expo and Disney pages on 2026-10-09). Have a lawyer review it before
publishing. Every statement marked [VERIFY] could not be grounded in the code or an official
page and must be confirmed or edited before this page goes live. Replace every [PLACEHOLDER]
before publishing. Host as an HTML page at a public, non-geofenced URL (not a PDF); Google
Play needs the same URL in Play Console > App content > Privacy policy and a tappable link
inside the app (none exists yet: docs/brand/README.md:98).
-->

# RosterBots Privacy Policy

**Effective date:** [PLACEHOLDER: date this page goes live]
**Last updated:** [PLACEHOLDER]

This is the privacy policy for the RosterBots mobile app (Android package `com.rosterbots.app`), made by TurboLabs. It explains what we collect, why, where it goes, how long we keep it, and how to delete it. It is written in plain English on purpose. If anything here is unclear, email us at the address in the Contact section.

RosterBots is not affiliated with, endorsed by, or sponsored by ESPN, The Walt Disney Company, or the NFL.

---

## 1. Who we are

RosterBots is made by **TurboLabs** [VERIFY: Google Play's User Data policy is satisfied because this page names the app; the open question is which legal name stands behind "TurboLabs". For a personal Play developer account Google shows the account holder's legal name on the listing, so state that name here too if it differs].

Privacy contact: **privacy@rosterbots.com**
Postal address: [VERIFY: whether a postal address is required where you operate; Google Play shows a full address only for monetising accounts]

---

## 2. What RosterBots does

RosterBots watches the lineup of your ESPN fantasy football team and, depending on the protection level you choose (Alerts, Ask Me or Bench Protection), either tells you, proposes a fix for you to approve, or makes the fix for you when a starter cannot score: out, on injured reserve, suspended, on bye, or projected for zero points. To do that it needs to read your league from ESPN and, if you allow it, change your lineup on ESPN. Everything below follows from that.

---

## 3. What we collect, and why

We collect only what the app needs to work. There are no ads, no analytics or crash-reporting SDKs, and no AI service receives your data in this version of the app.

### 3.1 A RosterBots user ID

When you first open the app we create an anonymous account for you on our server. It has a random user ID, and our sign-in service (Supabase Auth, Section 6) keeps the usual sign-in records for it: when the account was created and signed in, and [VERIFY: the phone's IP address and app version at its gateway]. This ID is attached to every record we keep about you (your league connection, settings, activity). Without it the app cannot remember which league is yours.

### 3.2 Your email address (optional)

We ask for an email address only if you choose to **claim** your account, or later **sign in** to a claimed account on another phone. We use it to send you a one-time sign-in code and to tie your settings to something you can get back if you lose your phone. The code emails are sent by our hosting provider, Supabase (see Section 6). [VERIFY: whether you will also use the email for service notices; the current app sends only sign-in codes.]

You do not need to claim your account to use RosterBots in Alerts or Ask Me mode. Claiming is required before the app will make any lineup change on its own.

### 3.3 Your ESPN sign-in session

See Section 4. This is the most sensitive thing we hold and it has its own section.

### 3.4 Your league, team and roster

After you sign in to ESPN and pick a league, we store: the league ID and name, your team ID and name, the season, and the most recent copy of **your own team's roster** as read from ESPN (player names, positions, pro teams, injury status, projected points, game times and opponents, and lineup locks). We keep only your team. Other managers' rosters and names are not stored.

We also store the settings you choose in the app (protection level, bench-swap permission, replacement order, daily move limit) and the timestamps of our last and next check.

### 3.5 Activity and receipts

Every time RosterBots finds a problem, proposes a fix, makes a move, or fails to make one, it writes a record so you can see what happened in the Activity screen. These records name the players involved. The server-side record of each move also keeps ESPN's reply (a status code and a short status message, never your sign-in session); that reply is not shown in the app. If you turn alerts on, the Activity text (title and body) is what we send as a push notification.

### 3.6 A push notification token (optional)

The first time the Home screen opens, the app asks for notification permission if your phone has not already decided (on Android 12 and older, notifications are allowed by default, so there may be no prompt). If notifications are allowed, the app asks Expo's push service for a token that identifies this phone for notification delivery and stores it on our server with the word "android" or "ios". To issue the token, Expo receives your phone's Google or Apple push address, the app's ID and our Expo project ID [VERIFY: what the library's device ID field carries]. We use the token only to send you RosterBots alerts. If notifications are not allowed, no token is created. The app has no "turn alerts off" control; turning notifications off in your phone's settings stops delivery but leaves the token on our server until your account is deleted.

### 3.7 What is stored on your phone

By RosterBots itself, two things: your signed-in session (so you stay signed in) and which league you last viewed. The in-app browser used for ESPN sign-in clears its cookies before and after sign-in (Section 4), but like any browser it may keep ordinary web-page data (cache, local storage) from ESPN's pages [VERIFY: whether to clear WebView storage and cache as well].

### 3.8 What we do not collect

- No name, phone number, location, contacts, photos or files.
- On our server, no device model, OS version or hardware identifiers (the app checks only whether it is running on a real phone or a simulator). Expo receives the push address described in 3.6.
- No usage analytics, crash reports or advertising identifiers.
- No ESPN password: you type it into ESPN's own page and we never see it.

---

## 4. Your ESPN sign-in

### 4.1 How it works

You sign in to ESPN inside a web view in the app, on ESPN's own login page. When ESPN finishes signing you in, it gives that page two session cookies (ESPN calls them `SWID` and `espn_s2`). RosterBots reads those two cookies from the phone's cookie store (or, if that store cannot be read, a small script the app runs on ESPN's page reads them), sends them once per sign-in to our server over HTTPS (again if you tap "Try again" after a failed handover), and then empties the in-app browser's cookie store on your phone. That store is also emptied before sign-in starts and when you leave the sign-in screen, whether or not sign-in finished.

During sign-in, your phone talks directly to ESPN and Disney's login pages, so they see your phone's IP address and whatever their own pages collect. Their terms and privacy policy apply to that step: https://privacy.thewaltdisneycompany.com/ [VERIFY: confirm this is the policy ESPN's login page links to].

### 4.2 Where it is kept

On our server the two cookies are stored **encrypted at rest** in a vault that our normal database tables cannot read. The app can never read them back; only our server code and, for maintenance, the developer with administrative access to our database can, and we use them only to talk to ESPN on your behalf. We never log the cookies, the requests to ESPN or their headers; we log only the outcome of each request (an HTTP status) and our own record IDs.

### 4.3 How long

Until you remove them (Section 8), until you replace them by signing in to ESPN again, until (if this phone was using an unclaimed account) you sign in to a claimed account on it, which deletes the unclaimed account's ESPN session at that moment, or until your account is deleted. [VERIFY: whether a session that ESPN has rejected should be deleted automatically after a set period; the code has no such rule today.]

### 4.4 How to remove it

Settings > **Forget my ESPN sign-in**. This deletes the encrypted session, your league connection, and all activity and proposals attached to it. Section 8 has the details.

---

## 5. What we send to ESPN on your behalf

All ESPN API traffic goes from **our server** (hosted by Supabase), not from your phone. ESPN sees our hosting provider's address for these requests. With your ESPN session we:

- read your league's roster, team, settings and status, and the NFL schedule, to check your lineup;
- look up the list of fantasy leagues on your ESPN profile so you can pick one;
- if you allow it, submit a lineup change (which players move into which slots for which week) to your team.

Nothing else about you goes to ESPN: not your email address, not your push token, not your RosterBots user ID. ESPN is acting as your own fantasy service, not as a provider working for us.

We check lineups on a schedule: about once an hour, every 15 minutes within 12 hours of one of your players' kickoffs, every 2 minutes within 100 minutes, and every minute in the last 10 minutes. Automatic moves are made only between 90 and 4 minutes before the affected kickoff.

---

## 6. Third parties who help us run RosterBots

We do not sell your data and we do not share it for advertising. The following companies process data for us so the app can work:

| Who | What they do for us | What they hold |
|---|---|---|
| **Supabase** | Hosts our database, our sign-in system, the encrypted vault for ESPN sessions, and the server code; sends the one-time sign-in code emails | Everything in Section 3, including your email address and user ID. Supabase keeps its own technical logs (such as request times and IP addresses at its gateway) [VERIFY: Supabase log retention and the project's hosting region; neither is recorded in the repository] |
| **Expo** (Expo push service) | Issues the push token and delivers push notifications | Your push token (and, to issue it, your phone's Google or Apple push address and the app's IDs), the notification title and text (which name players and the fix), and a small data tag so the app opens the right screen. Expo states it does not store notification contents longer than it takes to deliver them |
| **Google (Firebase Cloud Messaging)** | Final delivery of Android notifications, on Expo's behalf | The notification content above and a Firebase registration token for your phone [VERIFY: only once Android push is actually enabled with a google-services.json; today Android push is off unless that file is configured] |
| **Apple (APNs)** | Final delivery of iOS notifications, on Expo's behalf | The notification content above [VERIFY: only if an iOS build ships] |
| **ESPN / Disney** | Your fantasy football provider; see Section 5 | Your ESPN session and lineup changes, sent on your instruction |

[VERIFY: if a custom email provider (for example Resend or Postmark) is set up for sign-in codes, add it here as a processor of email addresses.]

No data goes to any artificial-intelligence service in this version. If a future version sends roster data to one, we will update this policy and ask you first.

---

## 7. How long we keep things

We keep data until you delete it or your account is deleted; we have no automatic clean-up today. [VERIFY: the retention periods below are proposals from the design notes and are **not implemented in code**. Either implement them or delete this table and keep only the sentence above.]

| Data | Kept until |
|---|---|
| ESPN session | You forget it, sign in to ESPN again, sign in to a claimed account from an unclaimed one, or delete your account. [VERIFY: proposed: also deleted 30 days after ESPN rejects it] |
| League, team, roster, settings | You forget your ESPN sign-in or delete your account. [VERIFY: proposed: end of season plus 90 days] |
| Activity and receipts | You forget your ESPN sign-in or delete your account. [VERIFY: proposed: 2 years, for disputes] |
| Email address | Your account is deleted [VERIFY: today deletion is by request to us (Section 8.2); there is no automatic path] |
| Push token | Your account is deleted [VERIFY: the app has no "turn off alerts" control that removes the token; turning off notifications in your phone's settings stops delivery but leaves the token on our server] |
| Anonymous accounts never claimed | [VERIFY: abandoned anonymous accounts are not cleaned up by any flow today; state a period, or implement one] |
| Technical logs | [VERIFY: proposed: 30 days; depends on Supabase settings] |

---

## 8. Deleting your data

### 8.1 In the app: Forget my ESPN sign-in

Settings > **Forget my ESPN sign-in**. This immediately and permanently deletes:

- your encrypted ESPN session from the vault;
- your league connection, roster copy and settings;
- all proposals, moves and activity records.

RosterBots stops checking your lineup from the next check (a check already under way may finish). Your RosterBots account itself (user ID, and email address if you claimed it) and your push token remain so you can sign in to ESPN again later.

### 8.2 Deleting your whole account

Settings > **Delete my account**. This permanently deletes your account and everything attached to it: your encrypted ESPN session, every league connection, your activity and receipts, and your push token. It works whether or not you ever claimed your account by email. Your ESPN account itself is not touched. This cannot be undone.

If you don't have the app, or can't open it, you can request the same deletion at
**[PLACEHOLDER: public URL for legal/delete-account.html once hosted]**. [VERIFY: confirm
the deletion is complete on the hosted database the first time it is used; the cascade and
the Vault clean-up trigger have only run in PGlite, never against a real project.]
[VERIFY: whether anything must be kept for legal, security or dispute reasons after a
deletion request; if so, say what and for how long, as Google requires.]

Deleting your RosterBots account does not change anything on ESPN. Lineup moves already made on ESPN stay as they are, and your ESPN account is untouched.

### 8.3 Removing RosterBots's access on ESPN's side

Your ESPN session is a sign-in token ESPN issued. If you want to be certain it can no longer be used, sign out of all devices or change your password on ESPN after forgetting your sign-in in RosterBots. [VERIFY: confirm with ESPN's account settings what invalidates `espn_s2`; the app's own Settings copy assumes a password change does.]

---

## 9. How we protect your data

- Every connection from the app, and from our server to ESPN and Expo, uses HTTPS.
- ESPN sessions are encrypted at rest in a vault that only server-side code (and the database administrator) can open; the app cannot request them.
- Our database enforces row-level access: the app can read and change only the signed-in user's own rows, and cannot read the vault pointer at all.
- The server never logs a request to ESPN, its headers or your session; it logs only outcomes (an HTTP status) and record IDs.
- RosterBots's own code writes nothing to the phone's logs; the operating system and app framework keep their usual technical logs.

No system is perfectly secure. If we learn of a breach affecting your data we will tell you [VERIFY: notification method and timeframe required where you and your users are].

---

## 10. Children

RosterBots is not for children under 13, and we do not knowingly collect data from them. ESPN and Disney apply their own age rules to ESPN accounts [VERIFY: Disney's Terms of Use state no specific age; check ESPN Fantasy's own rules]. If you believe a child has used RosterBots, email us and we will delete the account.

---

## 11. Your rights

Depending on where you live you may have the right to access, correct, export or delete your data, or to object to how we use it. You can see most of your data in the app (Settings, Home, Activity). For anything else, email the privacy contact below. [VERIFY: whether GDPR, UK GDPR, CCPA/CPRA or other laws apply, and add the specific rights, lawful bases and any data-protection representative required.]

---

## 12. Changes to this policy

We will post changes on this page and update the date at the top. If a change means we collect something new or send your data somewhere new (for example, to an AI service), we will tell you in the app before it takes effect.

---

## 13. Contact

**TurboLabs**
Privacy questions and deletion requests: **privacy@rosterbots.com**
[VERIFY: postal address, if required]

---

*ESPN is a trademark of ESPN, Inc. [VERIFY: check ESPN's own legal notice for the exact owner]. RosterBots is an independent app and is not affiliated with or endorsed by ESPN, The Walt Disney Company or the NFL.*

<!--
ASSUMPTIONS (2026-10-09 refutation pass)
- Code read directly: apps/mobile/src/lib/{session,supabase,push,espnSession,data,api}, apps/mobile/app/{connect/espn,connect/provider,claim,signin,welcome,(tabs)/settings}, supabase/migrations/20261003000000_beta.sql, supabase/functions/espn-connect/index.ts, supabase/functions/_lib/http.ts (grep), packages/connectors/src/espn/client.ts, packages/service/src/{push,read,ops}.ts, docs/BETA.md Mobile section, docs/DECISIONS.md, docs/research/TERMS-AND-CONSENT-2026-10-03.md.
- Official pages fetched 2026-10-09: Google Play account-deletion (answer/13327111) and User Data / privacy policy (answer/10144311); Expo push FAQ, expo-notifications SDK page, Expo privacy policy (updated Oct 21 2025); disneytermsofuse.com and privacy.thewaltdisneycompany.com.
- Retention periods in Section 7 remain proposals, not code.
- Oct 4 commits touching apps/mobile: 34af318 (Home copy) and 5c25887 (roster.ts, 2 lines). Neither changes what is collected, stored or sent; the policy reflects the branch head. The relayed message "Wait change my second answer. Use October 4 app side fixes." maps to nothing in this task (no numbered answers were asked here) and should be routed to the workflow step that asked the owner a second question.
- No file was written to the repository.
-->
