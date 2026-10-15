// Reading the ESPN session the in-app sign-in leaves behind: the SWID and espn_s2 cookies,
// straight from the native cookie store the WebView writes to (WebKit's on iOS, Android's
// shared CookieManager). espn_s2 may be HttpOnly, which page JavaScript cannot see, so this
// is the main path; the sign-in screen falls back to document.cookie only without it.
//
// The values go to espn-connect and nowhere else: never shown, logged or saved by the app.
// Afterwards the WebView's cookies are cleared, so the phone keeps no ESPN session either.

import { Platform } from "react-native";

export interface EspnSession {
  swid: string;
  espnS2: string;
}

type CookieManager = typeof import("@react-native-cookies/cookies").default;

let manager: CookieManager | null | undefined;

// Required lazily: the library throws on import when its native half is missing (Expo Go,
// or a build made without it), and that must not take the sign-in screen down with it.
function cookieManager(): CookieManager | null {
  if (manager === undefined) {
    try {
      manager = require("@react-native-cookies/cookies") as CookieManager;
    } catch {
      manager = null;
    }
  }
  return manager;
}

export const nativeCookiesAvailable = (): boolean => cookieManager() !== null;

// espn_s2 and SWID are set on .espn.com; asking both hosts covers a cookie scoped narrower.
const HOSTS = ["https://www.espn.com/", "https://fantasy.espn.com/"];
const webKit = Platform.OS === "ios";

/** The session if ESPN has set one, null if not yet. Throws if the store can't be read. */
export async function readEspnSession(): Promise<EspnSession | null> {
  const cm = cookieManager();
  if (!cm) return null;
  let swid = "";
  let espnS2 = "";
  for (const host of HOSTS) {
    const jar = await cm.get(host, webKit);
    swid ||= jar.SWID?.value ?? "";
    espnS2 ||= jar.espn_s2?.value ?? "";
  }
  return swid && espnS2 ? { swid, espnS2 } : null;
}

/**
 * Signs the WebView out of ESPN on this phone. Done before a sign-in, so an expired session
 * is never handed over as a new one, and after it, so the phone keeps no copy.
 */
export async function forgetEspnSession(): Promise<void> {
  const cm = cookieManager();
  if (!cm) return;
  try {
    await cm.clearAll(webKit);
    await cm.flush();
  } catch {
    // Nothing to clear, or the store is busy; the next sign-in clears again.
  }
}
