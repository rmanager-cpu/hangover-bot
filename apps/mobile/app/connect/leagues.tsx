// Pick the league to watch. ESPN's league list comes from the sign-in, straight after it or,
// from Settings' "Watch another league", from the sign-in already stored (the leagues
// function), so there is nothing to type. Only when ESPN won't list them (that lookup is
// unproven) can the league id be typed or pasted from a league link.

import type { LeagueSummary } from "@rosterbots/connectors";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { api, ApiError, messageOf, type EspnConnectResult } from "../../src/lib/api";
import { useData } from "../../src/lib/data";
import { useFlow } from "../../src/lib/flow";
import { space } from "../../src/theme";
import { Banner, Body, Button, Field, H2, Header, Loading, Muted, Option, Pill, Screen } from "../../src/ui";

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
  // The list: the sign-in's, or the one the stored sign-in gives when arriving from Settings.
  const [listed, setListed] = useState<EspnConnectResult | null>(signIn);
  const [credentialId, setCredentialId] = useState<string | null>(signIn?.credentialId ?? null);
  const [looking, setLooking] = useState(!signIn);
  const [selected, setSelected] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<{ message: string; signIn: boolean } | null>(null);

  // Arriving from Settings rather than straight from sign-in: ask the server for the leagues
  // the stored sign-in belongs to. Without a sign-in, there is nothing to list.
  useEffect(() => {
    if (signIn) return;
    let live = true;
    api
      .leagues()
      .then((r) => {
        if (!live) return;
        setListed(r);
        setCredentialId(r.credentialId);
      })
      .catch((e) => {
        if (!live) return;
        if (e instanceof ApiError && e.code === "not_found") setCredentialId(null);
        else setError({ message: messageOf(e), signIn: e instanceof ApiError && e.code === "espn_rejected" });
      })
      .finally(() => live && setLooking(false));
    return () => {
      live = false;
    };
  }, [signIn]);

  const leagues: LeagueSummary[] = listed?.leagues ?? [];
  const watching = new Set(data.connections.map((c) => c.leagueId));
  // One league not yet watched needs no choosing.
  const unwatched = leagues.filter((l) => !watching.has(l.leagueId));
  const picked = selected ?? (unwatched.length === 1 ? unwatched[0]!.leagueId : null);

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
        <Header title="Sign in to ESPN first" subtitle="So RosterBots can read your team." />
        <Button title="Sign in to ESPN" arrow onPress={() => router.replace("/connect/espn")} />
      </Screen>
    );
  }

  const typedId = leagueIdFrom(typed);
  const heading = leagues.length
    ? signIn
      ? { title: "Choose your league", subtitle: `We found ${leagues.length} ${leagues.length === 1 ? "league" : "leagues"} on ESPN.` }
      : { title: "Watch another league", subtitle: `Your ESPN sign-in is in ${leagues.length} ${leagues.length === 1 ? "league" : "leagues"}. Pick one to watch.` }
    : signIn
      ? { title: "Enter your league", subtitle: "ESPN didn't hand over your league list this time." }
      : { title: "Watch another league", subtitle: "ESPN didn't hand over your league list. Paste the league's link, or type its id." };

  return (
    <Screen
      footer={
        leagues.length ? (
          <Button
            title={picked && watching.has(picked) ? "Already watching" : "Watch this league"}
            arrow
            large
            disabled={!picked || watching.has(picked) || !!busy}
            busy={!!busy && busy === picked}
            onPress={() => picked && watch(picked)}
          />
        ) : undefined
      }
    >
      <Header title={heading.title} subtitle={heading.subtitle} center />
      {error ? (
        <Banner
          tone="warn"
          body={error.message}
          action={error.signIn ? { title: "Sign in to ESPN again", onPress: () => router.replace("/connect/espn") } : undefined}
        />
      ) : null}

      {leagues.map((l) => (
        <Option key={l.leagueId + ":" + l.season} tone="light" selected={picked === l.leagueId} disabled={!!busy} onPress={() => setSelected(l.leagueId)}>
          <H2 style={{ fontSize: 20 }}>{l.leagueName || `League ${l.leagueId}`}</H2>
          <Muted style={{ marginTop: 2 }}>{l.teamName ? `Your team: ${l.teamName}` : `League ${l.leagueId}`}</Muted>
          {watching.has(l.leagueId) ? (
            <View style={{ marginTop: space.sm }}>
              <Pill text="Already watching" tone="calm" />
            </View>
          ) : null}
        </Option>
      ))}

      <View style={{ marginTop: leagues.length ? space.xl : 0 }}>
        {leagues.length ? <H2 style={{ marginBottom: space.xs }}>Don't see your league?</H2> : null}
        <Body style={{ marginBottom: space.lg }}>In the ESPN app or site, open your league and share or copy its link. Paste it here, or just the number after leagueId=.</Body>
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
        <Button title={busy && busy === typedId ? "Reading your team…" : "Watch this league"} arrow busy={!!busy && busy === typedId} disabled={!typedId || !!busy} onPress={() => typedId && watch(typedId)} />
      </View>
    </Screen>
  );
}
