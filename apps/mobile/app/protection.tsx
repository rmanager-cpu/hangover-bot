// How much RosterBots may do on its own. Bench Protection is the only level that moves
// players unattended, and only for a claimed account: an anonymous one works as Ask Me
// (enforced in core and the service, not here; this screen just doesn't offer it).
//
// The brand sheet's "Replacement source" and "Keep it safe" live here too. In the beta
// they are facts, not switches: the bench is the only source, and the app cannot trade,
// bid or drop at all (docs/brand/README.md).

import type { Authority } from "@rosterbots/core";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Alert, StyleSheet, Switch, View } from "react-native";
import { CheckDisc } from "../src/icons";
import { useData } from "../src/lib/data";
import { AUTHORITY } from "../src/lib/format";
import { usePush } from "../src/lib/push";
import { useSession } from "../src/lib/session";
import { finishSetup } from "../src/lib/setup";
import { color, space } from "../src/theme";
import { Banner, Body, Button, Card, Chip, H2, Header, Label, Loading, Muted, Option, Pill, Screen } from "../src/ui";

const LEVELS: { id: Authority; details: string[] }[] = [
  {
    id: "alerts",
    details: ["I watch your starters and tell you when one is ruled out, on bye, or a slot is empty.", "I never change your lineup."],
  },
  {
    id: "ask_me",
    details: ["When a starter can't play, I find the replacement and send it to you.", "Nothing changes until you tap Approve."],
  },
  {
    id: "bench_protection",
    details: [
      "Only for starters ruled OUT, on IR, suspended or on bye, and empty slots.",
      "I start the first eligible player in your replacement order, or else ESPN's highest projection.",
      "Only between 90 and 4 minutes before that game kicks off. Before that, I tell you what I'll do and when.",
      "The first move in a league waits until one change you made through RosterBots, like the test swap, has shown up on ESPN.",
      "Questionable and doubtful players are always your call.",
      "Every move is checked against ESPN before and after, with a receipt. If one doesn't go through, I tell you and don't retry.",
    ],
  },
];

// The sheet's copy, kept word for word; each is true of the beta by construction.
const RULES = ["Only act on officially OUT or inactive players", "Never make trades", "Never spend FAAB without asking", "Never drop a player without asking"];

