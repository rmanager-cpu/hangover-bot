// The front door: the lockup (it carries the robot), the line, and one orange button. The three promises sit behind "How it works" so the screen stays short.

import { router } from "expo-router";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { CheckDisc } from "../src/icons";
import { color, font, space } from "../src/theme";
import { Body, Button, Card, Divider, Label, Lockup, Muted, Screen, Title } from "../src/ui";

const POINTS = [
  "Watches your starters all game day, every few minutes near kickoff.",
  "When a starter is ruled out or on bye, puts in your best bench player, or asks you first.",
  "Tells you every time, with a receipt.",
];

// Names only: the other hosts' marks are theirs (docs/brand/README.md). ESPN is the beta.
const SUPPORTS = ["ESPN", "Yahoo", "Sleeper", "MyFantasyLeague"];

export default function Welcome() {
  const [how, setHow] = useState(false);
  return (
    <Screen edges={["top", "bottom", "left", "right"]}>
      <Lockup style={s.lockup} />
      <Title style={s.headline}>Fantasy insurance for real life.</Title>
      <Body style={[s.tagline, { marginBottom: space.xl }]}>We watch your lineup and let you know when players are ruled out, so you can make moves before it's too late.</Body>

      <Card>
        <Button title="Sync a League" arrow large onPress={() => router.push("/connect/provider")} />
        <View style={s.supports}>
          <Divider style={{ flex: 1 }} />
          <Label style={s.supportsLabel}>Supports</Label>
          <Divider style={{ flex: 1 }} />
        </View>
        <View style={s.names}>
          {SUPPORTS.map((n, i) => (
            <View key={n} style={s.nameCell}>
              {i > 0 ? <View style={s.bar} /> : null}
              <Text style={s.name}>{n}</Text>
            </View>
          ))}
        </View>
        <Muted style={s.note}>ESPN in this beta; the rest are coming soon. You sign in to ESPN inside the app, nothing to copy, no computer needed.</Muted>
      </Card>

      <Button title="How it works" variant="quiet" arrow={!how} onPress={() => setHow(!how)} style={{ alignSelf: "center" }} />
      {how ? (
        <Card tone="dark">
          {POINTS.map((p, i) => (
            <View key={p} style={[s.point, i === POINTS.length - 1 && { marginBottom: 0 }]}>
              <CheckDisc size={22} />
              <Body style={{ flex: 1 }}>{p}</Body>
            </View>
          ))}
        </Card>
      ) : null}
      <Button title="Used RosterBots before? Sign in with Google" variant="quiet" onPress={() => router.push("/claim")} style={{ alignSelf: "center", marginTop: space.sm }} />
    </Screen>
  );
}

const s = StyleSheet.create({
  lockup: { marginTop: space.lg, marginBottom: space.xl },
  headline: { textAlign: "center", fontSize: 30 },
  tagline: { textAlign: "center", color: color.muted, fontSize: 17, lineHeight: 24, marginTop: space.sm, paddingHorizontal: space.sm },
  supports: { flexDirection: "row", alignItems: "center", marginTop: space.xl },
  supportsLabel: { marginBottom: 0, marginHorizontal: space.md },
  names: { flexDirection: "row", justifyContent: "center", flexWrap: "wrap", marginTop: space.md },
  nameCell: { flexDirection: "row", alignItems: "center" },
  bar: { width: 1, height: 14, backgroundColor: color.inkLine, marginHorizontal: space.md },
  name: { color: color.ink, fontSize: font.small, fontWeight: "700" },
  note: { textAlign: "center", marginTop: space.lg },
  point: { flexDirection: "row", alignItems: "flex-start", gap: space.md, marginBottom: space.md },
});
