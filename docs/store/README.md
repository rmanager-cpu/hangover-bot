# Google Play submission drafts (generated 2026-10-09)

Drafts for the first Google Play submission of RosterBots (`com.turbolabs.hangoverbot`,
version 0.1.0, Expo SDK 57), written from the code on branch `claude/vigilant-fermat-qooyqm`
at `ec56b08` (which carries every Oct 4 fix, including the two app-side commits `34af318`
and `5c25887`) and from Google Play, Expo and Disney pages fetched the same day. They are
drafts: nothing here has been pasted into Play Console, no page is hosted, and anything
tagged `[VERIFY]` or `[PLACEHOLDER]` still needs a human. `main` is 40 commits behind this
branch, so any EAS build meant to match these drafts must use `gitRef` =
`claude/vigilant-fermat-qooyqm` or follow a merge.

| File | What it is | Lawyer? |
|---|---|---|
| `LISTING.md` | Store listing: app name, short and full description (character counts measured), release notes, category, tags, graphic-asset recipes and screenshot plan | No |
| `PRIVACY.md` | Privacy policy draft, written from a code audit. **Not legal advice.** | **Yes**, before it is hosted or linked anywhere |
| `DATA-SAFETY.md` | Data safety form answers, row by row, with the code citations behind each; the Data deletion questions; the flags where the form and the code disagree | Lawyer review recommended alongside `PRIVACY.md` (the two must agree) |
| `REVIEW-NOTES.md` | App access (Sign-in details) text for the reviewer and the throwaway ESPN account plan, the IARC content-rating answers, the other App content declarations, and the 12-tester closed-testing plan | No (but the credential-sharing risk under Disney's terms is recorded there as an accepted risk; a lawyer may want to see it) |

Needs a lawyer: `PRIVACY.md` (the whole document; also the retention table, which describes
proposals that are not implemented in code, and the children/your-rights sections, which
depend on where the owner and users are). `DATA-SAFETY.md` should be checked by the same
person so the form and the policy say the same thing.

Still needed before closed testing: the privacy policy hosted at a public address with an
in-app link to it, the deletion page (`legal/delete-account.html`) hosted, and a real email
sender for Supabase (or invited tester emails) so claim codes arrive. Done since these drafts:
the in-app Delete my account (Oct 10) and the disclosure-and-consent screen before the ESPN
sign-in (Oct 25, `apps/mobile/src/EspnConsent.tsx`).

## Owner's Play Console checklist

Derived from the policy facts gathered on 2026-10-09. Order matters: 1 to 4 gate
everything, 5 to 13 must be complete before the closed test can start, 14 to 16 are the
closed test itself. Confidence is the research's own grade: **verified** means read on the
cited official page; **likely** means the page does not address the exact case.

1. **Register a personal Play developer account** at play.google.com/console with the
   personal Google account: US$25 one-time fee on a real credit/debit card in the owner's
   legal name (no prepaid cards), 18+, accept the Developer Distribution Agreement.
   Source: https://support.google.com/googleplay/android-developer/answer/6112435 (verified)
2. **Verify identity**: have a government ID photo on the phone, a card in the same legal
   name, and verify the contact phone and email by one-time code. Budget up to 5 days before
   the first upload is accepted for review. Expect the owner's **legal name**, country and
   developer email to be shown publicly on the listing; "TurboLabs" can be the display name
   but does not replace the legal name on a personal account.
   Source: https://support.google.com/googleplay/android-developer/answer/13628312 (verified)
3. **Verify an Android device**: Console Home page task "Verify that you have access to an
   Android mobile device", install the Play Console app from the QR code, sign in as owner,
   tap Verify (non-rooted phone, Android 10+).
   Source: https://support.google.com/googleplay/android-developer/answer/14316361 (verified)
4. **Check the Home page for an Android developer verification "register your app" task**
   after identity verification; Play Console is expected to handle registration for a new
   app, but confirm there.
   Source: https://support.google.com/googleplay/android-developer/table/12921780 (likely)
5. **Create the app** (name from `LISTING.md`, Free, App): acknowledge the Developer Program
   Policies and US export declarations, accept the Play App Signing terms. Let Google
   generate the signing key; let EAS own the upload keystore (never download or import it).
   Sources: https://support.google.com/googleplay/android-developer/answer/9859152 (verified);
   https://support.google.com/googleplay/android-developer/answer/9842756 (verified)
6. **Store listing** from `LISTING.md`: name (30), short description (80), full description
   (4,000), 512x512 icon, 1024x500 feature graphic (required), at least two phone screenshots
   (four at 1080x1920 recommended, no alpha, long side at most 2x short side), category
   Sports, a public contact email in Store settings.
   Sources: https://support.google.com/googleplay/android-developer/answer/9859152 (verified);
   https://support.google.com/googleplay/android-developer/answer/9866151 (verified)
7. **Privacy policy**: host `PRIVACY.md` (after lawyer review) as a public HTML page, not a
   PDF; enter the URL in App content > Privacy policy; add a tappable link in the app
   (Welcome and Settings). Required for every app, even before the Data safety form.
   Sources: https://support.google.com/googleplay/android-developer/answer/10144311 (verified);
   https://support.google.com/googleplay/android-developer/answer/9859455 (verified)
8. **Data safety form** from `DATA-SAFETY.md` (App content > Data safety). Mandatory before
   closed, open or production tracks; exempt only while the app is on the internal track.
   Inaccurate answers lead to blocked updates or removal.
   Source: https://support.google.com/googleplay/android-developer/answer/10787469 (verified)
9. **Account deletion**: ship an in-app "Delete my account" path (an in-app link to the web
   page is acceptable) and host a public deletion-request page naming RosterBots or
   TurboLabs as on the listing; enter its URL in the Data deletion section of the Data
   safety form. "Forget my ESPN sign-in" alone does not satisfy this (the auth user and the
   push-token row survive). The app is treated as in scope because the email claim creates
   an OTP-verified account; the anonymous session is not an exemption Google offers.
   Source: https://support.google.com/googleplay/android-developer/answer/13327111
   (requirement verified; scope for anonymous-plus-claim is likely)
10. **App access (Sign-in details)** from `REVIEW-NOTES.md` section (a): a dedicated
    throwaway ESPN/Disney account in a review league, no MFA, with the step-by-step
    instructions in "Any other instructions". Without it the reviewer cannot reach any
    screen past Welcome and the submission can be rejected.
    Source: https://support.google.com/googleplay/android-developer/answer/9859455 (verified)
11. **Content rating (IARC)** from `REVIEW-NOTES.md` section (b): App content > Content
    rating > Start; category Utility/Productivity/Other; No to violence, alcohol references,
    gambling, user interaction, location; expect Everyone / PEGI 3. Redo when content changes.
    Source: https://support.google.com/googleplay/android-developer/answer/9859655 (verified)
12. **Other App content declarations** from `REVIEW-NOTES.md` section (c): Ads No,
    Advertising ID No, Government apps No, Financial features none, Health apps none, News
    No, Target audience 18 and over. Keep Ads, Advertising ID and Data safety consistent.
    Sources: https://support.google.com/googleplay/android-developer/answer/13849271 (financial,
    verified); https://support.google.com/googleplay/android-developer/answer/14738291 (health,
    verified); https://support.google.com/googleplay/android-developer/answer/9867159 (target
    audience, verified); Advertising ID form location is unverified.
