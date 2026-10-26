// How much RosterBots may do on its own: the three levels of docs/AI-NATIVE.md. Auto Protect
// and AI Native move players unattended, and only for a claimed account: an anonymous one
// works as Alert Me (enforced in core and the service, not here; this screen just says so).
// Choosing AI Native goes through the Droppable screen first, since that is its opt-in.

import type { Authority } from "@rosterbots/core";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Alert, StyleSheet, Switch, View } from "react-native";
import { CheckDisc } from "../src/icons";
import { useData } from "../src/lib/data";
import { AUTHORITY, levelOf } from "../src/lib/format";
import { usePush } from "../src/lib/push";
import { useSession } from "../src/lib/session";
import { finishSetup } from "../src/lib/setup";
import { color, space } from "../src/theme";
import { Banner, Body, Button, Card, Chip, H2, Header, Label, Loading, Muted, Option, Pill, Screen } from "../src/ui";

type Level = Exclude<Authority, "alerts">;

const LEVELS: { id: Level; details: string[] }[] = [
  {
    id: "ask_me",
    details: [
      "I watch your starters and push you when one is ruled out, on bye, projected for zero, or a slot is empty.",
      "The push carries the fix: one tap in the app makes it. Nothing changes until you tap.",
      "Three minutes before each kickoff, an all-clear, or what is still wrong.",
    ],
  },
  {
    id: "bench_protection",
    details: [
      "Only for starters ruled OUT, on IR, suspended, on bye or projected for zero, and empty slots.",
      "I start the first eligible player in your replacement order, or else ESPN's highest projection.",
      "Only between 90 and 3 minutes before that game kicks off. Before that, I tell you what I'll do and when.",
      "The first move in a league waits until one change you made through RosterBots, like the test swap, has shown up on ESPN.",
      "Questionable and doubtful players are always your call.",
      "Every move is checked against ESPN before and after, with a receipt. If one doesn't go through, I tell you and don't retry.",
    ],
  },
  {
    id: "ai_rescue",
    details: [
      "Everything Auto Protect does, from your bench at T-90.",
      "At T-15, if the bench couldn't fill a hole, or a free agent is clearly better than my fill, I add him: an open roster spot first, then an open IR slot, and only then a drop, of a player you marked Droppable.",
      "Roster Advice a few times a week: injuries, bye weeks, a position with no backup, and running backs who got hurt and their backups. One tap carries a suggestion out; nothing happens on its own.",
      "Never a trade, a waiver claim or a FAAB bid. Never a drop of a starter who's playing, of anyone who'll be back, or of anyone rostered in most ESPN leagues.",
      "What the AI sees: your players, their statuses, projections and kickoffs. Never your ESPN sign-in or your email.",
    ],
  },
];

// The brand sheet's "Keep it safe" list, as true of each level by construction.
const RULES: Record<Level, string[]> = {
  ask_me: ["Only act on officially OUT or inactive players", "Never make trades", "Never spend FAAB without asking", "Never drop a player without asking"],
  bench_protection: ["Only act on officially OUT or inactive players", "Never make trades", "Never spend FAAB without asking", "Never drop a player without asking"],
  ai_rescue: ["Only act on officially OUT or inactive players", "Never make trades", "Never claim waivers or spend FAAB", "Only drop players you marked Droppable, and never one who'll be back"],
};

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
  const current = levelOf(conn.authority);
  const unattended = (a: Level) => a === "bench_protection" || a === "ai_rescue";

  const choose = async (a: Level) => {
    if (saving || a === current) return;
    const setupParams = setup === "1" ? { setup: "1" } : {};
    if (unattended(a) && !claimed) {
      router.push({ pathname: "/claim", params: { then: a, id: conn.id, ...setupParams } });
      return;
    }
    // AI Native's opt-in is the Droppable screen; it saves the level with the switches.
    if (a === "ai_rescue") {
      router.push({ pathname: "/droppable", params: { id: conn.id, then: "ai_rescue", ...setupParams } });
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

  return (
    <Screen footer={setup === "1" ? <Button title="Continue" arrow large onPress={next} /> : undefined}>
      <Header title="What should RosterBots do if a starter is ruled OUT?" subtitle={`For ${conn.teamName ?? "your team"}.`} />
      {error ? <Banner tone="warn" body={error} /> : null}
      {unattended(current) && !claimed ? (
        <Banner
          tone="warn"
          title="Working as Alert Me for now"
          body={`${AUTHORITY[current].name} only moves players on its own once you sign in with Google. Until then I send you each move to tap.`}
          action={{ title: "Sign in with Google", onPress: () => router.push({ pathname: "/claim", params: { id: conn.id } }) }}
        />
      ) : null}

      {LEVELS.map((l) => {
        const on = current === l.id;
        const locked = unattended(l.id) && !claimed;
        return (
          <Option key={l.id} selected={on} onPress={() => choose(l.id)}>
            <View style={s.head}>
              <View style={{ flex: 1 }}>
                <H2 style={{ fontSize: 20 }}>{AUTHORITY[l.id].ask}</H2>
                <Muted style={{ marginTop: 2 }}>{AUTHORITY[l.id].askDetail}</Muted>
              </View>
              {saving === l.id ? <Muted>Saving…</Muted> : locked ? <Pill text="Needs Google sign-in" tone="orange" /> : null}
            </View>
            {on
              ? l.details.map((d) => (
                  <Muted key={d} style={s.detail}>
                    {"•"} {d}
                  </Muted>
                ))
              : null}
            {on && unattended(l.id) ? <Muted style={s.detail}>{"•"} At most {max} automatic moves a day.</Muted> : null}
            {on && l.id === "ai_rescue" ? (
              <Button
                title={conn.droppable.length ? `Droppable players: ${conn.droppable.length}` : "Droppable players: none yet"}
                variant="secondary"
                onPress={() => router.push({ pathname: "/droppable", params: { id: conn.id } })}
                style={{ marginTop: space.md, alignSelf: "flex-start" }}
              />
            ) : null}
          </Option>
        );
      })}

      <Card>
        <H2>Replacement source</H2>
        <View style={s.chips}>
          <Chip text="Bench only" selected={current !== "ai_rescue"} />
          <Chip text="Bench + free agents" selected={current === "ai_rescue"} />
        </View>
        <Muted style={{ marginTop: space.md }}>
          {current === "ai_rescue"
            ? "Your bench first, at T-90. Free agents only at T-15, only for a hole the bench couldn't fill or a clearly better fill, and only free agents: never a waiver claim."
            : "Replacements come from your bench. Free agents are AI Native's job."}
        </Muted>
      </Card>

      <Card>
        <H2>Keep it safe.</H2>
        <Muted style={{ marginTop: space.xs }}>RosterBots will only act within these rules.</Muted>
        {RULES[current].map((r, i) => (
          <View key={r} style={[s.rule, i < RULES[current].length - 1 && s.ruleLine]}>
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
