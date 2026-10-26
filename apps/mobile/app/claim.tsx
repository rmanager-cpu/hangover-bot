// Sign in with Google: claims this phone's anonymous account (the same user, so its leagues
// stay, and what lets Auto Protect and AI Native act on their own), or brings back an account
// from another phone or an earlier install. One screen for both: src/lib/google.ts decides
// which, and asks before leaving a setup behind. Kept at /claim so every caller's params
// (then, id, setup) still arrive.

import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { useData } from "../src/lib/data";
import { continueWithGoogle, googleReady, switchToGoogleAccount, type GoogleResult } from "../src/lib/google";
import { useSession } from "../src/lib/session";
import { finishSetup } from "../src/lib/setup";
import { space } from "../src/theme";
import { Banner, Body, Button, Card, H2, Header, Muted, Screen } from "../src/ui";

type Taken = Extract<GoogleResult, { kind: "taken" }>;

export default function Claim() {
  const { then, id, setup } = useLocalSearchParams<{ then?: string; id?: string; setup?: string }>();
  const { user, claimed } = useSession();
  const data = useData();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [taken, setTaken] = useState<Taken | null>(null);

  // Signed in on this phone's own account: carry on with what brought them here. AI Native's
  // opt-in is the Droppable screen, so that comes next instead.
  const done = async () => {
    if (then === "ai_rescue" && id) {
      router.replace({ pathname: "/droppable", params: { id, then: "ai_rescue", ...(setup === "1" ? { setup: "1" } : {}) } });
      return;
    }
    if (then === "bench_protection" && id) {
      try {
        await data.updateConnection(id, { authority: "bench_protection" });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't turn on Auto Protect. Try again in Settings.");
        return;
      }
    }
    if (setup === "1") finishSetup();
    else if (router.canGoBack()) router.back();
    else router.replace("/settings");
  };

  // Another account now: whatever this screen was opened for belonged to the old one. The
  // index route sends the new session where it belongs.
  const switched = () => {
    if (router.canDismiss()) router.dismissAll();
    router.replace("/");
  };

  const handle = async (r: GoogleResult) => {
    if (r.kind === "linked") return done();
    if (r.kind === "switched") return switched();
    if (r.kind === "taken") return setTaken(r);
    if (r.kind === "failed") setError(r.message);
  };

  const run = async (step: () => Promise<GoogleResult>) => {
    setBusy(true);
    setError(null);
    setTaken(null);
    try {
      await handle(await step());
    } catch {
      setError("Couldn't sign in with Google. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  const google = () => run(() => continueWithGoogle(data.connections.length > 0));

  if (claimed) {
    return (
      <Screen
        footer={
          <>
            <Button
              title="Continue"
              arrow
              large
              busy={busy}
              onPress={() => {
                setBusy(true);
                done().finally(() => setBusy(false));
              }}
            />
            <Button title="Use a different Google account" variant="quiet" disabled={busy} onPress={google} style={{ marginTop: space.sm }} />
          </>
        }
      >
        <Card>
          <H2>You're signed in</H2>
          <Body style={{ marginTop: space.sm }}>Signed in as {user?.email ?? "your Google account"}.</Body>
        </Card>
        {error ? <Banner tone="warn" body={error} /> : null}
      </Screen>
    );
  }

  return (
    <Screen
      footer={
        setup === "1" && then !== "bench_protection" && then !== "ai_rescue" ? <Button title="Skip for now" variant="quiet" onPress={finishSetup} /> : undefined
      }
    >
      <Header
        title="Sign in with Google"
        subtitle="Keeps your leagues if you change phones or reinstall. It's also what lets Auto Protect and AI Native make moves on their own: until then, I ask you first."
        style={{ marginBottom: space.sm }}
      />
      <Muted style={{ marginBottom: space.xl }}>
        RosterBots gets your name and email from Google, never your Google password. Signed in on another phone before? Pick the same Google account and your leagues come back.
      </Muted>

      {error ? <Banner tone="warn" body={error} /> : null}
      {taken ? (
        <Banner
          title="That Google account already has RosterBots"
          body={`Switch to the account for ${taken.email}? Its leagues, protection and history come with it. What you set up on this phone so far is deleted.`}
          action={{ title: "Switch to that account", onPress: () => run(() => switchToGoogleAccount(taken.picked)) }}
        />
      ) : null}

      <Button title="Continue with Google" arrow large busy={busy} disabled={!googleReady} onPress={google} />
      {!googleReady ? <Muted style={{ marginTop: space.md }}>Google sign-in isn't set up in this build yet.</Muted> : null}
      {taken ? <Button title="Use a different Google account" variant="quiet" disabled={busy} onPress={google} style={{ marginTop: space.md }} /> : null}
    </Screen>
  );
}
