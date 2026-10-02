import Constants from "expo-constants";
import { router } from "expo-router";
import { useState } from "react";
import { StyleSheet, Switch, View } from "react-native";
import { useData } from "../../src/lib/data";
import { agoText, AUTHORITY } from "../../src/lib/format";
import { usePush } from "../../src/lib/push";
import { useSession } from "../../src/lib/session";
import { color, space } from "../../src/theme";
import { Banner, Body, Card, H2, Label, Loading, Muted, Row, Screen } from "../../src/ui";

export default function Settings() {
  const data = useData();
  const { user, claimed } = useSession();
  const push = usePush();
  const conn = data.connection;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!conn) return <Loading />;

  const authority = AUTHORITY[conn.authority === "ai_rescue" ? "bench_protection" : conn.authority].name;
  const watching = conn.status === "active";
  const statusLine =
    conn.status === "needs_reauth"
      ? "ESPN signed HangoverBot out. Sign in again below."
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
        <Body style={{ marginTop: space.sm, color: conn.status === "needs_reauth" ? color.orange : color.text }}>{statusLine}</Body>
        <View style={s.switchRow}>
          <Body style={{ flex: 1 }}>Watch this league</Body>
          <Switch
            value={watching}
            disabled={saving || conn.status === "needs_reauth"}
            onValueChange={setWatching}
            trackColor={{ true: color.purple, false: color.raised }}
            thumbColor={color.paper}
          />
        </View>
        <Row title="What we read from ESPN" detail="Your team as HangoverBot sees it, and the test swap" onPress={() => router.push({ pathname: "/read/[id]", params: { id: conn.id } })} />
        <Row title="Protection" value={authority} onPress={() => router.push({ pathname: "/protection", params: { id: conn.id } })} />
        <Row
          title="Replacement order"
          value={conn.replacementOrder.length ? "Yours" : "ESPN projections"}
          onPress={() => router.push({ pathname: "/order", params: { id: conn.id } })}
          last
        />
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
          detail="When ESPN signs HangoverBot out, or you changed your ESPN password"
          tone={conn.status === "needs_reauth" ? "warn" : undefined}
          onPress={() => router.push({ pathname: "/connect/espn", params: { mode: "reauth" } })}
        />
        <Row title="Watch another league" onPress={() => router.push("/connect/leagues")} last />
      </Card>

      <Label>Account</Label>
      <Card>
        {claimed ? (
          <Row title="Claimed" value={user?.email ?? undefined} last />
        ) : (
          <Row title="Claim your account" detail="Needed for Bench Protection to act on its own" onPress={() => router.push({ pathname: "/claim", params: { id: conn.id } })} last />
        )}
      </Card>

      <Label>Alerts</Label>
      <Card>
        <Row title="Alerts on this phone" detail={pushLine} onPress={push.state.status === "on" ? undefined : () => push.enable(true)} last />
      </Card>

      <Label>About</Label>
      <Card>
        <H2>HangoverBot</H2>
        <Muted>Fantasy help for real life. By TurboLabs.</Muted>
        <Body style={{ marginTop: space.md }}>
          HangoverBot reads your ESPN team with the sign-in you gave it in this app, and never sees your ESPN password. It changes your lineup only as your protection setting allows, and tells you every time it does.
        </Body>
        <Muted style={{ marginTop: space.md }}>Version {Constants.expoConfig?.version ?? "unknown"} · beta</Muted>
      </Card>
    </Screen>
  );
}

const s = StyleSheet.create({
  switchRow: { flexDirection: "row", alignItems: "center", paddingVertical: space.md, borderBottomWidth: 1, borderBottomColor: color.line, marginTop: space.sm },
});
