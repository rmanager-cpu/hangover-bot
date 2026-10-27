import Constants from "expo-constants";
import { router } from "expo-router";
import { useState } from "react";
import { Alert, StyleSheet, Switch, View } from "react-native";
import { api, messageOf } from "../../src/lib/api";
import { dbMessage, useData } from "../../src/lib/data";
import { agoText, AUTHORITY, levelOf } from "../../src/lib/format";
import { usePush } from "../../src/lib/push";
import { useSession } from "../../src/lib/session";
import { supabase } from "../../src/lib/supabase";
import { color, space } from "../../src/theme";
import { Banner, Body, Card, H2, Label, Loading, Muted, Row, Screen, Wordmark } from "../../src/ui";

export default function Settings() {
  const data = useData();
  const { user, claimed, retry } = useSession();
  const push = usePush();
  const conn = data.connection;
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!conn) return <Loading />;

  // Deleting the credentials row takes every league with it (cascade) and the ESPN cookies
  // out of Vault (a database trigger), so nothing keeps reading ESPN as this user.
  const forgetEspn = () => {
    const leagues = data.connections.length === 1 ? "your league" : `your ${data.connections.length} leagues`;
    Alert.alert(
      "Forget your ESPN sign-in?",
      `RosterBots stops watching ${leagues}, deletes the ESPN sign-in it kept, and forgets your lineup history. Your ESPN account itself is not touched. You can sign in to ESPN again any time.`,
      [
        { text: "Keep it", style: "cancel" },
        {
          text: "Forget it",
          style: "destructive",
          onPress: async () => {
            setSaving(true);
            setError(null);
            const { error: e } = await supabase.from("credentials").delete().eq("provider", "espn");
            setSaving(false);
            if (e) return setError(dbMessage(e));
            await data.refresh().catch(() => {});
            router.replace("/welcome");
          },
        },
      ],
    );
  };

  // The server deletes the auth user; every table cascades from it (including the Vault
  // secret for an ESPN session, by its own trigger), so one call removes everything. Then
  // the phone starts over: signed out, and a fresh anonymous session takes its place, the
  // same as a first launch.
  const deleteAccount = () => {
    Alert.alert(
      "Delete your RosterBots account?",
      claimed
        ? `This permanently deletes the account signed in as ${user?.email}: every league you're watching, your ESPN sign-in, your settings, activity and receipts, and this phone's push notifications. Your ESPN account itself is not touched. This can't be undone.`
        : "This permanently deletes this RosterBots account: every league you're watching, your ESPN sign-in, your settings, activity and receipts, and this phone's push notifications. Your ESPN account itself is not touched. This can't be undone.",
      [
        { text: "Keep my account", style: "cancel" },
        {
          text: "Delete my account",
          style: "destructive",
          onPress: async () => {
            setDeleting(true);
            setError(null);
            try {
              await api.deleteAccount();
            } catch (e) {
              setDeleting(false);
              return setError(messageOf(e));
            }
            await supabase.auth.signOut().catch(() => {});
            // Tears this screen down: Gate shows Loading while a fresh anonymous session
            // starts, then the index route lands on Welcome since it has no leagues.
            retry();
          },
        },
      ],
    );
  };

  const level = levelOf(conn.authority);
  const authority = AUTHORITY[level].name;
  const waitingAdvice = data.advice.filter((a) => a.connectionId === conn.id && a.status === "pending").length;
  const watching = conn.status === "active";
  const statusLine =
    conn.status === "needs_reauth"
      ? "ESPN signed RosterBots out. Sign in again below."
      : conn.status === "paused"
        ? "Paused. I'm not checking this league."
        : conn.lastCheckedAt
          ? `Watching. Last checked ${agoText(conn.lastCheckedAt)}.`
          : "Watching. First check coming up.";

  const setWatching = async (on: boolean) => {
    setSaving(true);
    setError(null);
    try {
      await data.updateConnection(conn.id, { status: on ? "active" : "paused" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save that. Try again.");
    } finally {
      setSaving(false);
    }
  };

  const pushLine =
    push.state.status === "on"
      ? "On for this phone."
      : push.state.status === "denied"
        ? "Off. Tap to allow alerts."
        : push.state.status === "unavailable"
          ? push.state.reason
          : push.state.status === "working"
            ? "Setting up…"
            : "Tap to turn on.";

  return (
    <Screen edges={["left", "right"]}>
      {error ? <Banner tone="warn" body={error} /> : null}

      <Label>League</Label>
      <Card>
        <H2>{conn.leagueName ?? `League ${conn.leagueId}`}</H2>
        <Muted>
          {conn.teamName ?? "Your team"} · {conn.season}
        </Muted>
        <Body style={{ marginTop: space.sm, color: conn.status === "needs_reauth" ? color.orangeInk : color.ink }}>{statusLine}</Body>
        <View style={s.switchRow}>
          <Body style={{ flex: 1, fontWeight: "600" }}>Watch this league</Body>
          <Switch
            value={watching}
            disabled={saving || conn.status === "needs_reauth"}
            onValueChange={setWatching}
            trackColor={{ true: color.orange, false: color.inkLine }}
            thumbColor={color.white}
            ios_backgroundColor={color.inkLine}
          />
        </View>
        <Row title="What we read from ESPN" detail="Your team as RosterBots sees it, and the test swap" onPress={() => router.push({ pathname: "/read/[id]", params: { id: conn.id } })} />
        <Row title="Protection" value={authority} onPress={() => router.push({ pathname: "/protection", params: { id: conn.id } })} />
        <Row
          title="Replacement order"
          value={conn.replacementOrder.length ? "Yours" : "ESPN projections"}
          onPress={() => router.push({ pathname: "/order", params: { id: conn.id } })}
          last={level !== "ai_rescue"}
        />
        {level === "ai_rescue" ? (
          <>
            <Row
              title="Droppable players"
              value={conn.droppable.length ? `${conn.droppable.length} marked` : "None"}
              onPress={() => router.push({ pathname: "/droppable", params: { id: conn.id } })}
            />
            <Row title="Roster Advice" value={waitingAdvice ? `${waitingAdvice} waiting` : undefined} onPress={() => router.push("/advice")} last />
          </>
        ) : null}
      </Card>

      {data.connections.length > 1 ? (
        <>
          <Label>Your leagues</Label>
          <Card>
            {data.connections.map((c, i) => (
              <Row
                key={c.id}
                title={c.leagueName ?? `League ${c.leagueId}`}
                detail={c.teamName ?? undefined}
                value={c.id === conn.id ? "Showing" : undefined}
                onPress={c.id === conn.id ? undefined : () => data.select(c.id)}
                last={i === data.connections.length - 1}
              />
            ))}
          </Card>
        </>
      ) : null}

      <Label>ESPN</Label>
      <Card>
        <Row
          title="Sign in to ESPN again"
          detail="When ESPN signs RosterBots out, or you changed your ESPN password"
          tone={conn.status === "needs_reauth" ? "warn" : undefined}
          onPress={() => router.push({ pathname: "/connect/espn", params: { mode: "reauth" } })}
        />
        <Row title="Watch another league" onPress={() => router.push("/connect/leagues")} />
        <Row title="Forget my ESPN sign-in" detail="Stops watching every league and deletes the sign-in RosterBots kept" tone="warn" onPress={saving ? undefined : forgetEspn} last />
      </Card>

      <Label>Account</Label>
      <Card>
        {claimed ? (
          <Row title="Signed in" value={user?.email ?? undefined} onPress={() => router.push("/claim")} />
        ) : (
          <Row
            title="Sign in with Google"
            detail="Keeps your leagues on a new phone, and lets Auto Protect and AI Native act on their own"
            onPress={() => router.push({ pathname: "/claim", params: { id: conn.id } })}
          />
        )}
        <Row
          title="Delete my account"
          detail="Permanently deletes everything RosterBots has: leagues, your ESPN sign-in, settings, activity and receipts"
          tone="warn"
          onPress={deleting || saving ? undefined : deleteAccount}
          last
        />
      </Card>

      <Label>Alerts</Label>
      <Card>
        <Row title="Alerts on this phone" detail={pushLine} onPress={push.state.status === "on" ? undefined : () => push.enable(true)} last />
      </Card>

      <Label>About</Label>
      <Card tone="dark">
        <Wordmark width={180} />
        <Muted style={{ marginTop: space.sm }}>RosterBots: Hangover Protection. Fantasy insurance for real life.</Muted>
        <Body style={{ marginTop: space.md }}>
          RosterBots reads your ESPN team with the sign-in you gave it in this app, and never sees your ESPN password. It changes your lineup only as your protection setting allows, and tells you every time it does.
        </Body>
        <Muted style={{ marginTop: space.md }}>Version {Constants.expoConfig?.version ?? "unknown"} · beta · by Turbo Devs</Muted>
      </Card>
    </Screen>
  );
}

const s = StyleSheet.create({
  switchRow: { flexDirection: "row", alignItems: "center", paddingVertical: space.md, borderBottomWidth: 1, borderBottomColor: color.inkLine, marginTop: space.sm },
});
