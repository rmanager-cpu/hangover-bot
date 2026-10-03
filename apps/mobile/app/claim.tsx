// Claim the anonymous account with an email and a 6-digit code. Same user, same league;
// it just stops being anonymous, which is what lets Bench Protection act on its own.

import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { useData } from "../src/lib/data";
import { useSession } from "../src/lib/session";
import { finishSetup } from "../src/lib/setup";
import { supabase } from "../src/lib/supabase";
import { space } from "../src/theme";
import { Banner, Body, Button, Card, Field, H2, Muted, Screen } from "../src/ui";

const looksLikeEmail = (e: string) => /^[^\s@]+@[^\s@]+[.][^\s@]+$/.test(e.trim());

/** The email is already some account's: the fix is to sign in to it, not to claim again. */
const isTaken = (e: { message?: string; code?: string } | null): boolean => {
  const m = (e?.message ?? "").toLowerCase();
  return e?.code === "email_exists" || (m.includes("already") && m.includes("registered"));
};

function authMessage(e: { message?: string; code?: string; status?: number } | null, step: "email" | "code"): string {
  const m = (e?.message ?? "").toLowerCase();
  if (isTaken(e)) return "That email already belongs to a HangoverBot account. Sign in to it instead, or use a different email.";
  if (m.includes("security purposes") || e?.status === 429) return "Too many codes asked for. Wait a minute, then try again.";
  if (step === "code") return "That code didn't work. Check the newest email from HangoverBot, or send a new code.";
  if (m.includes("invalid") && m.includes("email")) return "That email address doesn't look right.";
  return "Couldn't send the code. Check your connection and try again.";
}

export default function Claim() {
  const { then, id, setup } = useLocalSearchParams<{ then?: string; id?: string; setup?: string }>();
  const { user, claimed } = useSession();
  const data = useData();
  const [email, setEmail] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [taken, setTaken] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const done = async () => {
    // The reason they came here: turn Bench Protection on now that it's allowed.
    if (then === "bench_protection" && id) {
      try {
        await data.updateConnection(id, { authority: "bench_protection" });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't turn on Bench Protection. Try again in Settings.");
        return;
      }
    }
    if (setup === "1") finishSetup();
    else if (router.canGoBack()) router.back();
    else router.replace("/settings");
  };

  const send = async () => {
    const to = email.trim().toLowerCase();
    setBusy(true);
    setError(null);
    setTaken(false);
    setNote(null);
    const { error: e } = await supabase.auth.updateUser({ email: to });
    setBusy(false);
    if (e) {
      setTaken(isTaken(e));
      return setError(authMessage(e, "email"));
    }
    setSentTo(to);
    setCode("");
    setNote(`Code sent to ${to}. It can take a minute; check spam too.`);
  };

  const verify = async () => {
    if (!sentTo) return;
    setBusy(true);
    setError(null);
    const { error: e } = await supabase.auth.verifyOtp({ email: sentTo, token: code.trim(), type: "email_change" });
    if (e) {
      setBusy(false);
      return setError(authMessage(e, "code"));
    }
    // A fresh token carries the claimed account, not the anonymous one.
    await supabase.auth.refreshSession().catch(() => {});
    setBusy(false);
    await done();
  };

  if (claimed) {
    return (
      <Screen footer={<Button title="Continue" large busy={busy} onPress={() => { setBusy(true); done().finally(() => setBusy(false)); }} />}>
        <Card tone="calm">
          <H2>Your account is claimed</H2>
          <Body style={{ marginTop: space.sm }}>Signed in as {user?.email ?? "your email"}.</Body>
        </Card>
        {error ? <Banner tone="warn" body={error} /> : null}
      </Screen>
    );
  }

  return (
    <Screen
      footer={
        setup === "1" && then !== "bench_protection" ? <Button title="Skip for now" variant="quiet" onPress={finishSetup} /> : undefined
      }
    >
      <Body>
        Add your email so your league stays yours if you change phones. It's also what lets Bench Protection make moves on its own: without it, I ask you first.
      </Body>
      <Muted style={{ marginTop: space.sm, marginBottom: space.xl }}>No password. We email you a 6-digit code.</Muted>

      {error ? (
        <Banner
          tone="warn"
          body={error}
          action={taken ? { title: "Sign in to that account", onPress: () => router.push({ pathname: "/signin", params: { email: email.trim().toLowerCase() } }) } : undefined}
        />
      ) : null}
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
          <Button title="Send code" busy={busy} disabled={!looksLikeEmail(email)} onPress={send} />
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
          <Button title="Confirm" busy={busy} disabled={code.length !== 6} onPress={verify} />
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