13. **Build an .aab, not an APK**: new apps must upload an Android App Bundle. The
    `production` profile in `apps/mobile/eas.json` already produces one (store distribution,
    no `buildType: apk`, remote `autoIncrement` for versionCode); keep the `preview` APK only
    for sideloading. Target API 36 is the SDK 57 default and meets the Aug 31 2026
    requirement; confirm it on the upload page. Optional config hardening noted by the EAS
    research (not applied here): `allowBackup: false` in `app.config.ts`, and a submit profile
    `{"android": {"track": "internal", "releaseStatus": "completed"}}`.
    Sources: https://developer.android.com/guide/app-bundle (verified);
    https://docs.expo.dev/submit/android/ (verified);
    https://support.google.com/googleplay/android-developer/answer/11926878 (verified; SDK 57
    targeting 36 is likely, read from the RN 0.86 version catalog);
    https://docs.expo.dev/build-reference/app-versions/ (verified)
14. **Upload**: either download the .aab from the EAS build page and upload it in Play
    Console on the phone, or create a Google Cloud service account (Play Android Developer
    API enabled, invited in Play Console > Users and permissions with release and testing
    permissions), upload its JSON key on expo.dev under Credentials > Android > Service
    credentials, and run `build_submit` with `track: "internal"` or `"alpha"`. First upload
    does not have to be manual.
    Sources: https://docs.expo.dev/submit/android/ (verified);
    https://docs.expo.dev/submit/android-manual/ (verified);
    https://github.com/expo/fyi/blob/main/creating-google-service-account.md (unofficial, likely)
15. **Closed test** from `REVIEW-NOTES.md` section (d): one closed track (the default
    `alpha` if submitting through EAS), an email list of testers, at least 12 Google accounts
    opted in continuously for 14 consecutive days (aim for 15), each installing from Play and
    opening the app. App setup (6 to 12) must be complete first. Testers who opt out and back
    in restart their 14 days. Manage testers in Play Console; EAS has no shortcut.
    Sources: https://support.google.com/googleplay/android-developer/answer/14151465 (verified);
    https://docs.expo.dev/guides/google-play-closed-testing/ (404, verified absent)
16. **Apply for production** on day 15+: Dashboard > Apply for production, three sections
    (closed test, app, production readiness), answers saved only on Next/Apply; keep the
    ESPN review credentials current; expect up to 7 days of review. Earliest public listing
    is roughly three to four weeks after the first .aab upload. The owner's own Sunday use via
    the sideloaded preview APK is unaffected by any of this.
    Source: https://support.google.com/googleplay/android-developer/answer/14151465 (verified)
