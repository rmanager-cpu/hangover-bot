// Supabase's documented Expo setup: AsyncStorage for the session, the URL polyfill, and
// token refresh only while the app is in front. The URL and anon key are public values
// baked in from eas.json at build time.

import "react-native-url-polyfill/auto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";
import { AppState } from "react-native";

const url = process.env.EXPO_PUBLIC_SUPABASE_URL ?? "";
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "";

/** False in a build made before the real values replaced eas.json's placeholders. */
export const configured = /^https?:[/][/][^\s]+$/.test(url) && anonKey.length > 20 && !anonKey.startsWith("REPLACE_");

// createClient throws on a malformed URL, and an unconfigured build should say so on
// screen rather than crash on launch.
export const supabase = createClient(configured ? url : "https://not-configured.invalid", configured ? anonKey : "not-configured", {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

AppState.addEventListener("change", (state) => {
  if (!configured) return;
  if (state === "active") supabase.auth.startAutoRefresh();
  else supabase.auth.stopAutoRefresh();
});
