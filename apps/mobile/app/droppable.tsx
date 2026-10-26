// AI Native's opt-in (docs/AI-NATIVE.md): one screen, every player on the roster with a
// switch, Droppable or Not droppable. Everyone starts Not droppable, and so does anyone
// RosterBots adds later. Even a Droppable player is kept by the No-Cray Rules: never a
// starter who is playing, never anyone who will be back, never anyone most leagues roster.

import type { RosterEntry } from "@rosterbots/core";
import { router, useLocalSearchParams } from "expo-router";
import { useMemo, useState } from "react";
import { StyleSheet, Switch, Text, View } from "react-native";
import { useData } from "../src/lib/data";
import { slotLabel, statusTag } from "../src/lib/format";
import { finishSetup } from "../src/lib/setup";
import { color, font, space } from "../src/theme";
import { Banner, Body, Button, Card, H2, Header, Loading, Muted, Screen } from "../src/ui";

const RULES = [
  "Only to fix a hole at kickoff, after your bench couldn't, or when a free agent is clearly better than my fill.",
  "An open roster spot first, then an open IR slot. A drop only when there's neither.",
  "Never a starter who's playing this week, never a player who'll be back, never anyone rostered in most ESPN leagues.",
  "Judged on the rest of the season, never one bye week. Anything in doubt becomes a question for you.",
];

export default function Droppable() {
  const { id, then, setup } = useLocalSearchParams<{ id?: string; then?: string; setup?: string }>();
  const data = useData();
  const conn = (id ? data.connections.find((c) => c.id === id) : null) ?? data.connection;
  const [marked, setMarked] = useState<Set<string>>(() => new Set(conn?.droppable ?? []));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Starters in the league's slot order, then the bench, then IR, as the ESPN app lists them.
  const players = useMemo(() => {
    const r = conn?.lastRoster;
    if (!r) return [];
    const rank = (e: RosterEntry) => {
      const i = r.starterSlots.indexOf(e.slot);
      return i !== -1 ? i : e.slot === "BENCH" ? 1000 : 1001;
    };
    return [...r.entries].sort((a, b) => rank(a) - rank(b));
  }, [conn?.lastRoster]);

  if (!conn) return <Loading />;
  if (!conn.lastRoster) {
    return (
      <Screen>
        <Header title="Droppable players" subtitle="RosterBots hasn't read your team yet. Open “What we read from ESPN” first, then come back." />
      </Screen>
    );
  }

  const turningOn = then === "ai_rescue";
  const changed = turningOn || [...marked].sort().join() !== [...conn.droppable].sort().join();

  const toggle = (playerId: string, on: boolean) => {
    setMarked((cur) => {
      const next = new Set(cur);
      if (on) next.add(playerId);
      else next.delete(playerId);
      return next;
    });
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      // Only ids still on the roster are kept; a player who left takes his switch with him.
      const ids = players.filter((e) => marked.has(e.player.id)).map((e) => e.player.id);
      await data.updateConnection(conn.id, { droppable: ids, ...(turningOn ? { authority: "ai_rescue" } : {}) });
      if (setup === "1") finishSetup();
      else if (router.canGoBack()) router.back();
      else router.replace("/settings");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save that. Try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen
      footer={
        <Button
          title={turningOn ? (marked.size ? `Turn on AI Native with ${marked.size} droppable` : "Turn on AI Native with nobody droppable") : "Save"}
          arrow
          large
          busy={saving}
          disabled={!changed}
          onPress={save}
        />
      }
    >
      <Header
        title={turningOn ? "Who may AI Native drop?" : "Droppable players"}
        subtitle="AI Native may add a free agent and drop a player to fix a hole at kickoff. It only ever drops a player you switch to Droppable here, and everyone starts Not droppable."
        style={{ marginBottom: space.sm }}
      />
      <Muted style={{ marginBottom: space.lg }}>
        With nobody droppable, it still adds into an open roster spot or an open IR slot, and anything that would need a drop comes to you as a question.
      </Muted>
      {error ? <Banner tone="warn" body={error} /> : null}

      <Card style={s.table}>
        {players.map((e, i) => {
          const p = e.player;
          const tag = statusTag(p.status);
          const on = marked.has(p.id);
          return (
            <View key={p.id} style={[s.row, i < players.length - 1 && s.rowLine, on && s.rowOn]}>
              <Text style={s.slot}>{slotLabel(e.slot)}</Text>
              <View style={{ flex: 1 }}>
                <Text style={s.name} numberOfLines={1}>
                  {p.name}
                </Text>
                <Muted>
                  {p.position} · {p.proTeam}
                  {tag ? ` · ${tag.word}` : ""}
                  {p.percentRostered !== undefined ? ` · ${Math.round(p.percentRostered)}% rostered` : ""}
                </Muted>
                <Text style={[s.state, on && { color: color.orangeInk }]}>{on ? "Droppable" : "Not droppable"}</Text>
              </View>
              <Switch
                value={on}
                onValueChange={(v) => toggle(p.id, v)}
                disabled={saving}
                trackColor={{ true: color.orange, false: color.inkLine }}
                thumbColor={color.white}
                ios_backgroundColor={color.inkLine}
                accessibilityLabel={`${p.name} droppable`}
              />
            </View>
          );
        })}
      </Card>

      <Card tone="dark">
        <H2>Even a Droppable player is kept safe.</H2>
        {RULES.map((r) => (
          <Body key={r} style={{ marginTop: space.sm }}>
            {"•"} {r}
          </Body>
        ))}
      </Card>
    </Screen>
  );
}

const s = StyleSheet.create({
  table: { padding: 0, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", paddingVertical: space.md, paddingHorizontal: space.lg, gap: space.md, borderLeftWidth: 4, borderLeftColor: "transparent" },
  rowLine: { borderBottomColor: color.inkLine, borderBottomWidth: 1 },
  rowOn: { borderLeftColor: color.orange, backgroundColor: color.orangeSoft },
  slot: { width: 48, color: color.inkMuted, fontSize: font.small, fontWeight: "800" },
  name: { color: color.ink, fontSize: font.body, fontWeight: "700" },
  state: { color: color.inkFaint, fontSize: font.tiny, fontWeight: "700", marginTop: 2, textTransform: "uppercase", letterSpacing: 0.5 },
});
