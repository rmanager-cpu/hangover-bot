// Pick the league to watch. ESPN's league list comes from the sign-in; when it couldn't be
// read (that lookup is unproven), the league id can be typed or pasted from a league link.

import type { LeagueSummary } from "@rosterbots/connectors";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { api, ApiError, messageOf } from "../../src/lib/api";
import { useData } from "../../src/lib/data";
import { useFlow } from "../../src/lib/flow";
import { supabase } from "../../src/lib/supabase";
import { color, radius, space } from "../../src/theme";
import { Banner, Body, Button, Card, Field, H2, Label, Loading, Muted, Pill, Screen } from "../../src/ui";

/** "36784699", or a pasted league link with leagueId=36784699 in it. */
function leagueIdFrom(text: string): string | null {
  const t = text.trim();
  const inLink = /leagueId=([0-9]{1,15})/i.exec(t);
  if (inLink) return inLink[1]!;
  return /^[0-9]{1,15}$/.test(t) ? t : null;
}

export default function Leagues() {
  const flow = useFlow();
  const data = useData();
  const signIn = flow.signIn;
  const [credentialId, setCredentialId] = useState<string | null>(signIn?.credentialId ?? null);
  const [looking, setLooking] = useState(!signIn);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<{ message: string; signIn: boolean } | null>(null);

  // Arriving from Settings rather than straight from sign-in: use the stored ESPN sign-in.
  useEffect(() => {
    if (signIn) return;
    supabase
      .from("credentials")
      .select("id,status")
      .eq("provider", "espn")
      .maybeSingle()
      .then(({ data: row }) => {
        setCredentialId(typeof row?.id === "string" ? row.id : null);
        setLooking(false);
      });
  }, [signIn]);

  const leagues: LeagueSummary[] = signIn?.leagues ?? [];
  const lookupFailed = !signIn || signIn.leagueLookupFailed || leagues.length === 0;
  const watching = new Set(data.connections.map((c) => c.leagueId));

  const watch = async (leagueId: string) => {
    if (!credentialId || busy) return;
    setBusy(leagueId);
    setError(null);
    try {
      const { connection, read } = await api.connectionSetup(credentialId, leagueId);
      flow.setRead(connection.id, read);
      data.select(connection.id);
      await data.refresh().catch(() => {});
      router.replace({ pathname: "/read/[id]", params: { id: connection.id, setup: "1" } });
    } catch (e) {
      const signedOut = e instanceof ApiError && e.code === "espn_rejected";
      setError({ message: messageOf(e), signIn: signedOut });
    } finally {
      setBusy(null);
    }
  };

  if (looking) return <Loading />;

  if (!credentialId) {
    return (
      <Screen>
        <Body>First, sign in to ESPN so HangoverBot can read your team.</Body>
        <Button title="Sign in to ESPN" onPress={() => router.replace("/connect/espn")} style={{ marginTop: space.lg }} />
      </Screen>
    );
  }

  const typedId = leagueIdFrom(typed);

  return (
    <Screen>
      {error ? (
        <Banner
          tone="warn"
          body={error.message}
          action={error.signIn ? { title: "Sign in to ESPN again", onPress: () => router.replace("/connect/espn") } : undefined}
        />
      ) : null}

      {leagues.length ? (
        <>
          <Label>Your ESPN leagues</Label>
          {leagues.map((l) => (
            <Pressable
              key={l.leagueId + ":" + l.season}
              accessibilityRole="button"
              disabled={!!busy}
              onPress={() => watch(l.leagueId)}
              style={({ pressed }) => [s.league, pressed && { opacity: 0.8 }]}
            >
              <View style={{ flex: 1 }}>
                <H2>{l.leagueName || `League ${l.leagueId}`}</H2>
                <Muted>{l.teamName ? `Your team: ${l.teamName}` : `League ${l.leagueId}`}</Muted>
                {watching.has(l.leagueId) ? <View style={{ marginTop: space.sm }}><Pill text="Already watching" tone="calm" /></View> : null}
              </View>
              {busy === l.leagueId ? <Muted>Reading…</Muted> : <Body style={s.chevron}>›</Body>}
            </Pressable>
          ))}
        </>
      ) : null}

      <Card style={{ marginTop: leagues.length ? space.xl : 0 }}>
        <H2>{lookupFailed ? "Enter your league" : "Don't see your league?"}</H2>
        <Muted style={{ marginTop: space.xs, marginBottom: space.lg }}>
          {lookupFailed && signIn
            ? "ESPN didn't hand over your league list this time. "
            : ""}
          In the ESPN app or site, open your league and share or copy its link. Paste it here, or just the number after leagueId=.
        </Muted>
        <Field
          label="League link or ID"
          value={typed}
          onChangeText={setTyped}
          placeholder="e.g. 36784699"
          autoCapitalize="none"
          autoCorrect={false}
          inputMode="url"
          returnKeyType="go"
          onSubmitEditing={() => typedId && watch(typedId)}
        />
        <Button title={busy && busy === typedId ? "Reading your team…" : "Watch this league"} busy={!!busy && busy === typedId} disabled={!typedId || !!busy} onPress={() => typedId && watch(typedId)} />
      </Card>
    </Screen>
  );
}

const s = StyleSheet.create({
  league: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: color.navy,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.line,
    padding: space.lg,
    marginBottom: space.md,
  },
  chevron: { fontSize: 28, color: color.faint },
});
