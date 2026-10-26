import type { ConfigContext, ExpoConfig } from "expo/config";

// Brand (docs/brand/README.md, the Oct 25 RosterBots sheet). The icon is the owner's square art
// on its own navy; Midnight and Orange are the sheet's palette.
const MIDNIGHT = "#0B1020";
const ICON_NAVY = "#010436";
const TURBO_ORANGE = "#FF8A00";

// Permanent once in Google Play or App Store Connect: the owner's domain, rosterbots.com,
// backwards (DECISIONS.md, 2026-10-25).
const APP_ID = "com.rosterbots.app";

// The project the owner created on expo.dev. EAS refuses to build unless the slug
// matches that project's slug; the name people see is still RosterBots.
const EAS_PROJECT_ID = "ffa6f3e6-8c06-4fc3-a893-5605dd208191";
const EAS_SLUG = "rosterbuddies-fkijb1junjqxswiiv33pi";

// Google sign-in needs no plugin on Android: the Web client id reaches the app as
// EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID (eas.json). On iPhone it needs the iOS client's reversed
// id as a URL scheme, so the plugin joins once there is an iOS client (and Sign in with Apple
// beside it, Apple's rule).
const GOOGLE_IOS_URL_SCHEME = process.env.GOOGLE_IOS_URL_SCHEME;

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: "RosterBots",
  slug: EAS_SLUG,
  scheme: "rosterbots",
  version: "0.1.0",
  orientation: "portrait",
  platforms: ["ios", "android"],
  userInterfaceStyle: "dark",
  backgroundColor: MIDNIGHT,
  icon: "./assets/icon.png",
  ios: {
    bundleIdentifier: APP_ID,
    supportsTablet: false,
    // HTTPS only, so TestFlight need not ask about export compliance on every build.
    config: { usesNonExemptEncryption: false },
  },
  android: {
    package: APP_ID,
    adaptiveIcon: { foregroundImage: "./assets/adaptive-icon.png", backgroundColor: ICON_NAVY },
    // Expo's defaults; this app never draws over other apps or touches shared storage.
    blockedPermissions: [
      "android.permission.SYSTEM_ALERT_WINDOW",
      "android.permission.READ_EXTERNAL_STORAGE",
      "android.permission.WRITE_EXTERNAL_STORAGE",
    ],
    // An EAS file variable. Without it the app still builds and runs; Android push just stays off.
    ...(process.env.GOOGLE_SERVICES_JSON ? { googleServicesFile: process.env.GOOGLE_SERVICES_JSON } : {}),
  },
  plugins: [
    "expo-router",
    // The splash is the lockup on Midnight. The image is Android's 288 dp splash square with
    // the lockup inside the 192 dp circle Android leaves visible (scripts/brand-assets.ps1),
    // so imageWidth is 288: wider, and Android clips the lockup's ends.
    [
      "expo-splash-screen",
      { image: "./assets/splash-icon.png", imageWidth: 288, resizeMode: "contain", backgroundColor: MIDNIGHT },
    ],
    // The service names this channel on every push (ANDROID_CHANNEL); src/lib/push.tsx creates it.
    ["expo-notifications", { icon: "./assets/notification-icon.png", color: TURBO_ORANGE, defaultChannel: "default" }],
    "./plugins/with-cookies-gradle.js",
    ...(GOOGLE_IOS_URL_SCHEME ? [["@react-native-google-signin/google-signin", { iosUrlScheme: GOOGLE_IOS_URL_SCHEME }] as [string, object]] : []),
  ],
  extra: {
    ...config.extra,
    eas: { projectId: process.env.EAS_PROJECT_ID ?? EAS_PROJECT_ID },
  },
});