export default function Protection() {
  const { id, setup } = useLocalSearchParams<{ id?: string; setup?: string }>();
  const data = useData();
  const { claimed } = useSession();
  const push = usePush();
  const conn = (id ? data.connections.find((c) => c.id === id) : null) ?? data.connection;
  const [saving, setSaving] = useState<Authority | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!conn) return <Loading />;
  const max = conn.maxAutoMovesPerDay;

  const choose = async (a: Authority) => {
    if (saving || a === conn.authority) return;
    if (a === "bench_protection" && !claimed) {
      router.push({ pathname: "/claim", params: { then: "bench_protection", id: conn.id, ...(setup === "1" ? { setup: "1" } : {}) } });
      return;
    }
    setSaving(a);
    setError(null);
    try {
      await data.updateConnection(conn.id, { authority: a });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save that. Try again.");
    } finally {
      setSaving(null);
    }
  };

  const next = () => {
    if (!claimed) router.push({ pathname: "/claim", params: { id: conn.id, setup: "1" } });
    else finishSetup();
  };

  // The phone's permission is the only switch there is: once allowed, alerts are turned
  // off in the phone's own Settings, not here.
  const alertsOn = push.state.status === "on";
  const setAlerts = (on: boolean) => {
    if (on) push.enable(true);
    else Alert.alert("Alerts stay on", "To turn alerts off, use your phone's Settings for RosterBots. Everything also shows in Activity.");
  };
  const alertsNote =
    push.state.status === "on"
      ? "On for this phone. I tell you before kickoff when a starter can't play, and after every move."
      : push.state.status === "denied"
        ? "Off. Flip the switch to allow alerts on this phone."
        : push.state.status === "unavailable"
          ? push.state.reason
          : push.state.status === "working"
            ? "Setting up…"
            : "I tell you before kickoff when a starter can't play, and after every move.";

  // ai_rescue isn't offered in the beta; the service treats it as Bench Protection.
  const current: Authority = conn.authority === "ai_rescue" ? "bench_protection" : conn.authority;

  return (
    <Screen footer={setup === "1" ? <Button title="Continue" arrow large onPress={next} /> : undefined}>
      <Header title="What should RosterBots do if a starter is ruled OUT?" subtitle={`For ${conn.teamName ?? "your team"}.`} />
      {error ? <Banner tone="warn" body={error} /> : null}
      {current === "bench_protection" && !claimed ? (
        <Banner
          tone="warn"
          title="Working as Ask me first for now"
          body="Bench Protection only moves players on its own for a claimed account. Until then I send you each move to approve."
          action={{ title: "Claim your account", onPress: () => router.push({ pathname: "/claim", params: { id: conn.id } }) }}
        />
      ) : null}

      {LEVELS.map((l) => {
        const on = current === l.id;
        const locked = l.id === "bench_protection" && !claimed;
        return (
          <Option key={l.id} selected={on} onPress={() => choose(l.id)}>
            <View style={s.head}>
              <View style={{ flex: 1 }}>
                <H2 style={{ fontSize: 20 }}>{AUTHORITY[l.id].ask}</H2>
                <Muted style={{ marginTop: 2 }}>{AUTHORITY[l.id].askDetail}</Muted>
              </View>
              {saving === l.id ? <Muted>Saving…</Muted> : locked ? <Pill text="Needs a claimed account" tone="orange" /> : null}
            </View>
            {on
              ? l.details.map((d) => (
                  <Muted key={d} style={s.detail}>
                    {"•"} {d}
                  </Muted>
                ))
              : null}
            {on && l.id === "bench_protection" ? <Muted style={s.detail}>{"•"} At most {max} automatic moves a day.</Muted> : null}
          </Option>
        );
      })}
      <Option disabled trailing="none">
        <View style={s.head}>
          <View style={{ flex: 1 }}>
            <H2 style={{ fontSize: 20 }}>{AUTHORITY.ai_rescue.name}</H2>
            <Muted style={{ marginTop: 2 }}>Help with judgment calls, free agents and IR. Not part of the beta.</Muted>
          </View>
          <Pill text="Coming soon" />
        </View>
      </Option>

      <Card>
        <H2>Replacement source</H2>
        <View style={s.chips}>
          <Chip text="Bench only" selected />
          <Chip text="Bench + free agents" selected={false} disabled note="Coming soon" />
        </View>
        <Muted style={{ marginTop: space.md }}>In the beta, replacements come from your bench. Free agents are AI Rescue's job, later.</Muted>
      </Card>

      <Card>
        <H2>Keep it safe.</H2>
        <Muted style={{ marginTop: space.xs }}>RosterBots will only act within these rules.</Muted>
        {RULES.map((r, i) => (
          <View key={r} style={[s.rule, i < RULES.length - 1 && s.ruleLine]}>
            <CheckDisc size={26} />
            <Body style={{ flex: 1, fontWeight: "600" }}>{r}</Body>
          </View>
        ))}
      </Card>

      <Card>
        <H2>Notifications</H2>
        <View style={[s.rule, { paddingBottom: space.sm }]}>
          <Body style={{ flex: 1, fontWeight: "600" }}>Send Sunday lineup alerts</Body>
          <Switch
            value={alertsOn}
            disabled={push.state.status === "working" || push.state.status === "unavailable"}
            onValueChange={setAlerts}
            trackColor={{ true: color.orange, false: color.inkLine }}
            thumbColor={color.white}
            ios_backgroundColor={color.inkLine}
          />
        </View>
        <Muted>{alertsNote}</Muted>
      </Card>

      <Label style={{ marginTop: space.sm }}>You can change this any time in Settings.</Label>
    </Screen>
  );
}

const s = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "center", gap: space.md },
  detail: { marginTop: space.sm },
  chips: { flexDirection: "row", gap: space.sm, marginTop: space.md },
  rule: { flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.md },
  ruleLine: { borderBottomWidth: 1, borderBottomColor: color.inkLine },
});
