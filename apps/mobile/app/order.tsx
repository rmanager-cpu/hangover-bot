// The user's replacement order: who comes off the bench first. It beats ESPN's projections
// when the rules pick a replacement (handoff section 9).

import type { RosterEntry } from "@rosterbots/core";
import { router, useLocalSearchParams } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useData } from "../src/lib/data";
import { slotLabel } from "../src/lib/format";
import { color, font, radius, space } from "../src/theme";
import { Banner, Body, Button, Loading, Muted, Screen } from "../src/ui";

export default function ReplacementOrder() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const data = useData();
  const conn = (id ? data.connections.find((c) => c.id === id) : null) ?? data.connection;

  // Bench players, in the saved order first, then by projection. Starters aren't listed:
  // they're already playing.
  const initial = useMemo(() => {
    const bench = (conn?.lastRoster?.entries ?? []).filter((e) => e.slot === "BENCH");
    const order = conn?.replacementOrder ?? [];
    const rank = (e: RosterEntry) => {
      const i = order.indexOf(e.player.id);
      return i === -1 ? order.length : i;
    };
    return [...bench].sort((a, b) => rank(a) - rank(b) || (b.player.projection ?? -1) - (a.player.projection ?? -1)).map((e) => e.player);
  }, [conn?.lastRoster, conn?.replacementOrder]);

  const [players, setPlayers] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!conn) return <Loading />;
  if (!conn.lastRoster) {
    return (
      <Screen>
        <Body>HangoverBot hasn't read your team yet. Open "What we read from ESPN" first, then come back.</Body>
      </Screen>
    );
  }

  const changed = players.map((p) => p.id).join() !== initial.map((p) => p.id).join() || !conn.replacementOrder.length;

  const move = (i: number, by: -1 | 1) => {
    const j = i + by;
    if (j < 0 || j >= players.length) return;
    const next = [...players];
    [next[i], next[j]] = [next[j]!, next[i]!];
    setPlayers(next);
  };

  const save = async (ids: string[]) => {
    setSaving(true);
    setError(null);
    try {
      // Ids not on the bench right now (a starter this week) keep their place after these.
      const rest = conn.replacementOrder.filter((x) => !ids.includes(x));
      await data.updateConnection(conn.id, { replacementOrder: [...ids, ...rest] });
      router.back();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save the order. Try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen
      footer={
        <View>
          <Button title="Save order" large busy={saving} disabled={!changed} onPress={() => save(players.map((p) => p.id))} />
          {conn.replacementOrder.length ? (
            <Button title="Clear it and use ESPN's projections" variant="quiet" disabled={saving} onPress={() => save([])} style={{ marginTop: space.sm }} />
          ) : null}
        </View>
      }
    >
      <Body>When a starter can't play, I start the first player on this list who can fill that slot.</Body>
      <Muted style={{ marginTop: space.sm, marginBottom: space.lg }}>
        {conn.replacementOrder.length ? "This is your saved order." : "No order saved yet, so I use ESPN's projections. This list starts in that order."}
      </Muted>
      {error ? <Banner tone="warn" body={error} /> : null}
      {players.length === 0 ? <Muted>Nobody is on your bench in the last read.</Muted> : null}
      {players.map((p, i) => (
        <View key={p.id} style={s.row}>
          <Text style={s.rank}>{i + 1}</Text>
          <View style={{ flex: 1 }}>
            <Body style={{ fontWeight: "700" }} numberOfLines={1}>
              {p.name}
            </Body>
            <Muted>
              {p.position} · {p.proTeam}
              {p.projection !== undefined ? ` · ${p.projection.toFixed(1)} proj` : ""} · can play {p.eligibleSlots.filter((x) => x !== "BENCH" && x !== "IR").map(slotLabel).join(", ")}
            </Muted>
          </View>
          <Arrow label="Up" glyph="▲" disabled={i === 0} onPress={() => move(i, -1)} />
          <Arrow label="Down" glyph="▼" disabled={i === players.length - 1} onPress={() => move(i, 1)} />
        </View>
      ))}
    </Screen>
  );
}

function Arrow(props: { label: string; glyph: string; disabled: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.label}
      disabled={props.disabled}
      onPress={props.onPress}
      hitSlop={6}
      style={({ pressed }) => [s.arrow, props.disabled && { opacity: 0.25 }, pressed && { backgroundColor: color.purpleSoft }]}
    >
      <Text style={s.glyph}>{props.glyph}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: color.navy,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.line,
    paddingVertical: space.sm,
    paddingLeft: space.md,
    paddingRight: space.sm,
    marginBottom: space.sm,
    gap: space.sm,
  },
  rank: { width: 24, color: color.electric, fontSize: font.h2, fontWeight: "900" },
  arrow: { width: 44, height: 44, borderRadius: radius.sm, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: color.line },
  glyph: { color: color.text, fontSize: font.body },
});
