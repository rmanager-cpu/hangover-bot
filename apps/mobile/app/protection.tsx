// How much HangoverBot may do on its own. Bench Protection is the only level that moves
// players unattended, and only for a claimed account: an anonymous one works as Ask Me
// (enforced in core and the service, not here; this screen just doesn't offer it).

import type { Authority } from "@rosterbots/core";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useData } from "../src/lib/data";
import { AUTHORITY } from "../src/lib/format";
import { useSession } from "../src/lib/session";
import { finishSetup } from "../src/lib/setup";
import { color, radius, space } from "../src/theme";
import { Banner, Body, Button, H2, Label, Loading, Muted, Pill, Screen } from "../src/ui";

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
      "The first move in a league waits until one change you made through HangoverBot, like the test swap, has shown up on ESPN.",
      "Questionable and doubtful players are always your call.",
      "Every move is checked against ESPN before and after, with a receipt. If one doesn't go through, I tell you and don't retry.",
    ],
  },
];

export default function Protection() {
  const { id, setup } = useLocalSearchParams<{ id?: string; setup?: string }>();
  const data = useData();
  const { claimed } = useSession();
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

  // ai_rescue isn't offered in the beta; the service treats it as Bench Protection.
  const current: Authority = conn.authority === "ai_rescue" ? "bench_protection" : conn.authority;

  return (
    <Screen footer={setup === "1" ? <Button title="Continue" large onPress={next} /> : undefined}>
      <Body>
        What may HangoverBot do for {conn.teamName ?? "your team"}?
      </Body>
      {error ? <Banner tone="warn" body={error} /> : null}
      {current === "bench_protection" && !claimed ? (
        <Banner
          tone="warn"
          title="Working as Ask Me for now"
          body="Bench Protection only moves players on its own for a claimed account. Until then I send you each move to approve."
          action={{ title: "Claim your account", onPress: () => router.push({ pathname: "/claim", params: { id: conn.id } }) }}
        />
      ) : null}

      <View style={{ marginTop: space.lg }}>
        {LEVELS.map((l) => {
          const on = current === l.id;
          const locked = l.id === "bench_protection" && !claimed;
          return (
            <Pressable
              key={l.id}
              accessibilityRole="radio"
              accessibilityState={{ checked: on, busy: saving === l.id }}
              onPress={() => choose(l.id)}
              style={({ pressed }) => [s.option, on && s.optionOn, pressed && { opacity: 0.85 }]}
            >
              <View style={s.head}>
                <View style={[s.radio, on && s.radioOn]}>{on ? <View style={s.radioDot} /> : null}</View>
                <H2 style={{ flex: 1 }}>{AUTHORITY[l.id].name}</H2>
                {saving === l.id ? <Muted>Saving…</Muted> : locked ? <Pill text="Needs a claimed account" /> : null}
              </View>
              {l.details.map((d) => (
                <Muted key={d} style={s.detail}>
                  {d}
                </Muted>
              ))}
              {l.id === "bench_protection" ? <Muted style={s.detail}>At most {max} automatic moves a day.</Muted> : null}
            </Pressable>
          );
        })}
        <View style={[s.option, { opacity: 0.55 }]}>
          <View style={s.head}>
            <View style={s.radio} />
            <H2 style={{ flex: 1 }}>{AUTHORITY.ai_rescue.name}</H2>
            <Pill text="Coming soon" />
          </View>
          <Muted style={s.detail}>Help with judgment calls, free agents and IR. Not part of the beta.</Muted>
        </View>
      </View>
      <Label style={{ marginTop: space.lg }}>You can change this any time in Settings.</Label>
    </Screen>
  );
}

const s = StyleSheet.create({
  option: { backgroundColor: color.navy, borderRadius: radius.md, borderWidth: 1.5, borderColor: color.line, padding: space.lg, marginBottom: space.md },
  optionOn: { borderColor: color.electric, backgroundColor: color.purpleSoft },
  head: { flexDirection: "row", alignItems: "center", gap: space.md, marginBottom: space.xs },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: color.faint, alignItems: "center", justifyContent: "center" },
  radioOn: { borderColor: color.electric },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: color.electric },
  detail: { marginTop: space.xs, marginLeft: 22 + space.md },
});
