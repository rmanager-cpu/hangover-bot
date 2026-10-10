// Sign in to an account that was claimed before: a new phone, a reinstall, cleared app
// data. Email, then the 6-digit code from the "Magic Link" email (it must carry
// {{ .Token }}: docs/DEPLOY.md). The anonymous session this phone started with is left
// behind, and any ESPN sign-in it stored is deleted first, so nothing keeps running as it.

import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { useSession } from "../src/lib/session";
import { supabase } from "../src/lib/supabase";
import { space } from "../src/theme";
import { Banner, Body, Button, Card, Field, H2, Header, Muted, Screen } from "../src/ui";

const looksLikeEmail = (e: string) => /^[^\s@]+@[^\s@]+[.][^\s@]+$/.test(e.trim());

function authMessage(e: { message?: string; code?: string; status?: number } | null, step: "email" | "code"): string {
  const m = (e?.message ?? "").toLowerCase();
  // shouldCreateUser: false answers an unknown email with "Signups not allowed for otp".
  if (e?.code === "otp_disabled" || m.includes("signups not allowed")) return "No RosterBots account has that email yet. Claim your account in Settings instead.";
  if (m.includes("security purposes") || e?.status === 429) return "Too many codes asked for. Wait a minute, then try again.";
  if (step === "code") return "That code didn't work. Check the newest email from RosterBots, or send a new code.";
  if (m.includes("invalid") && m.includes("email")) return "That email address doesn't look right.";
  return "Couldn't send the code. Check your connection and try again.";
}

export default function SignIn() {
  const params = useLocalSearchParams<{ email?: string }>();
  const { user, claimed } = useSession();
  const [email, setEmail] = useState(params.email ?? "");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const send = async () => {
    const to = email.trim().toLowerCase();
    setBusy(true);
    setError(null);
    setNote(null);
    const { error: e } = await supabase.auth.signInWithOtp({ email: to, options: { shouldCreateUser: false } });
    setBusy(false);
    if (e) return setError(authMessage(e, "email"));
    setSentTo(to);
    setCode("");
    setNote(`Code sent to ${to}. It can take a minute; check spam too.`);
  };

  const verify = async () => {
    if (!sentTo) return;
    setBusy(true);
    setError(null);
    // This phone's anonymous account is about to be left behind. Its ESPN sign-in, if it
    // has one, goes first: deleting it takes its leagues and its Vault cookies with it.
    if (user?.is_anonymous) {
      const { error: e } = await supabase.from("credentials").delete().eq("user_id", user.id);
      if (e) {
        setBusy(false);
        return setError("Couldn't clear this phone's current setup. Check your connection and try again.");
      }
    }
    const { error: e } = await supabase.auth.verifyOtp({ email: sentTo, token: code.trim(), type: "email" });
    setBusy(false);
    if (e) return setError(authMessage(e, "code"));
    // The session is the claimed account's now; the index route sends it where it belongs.
    if (router.canDismiss()) router.dismissAll();
    router.replace("/");
  };

  if (claimed) {
    return (
      <Screen footer={<Button title="Continue" arrow large onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))} />}>
        <Card>
          <H2>You're signed in</H2>
          <Body style={{ marginTop: space.sm }}>Signed in as {user?.email ?? "your email"}.</Body>
        </Card>
      </Screen>
    );
  }

  return (
    <Screen>
      <Header title="Sign in" subtitle="Sign in to a RosterBots account you claimed before. Its league, protection and history come with it." style={{ marginBottom: space.sm }} />
      <Muted style={{ marginBottom: space.xl }}>No password. We email you a 6-digit code. Anything set up on this phone so far is replaced.</Muted>

      {error ? <Banner tone="warn" body={error} /> : null}
      {note && !error ? <Banner body={note} /> : null}

      {!sentTo ? (
        <>
          <Field
            label="Email"
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            keyboardType="email-address"
            textContentType="emailAddress"
            returnKeyType="send"
            onSubmitEditing={() => looksLikeEmail(email) && send()}
          />
          <Button title="Send code" arrow busy={busy} disabled={!looksLikeEmail(email)} onPress={send} />
        </>
      ) : (
        <>
          <Field
            label="6-digit code"
            value={code}
            onChangeText={(t) => setCode(t.replace(/[^0-9]/g, "").slice(0, 6))}
            placeholder="123456"
            keyboardType="number-pad"
            textContentType="oneTimeCode"
            autoComplete="one-time-code"
            maxLength={6}
            style={{ letterSpacing: 6, fontSize: 24 }}
            returnKeyType="done"
            onSubmitEditing={() => code.length === 6 && verify()}
          />
          <Button title="Sign in" arrow busy={busy} disabled={code.length !== 6} onPress={verify} />
          <Button title="Send a new code" variant="quiet" disabled={busy} onPress={send} style={{ marginTop: space.md }} />
          <Button
            title="Use a different email"
            variant="quiet"
            disabled={busy}
            onPress={() => {
              setSentTo(null);
              setNote(null);
              setError(null);
            }}
          />
        </>
      )}
    </Screen>
  );
}
