import type { ConfigContext, ExpoConfig } from "expo/config";

// Brand from the handoff, section 24.
const MIDNIGHT = "#070A24";
const TURBO_PURPLE = "#6726E8";

// Permanent once in App Store Connect (DECISIONS.md, 2026-10-02).
const APP_ID = "com.turbolabs.hangoverbot";

// The project the owner created on expo.dev. EAS refuses to build unless the slug
// matches that project's slug; the name people see is still HangoverBot.
const EAS_PROJECT_ID = "ffa6f3e6-8c06-4fc3-a893-5605dd208191";
const EAS_SLUG = "rosterbuddies-fkijb1junjqxswiiv33pi";

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: "HangoverBot",
  slug: EAS_SLUG,
  scheme: "hangoverbot",
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
    adaptiveIcon: { foregroundImage: "./assets/adaptive-icon.png", backgroundColor: MIDNIGHT },
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
    [
      "expo-splash-screen",
      { image: "./assets/splash-icon.png", imageWidth: 160, resizeMode: "contain", backgroundColor: MIDNIGHT },
    ],
    // The service names this channel on every push (ANDROID_CHANNEL); src/lib/push.tsx creates it.
    ["expo-notifications", { icon: "./assets/notification-icon.png", color: TURBO_PURPLE, defaultChannel: "default" }],
    "./plugins/with-cookies-gradle.js",
  ],
  extra: {
    ...config.extra,
    eas: { projectId: process.env.EAS_PROJECT_ID ?? EAS_PROJECT_ID },
  },
});
