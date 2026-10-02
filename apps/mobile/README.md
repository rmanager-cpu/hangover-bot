# HangoverBot phone app (beta)

Expo (SDK 57), TypeScript, expo-router. Package and bundle id `com.turbolabs.hangoverbot`.
The contract it is built to is the "Mobile" section of `docs/BETA.md`.

The app never talks to ESPN on its own and never holds an ESPN credential after sign-in. It
reads and writes the user's own rows in Supabase (RLS) and calls the Edge Functions
`espn-connect`, `connection-setup`, `read`, `decide` and `swap`.

## The flow

1. First launch: an anonymous Supabase session, nothing to fill in.
2. Welcome, **Sync a League**, then the host list (ESPN; the rest say "Coming soon").
3. **ESPN sign-in inside the app.** ESPN's own login page in a WebView
   (`https://www.espn.com/login`, or `https://fantasy.espn.com/football/` if that page won't
   load). Every 2 seconds the app looks in the native cookie store for `espn_s2` (the WebKit
   store on iOS). When it is there, `SWID` and `espn_s2` go to `espn-connect`, once. They are
   never shown, logged or saved by the app, and the WebView's cookies are cleared straight
   after. If the native store can't be read, a script in ESPN's page posts the two cookies
   instead, when page JavaScript can see them.
4. League list (or type or paste the league id when ESPN's list didn't come back), then
   `connection-setup`.
5. **What we read from ESPN**: starters, bench and IR in ESPN's order, with injury tags,
   kickoffs, byes, locks and projections, to compare line by line with the ESPN app. Plus
   the **Test swap**: pick two players, confirm, see the receipt from a fresh read, **Swap back**.
6. Protection: Alerts, Ask Me, Bench Protection (needs a claimed account), AI Rescue "Coming soon".
7. Claim: email, then the 6-digit code (`updateUser({ email })`, then
   `verifyOtp({ type: "email_change" })`). Skippable unless Bench Protection was chosen.
8. Home (YOU'RE COVERED or ACTION NEEDED), Activity (receipts; proposals with big Approve and
   Decline), Settings (protection, replacement order, pause, sign in to ESPN again, About).

## Build

From `apps/mobile`:

```sh
npm install                                  # once, at the repo root (npm workspaces)
npm install -g eas-cli                       # or put `npx eas-cli` wherever it says `eas`
eas login
eas init                                     # once: creates the EAS project, prints its id

eas build -p android --profile preview       # an APK; EAS gives an install link / QR code
eas build -p ios --profile production        # for TestFlight (needs the Apple developer account)
eas submit -p ios                            # sends the latest iOS build to App Store Connect
```

`eas init` cannot write the project id into `app.config.ts` (it is code, not JSON), so pass it
as `EAS_PROJECT_ID`: in the shell when running `eas`, and as an EAS environment variable for
the preview and production environments so the build machine sees it too. Without a project
id the app still builds and runs, but cannot sign up for push.

### Without a computer

EAS builds in the cloud, so a laptop is only needed to start a build, and even that has a
phone-friendly route: link the GitHub repo to the project on expo.dev (base directory
`apps/mobile`), set the environment variables below on expo.dev, and start builds from the
website. The Android build page has an install link that opens on the phone (allow your
browser to install apps when Android asks). Not yet tried end to end.

## Environment

| Name | Where | What |
|---|---|---|
| `EXPO_PUBLIC_SUPABASE_URL` | `eas.json`, each profile | `https://<project-ref>.supabase.co`. Public. |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | `eas.json`, each profile | The project's anon key. Public. Never the service-role key. |
| `EAS_PROJECT_ID` | shell + EAS environment variable | The id `eas init` prints. Needed for push tokens. |
| `GOOGLE_SERVICES_JSON` | EAS **file** environment variable | Firebase's `google-services.json` for Android push. Optional: without it the APK builds and runs, and Android push stays off (Settings says so). |

`eas.json` ships with `REPLACE_WITH_SUPABASE_URL` / `REPLACE_WITH_SUPABASE_ANON_KEY`. A build
made with those still opens, and says on screen that it isn't connected to a server.

For pushes to arrive, Expo's push service also needs the platform keys on expo.dev,
Credentials: an **FCM V1 service account key** for Android, and an **APNs key** for iOS (EAS
offers to create that one during the first iOS build).

## Checks

```sh
npx tsc --noEmit
EXPO_OFFLINE=1 npx expo export --platform android     # Metro resolves every import
EXPO_OFFLINE=1 npx expo export --platform ios
```

Only **types** come in from `@rosterbots/*` (`import type`), so no server code ends up in the
app bundle. `verbatimModuleSyntax` keeps it that way.

## Known edges

- `@react-native-cookies/cookies` 6.2.1 (2022) still names `jcenter()`, which Gradle 9 removed.
  `plugins/with-cookies-gradle.js` swaps that line for `mavenCentral()` during prebuild. If
  the Android build still fails inside that library, its maintained successor
  `@preeternal/react-native-cookie-manager` keeps the same `get(url, useWebKit)` call.
- The icons in `assets/` are placeholders drawn from the brand palette, not final art.
- Nothing here has run on a real phone yet. The first real proof is the owner's own league:
  sign in, compare "What we read" with the ESPN app, then one test swap and swap back.
