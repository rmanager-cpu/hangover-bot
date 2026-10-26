// Google sign-in: the one way to claim an account and to get back to it on a new phone
// (DECISIONS.md, Oct 25 and Oct 26). Google's own account picker hands over an ID token,
// and Supabase checks it against its Google provider's Client IDs. RosterBots never sees a
// Google password.
//
// An anonymous account is linked to the Google account, so it stays the same user and keeps
// its leagues. A Google account that already has a RosterBots account is signed in to
// instead. Supabase also joins a Google sign-in to an older account with the same confirmed
// email, so an account claimed by email before Oct 26 is reached by that Gmail address.

import { GoogleSignin, isErrorWithCode, isSuccessResponse, statusCodes } from "@react-native-google-signin/google-signin";
import { supabase } from "./supabase";

// The Web client's id from Google Cloud, set in eas.json. It is public: every Android app
// that signs in with Google carries one. Without it the button explains instead of failing.
const WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? "";

export const googleReady = WEB_CLIENT_ID.length > 0;

let configured = false;

type Picked = { idToken: string; accessToken?: string; email: string };
type Pick = { kind: "picked"; picked: Picked } | { kind: "cancelled" } | { kind: "failed"; message: string };

export type GoogleResult =
  /** This phone's account now signs in with Google: the same user, so its leagues stay. */
  | { kind: "linked" }
  /** Signed in to the account that Google account already had. */
  | { kind: "switched" }
  /** That Google account already has an account, and this phone has a setup that switching would leave behind. */
  | { kind: "taken"; email: string; picked: Picked }
  | { kind: "cancelled" }
  | { kind: "failed"; message: string };

const failed = (message: string): { kind: "failed"; message: string } => ({ kind: "failed", message });

/** Google's account picker. It shows every time, so a second Google account can be chosen. */
async function pickGoogleAccount(): Promise<Pick> {
  if (!googleReady) return failed("Google sign-in isn't set up in this build yet.");
  if (!configured) {
    GoogleSignin.configure({ webClientId: WEB_CLIENT_ID });
    configured = true;
  }
  try {
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    // Forgets the last pick inside this app only; the phone stays signed in to Google.
    await GoogleSignin.signOut().catch(() => null);
    const response = await GoogleSignin.signIn();
    if (!isSuccessResponse(response)) return { kind: "cancelled" };
    const { idToken, user } = response.data;
    if (!idToken) return failed("Google didn't hand over a sign-in. Try again.");
    // Optional: Supabase checks it against the ID token's at_hash when there is one.
    const accessToken = await GoogleSignin.getTokens().then((t) => t.accessToken, () => undefined);
    return { kind: "picked", picked: { idToken, accessToken, email: user.email } };
  } catch (e) {
    if (!isErrorWithCode(e)) return failed("Google sign-in didn't work. Try again.");
    if (e.code === statusCodes.SIGN_IN_CANCELLED || e.code === statusCodes.IN_PROGRESS) return { kind: "cancelled" };
    if (e.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) return failed("This phone needs Google Play services to sign in with Google.");
    // 10 is Google's DEVELOPER_ERROR: this app's package and signing fingerprint are not an
    // Android client in the same Google Cloud project as the Web client.
    if (e.code === "10" || /DEVELOPER_ERROR/i.test(e.message)) return failed("Google turned this app away: its Google Cloud setup isn't finished (the Android client). Nothing is wrong with your phone.");
    if (e.code === "7" || /network/i.test(e.message)) return failed("Couldn't reach Google. Check your connection and try again.");
    return failed("Google sign-in didn't work. Try again.");
  }
}

type AuthErr = { code?: string; message?: string; status?: number } | null;

/** The signed-in user from the saved session: no network, so a dropped connection can't make an anonymous phone look signed in. */
async function currentUser() {
  const { data } = await supabase.auth.getSession();
  return data.session?.user ?? null;
}

/** Supabase says this Google account (or its email) already belongs to another account. */
function isTaken(e: AuthErr): boolean {
  const m = (e?.message ?? "").toLowerCase();
  return ["identity_already_exists", "email_exists", "user_already_exists", "conflict"].includes(e?.code ?? "") || m.includes("already");
}

function supabaseMessage(e: AuthErr): string {
  const code = e?.code ?? "";
  if (code === "manual_linking_disabled") return "RosterBots's server can't link Google accounts yet (manual linking is off in Supabase). Nothing is wrong with your phone.";
  if (code === "provider_disabled" || code === "oauth_provider_not_supported") return "RosterBots's server isn't accepting Google sign-ins yet (the Google provider is off in Supabase). Nothing is wrong with your phone.";
  if (code === "unexpected_audience" || /audience/i.test(e?.message ?? "")) return "RosterBots's server doesn't know this app's Google client yet (Supabase's Google Client IDs). Nothing is wrong with your phone.";
  if (e?.status === 429 || code === "over_request_rate_limit") return "Too many tries. Wait a minute, then try again.";
  return "Couldn't sign in with Google. Check your connection and try again.";
}

/**
 * Signs in to the account a Google account already has. An anonymous account being left
 * behind loses its ESPN sign-in first, which takes its leagues and Vault cookies with it, so
 * nothing keeps running as a user nobody can reach.
 */
export async function switchToGoogleAccount(picked: Picked): Promise<GoogleResult> {
  const current = await currentUser();
  if (current?.is_anonymous) {
    const { error } = await supabase.from("credentials").delete().eq("user_id", current.id);
    if (error) return failed("Couldn't clear this phone's current setup. Check your connection and try again.");
  }
  const { error } = await supabase.auth.signInWithIdToken({ provider: "google", token: picked.idToken, access_token: picked.accessToken });
  if (error) return failed(supabaseMessage(error));
  return { kind: "switched" };
}

/**
 * The one button. An anonymous account is linked when the Google account is new to
 * RosterBots; when it is not, the phone switches to that account, after asking first if
 * something is set up here (`hasSetup`). A signed-in account picking Google switches.
 */
export async function continueWithGoogle(hasSetup: boolean): Promise<GoogleResult> {
  const pick = await pickGoogleAccount();
  if (pick.kind !== "picked") return pick;
  const { picked } = pick;

  const current = await currentUser();
  if (!current) return failed("Couldn't reach RosterBots. Check your connection and try again.");
  if (!current.is_anonymous) return switchToGoogleAccount(picked);

  const { error } = await supabase.auth.linkIdentity({ provider: "google", token: picked.idToken, access_token: picked.accessToken });
  if (!error) {
    // A fresh token carries the signed-in account, not the anonymous one.
    await supabase.auth.refreshSession().catch(() => null);
    return { kind: "linked" };
  }
  if (!isTaken(error)) return failed(supabaseMessage(error));
  return hasSetup ? { kind: "taken", email: picked.email, picked } : switchToGoogleAccount(picked);
}
