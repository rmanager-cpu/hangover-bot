// Roster Advice (docs/AI-NATIVE.md): what the AI suggested after its last scan, newest
// first, with its reasons and sources. An item with a move has a one-tap button that goes
// through the server like any approval: re-read, the No-Cray Rules, write, verify, receipt.
// Nothing here happens on its own.

import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Linking, Pressable, StyleSheet, View } from "react-native";
import { api, messageOf } from "../src/lib/api";
import { useData, usePull, type Proposal } from "../src/lib/data";
import { whenText } from "../src/lib/format";
import { color, space } from "../src/theme";
import { Banner, Body, Button, Card, H2, Header, Label, Muted, Pill, Screen } from "../src/ui";

type Answer = { id: string; ok: boolean; message: string };

const sentence = (t: string) => (/[.!?]$/.test(t) ? t : t + ".");

export default function Advice() {
  const data = useData();
  const { refresh } = data;
  const pull = usePull();
  const [busy, setBusy] = useState<{ id: string; decision: "approve" | "decline" } | null>(null);
  const [answers, setAnswers] = useState<Record<string, Answer>>({});

  useFocusEffect(
    useCallback(() => {
      refresh().catch(() => {});
    }, [refresh]),
  );

  const conn = data.connection;
  const items = data.advice.filter((a) => !conn || a.connectionId === conn.id);
  const now = Date.now();

  const decide = async (p: Proposal, decision: "approve" | "decline") => {
    if (busy) return;
    setBusy({ id: p.id, decision });
    let answer: Answer;
    try {
      const r = await api.decide(p.id, decision);
      answer = { id: p.id, ok: r.ok, message: r.message };
    } catch (e) {
      answer = { id: p.id, ok: false, message: messageOf(e) };
    }
    setAnswers((cur) => ({ ...cur, [p.id]: answer }));
    setBusy(null);
    refresh().catch(() => {});
  };

  const status = (p: Proposal): { text: string; tone: "plain" | "healthy" | "warn" | "out" | "calm" } => {
    if (p.status === "done") return { text: "Done", tone: "healthy" };
    if (p.status === "declined") return { text: "Dismissed", tone: "plain" };
    if (p.status === "expired" || (p.deadline && Date.parse(p.deadline) <= now)) return { text: "Moment passed", tone: "plain" };
    if (p.status === "failed") return { text: "Didn't go through", tone: "out" };
    return p.transaction ? { text: "One tap", tone: "warn" } : { text: "Heads-up", tone: "calm" };
  };

  return (
    <Screen {...pull}>
      <Header
        title="Roster Advice"
        subtitle={conn?.leagueName ? `For ${conn.teamName ?? "your team"} in ${conn.leagueName}.` : undefined}
        style={{ marginBottom: space.sm }}
      />
      <Muted style={{ marginBottom: space.lg }}>
        A few times a week the AI scans your roster and the free agents, with a limited web search for injury news and depth charts. Nothing here happens until you tap.
      </Muted>
      {data.error ? <Banner tone="warn" body={data.error} /> : null}
      {conn && conn.authority !== "ai_rescue" ? (
        <Banner body="Roster Advice is part of AI Native." action={{ title: "Protection", onPress: () => router.push({ pathname: "/protection", params: { id: conn.id } }) }} />
      ) : null}

      {items.length === 0 ? <Muted>Nothing yet. The first scan runs on a weekday morning, and Saturday evening before Sunday's games.</Muted> : null}

      {items.map((p) => {
        const answer = answers[p.id];
        const st = status(p);
        const open = p.status === "pending" && st.text !== "Moment passed" && !answer;
        const mine = busy?.id === p.id;
        return (
          <Card key={p.id} tone={open && p.transaction ? "warn" : "light"}>
            <View style={s.meta}>
              <Pill text={st.text} tone={st.tone} />
              <Muted>{whenText(p.createdAt)}</Muted>
            </View>
            <H2 style={{ marginTop: space.sm }}>{p.summary}</H2>
            <Body style={{ marginTop: space.xs }}>{sentence(p.reason)}</Body>
            {p.transaction ? (
              <Label style={{ marginTop: space.sm }}>
                The move: add {p.transaction.add.name}
                {p.transaction.room.how === "drop" ? `, drop ${p.transaction.room.name}` : p.transaction.room.how === "ir" ? `, move ${p.transaction.room.name} to IR` : ", into an open spot"}
              </Label>
            ) : null}
            {p.deadline ? <Muted style={{ marginTop: space.xs }}>Until {whenText(p.deadline)}.</Muted> : null}
            {p.sources.length ? (
              <View style={{ marginTop: space.sm }}>
                {p.sources.map((src) => (
                  <Pressable key={src} onPress={() => (src.startsWith("http") ? Linking.openURL(src).catch(() => {}) : undefined)} accessibilityRole={src.startsWith("http") ? "link" : undefined}>
                    <Muted style={src.startsWith("http") ? s.link : undefined} numberOfLines={1}>
                      {src.startsWith("http") ? src.replace(/^https?:\/\//, "") : `Source: ${src}`}
                    </Muted>
                  </Pressable>
                ))}
              </View>
            ) : null}
            {answer ? (
              <Body style={{ marginTop: space.sm, color: answer.ok ? color.greenInk : color.redInk }}>{answer.message}</Body>
            ) : open ? (
              <View style={s.actions}>
                {p.transaction ? (
                  <Button title="Do it" arrow busy={mine && busy?.decision === "approve"} disabled={!!busy} onPress={() => decide(p, "approve")} style={s.action} />
                ) : null}
                <Button
                  title={p.transaction ? "Not now" : "Got it"}
                  variant="secondary"
                  busy={mine && busy?.decision === "decline"}
                  disabled={!!busy}
                  onPress={() => decide(p, "decline")}
                  style={s.action}
                />
              </View>
            ) : null}
          </Card>
        );
      })}
    </Screen>
  );
}

const s = StyleSheet.create({
  meta: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  link: { color: color.orangeInk, textDecorationLine: "underline" },
  actions: { flexDirection: "row", gap: space.sm, marginTop: space.lg },
  action: { flex: 1, paddingHorizontal: space.md },
});
