import { router } from "expo-router";
import { Image, StyleSheet, View } from "react-native";
import { color, space } from "../src/theme";
import { Body, Button, Hero, Muted, Screen } from "../src/ui";

const POINTS = [
  "Watches your starters all game day, every few minutes near kickoff.",
  "When a starter is ruled out or on bye, puts in your best bench player, or asks you first.",
  "Tells you every time, with a receipt.",
];

export default function Welcome() {
  return (
    <Screen edges={["top", "bottom", "left", "right"]} footer={<Button title="Sync a League" large onPress={() => router.push("/connect/provider")} />}>
      <View style={s.top}>
        <Image source={require("../assets/splash-icon.png")} style={s.mark} accessibilityIgnoresInvertColors />
        <Hero>HangoverBot</Hero>
        <Body style={s.tagline}>Fantasy help for real life.</Body>
      </View>
      {POINTS.map((p) => (
        <View key={p} style={s.point}>
          <View style={s.dot} />
          <Body style={{ flex: 1 }}>{p}</Body>
        </View>
      ))}
      <Muted style={{ marginTop: space.xl }}>Works with ESPN fantasy football. You sign in to ESPN inside the app; nothing to copy, no computer needed.</Muted>
    </Screen>
  );
}

const s = StyleSheet.create({
  top: { alignItems: "flex-start", paddingTop: space.xxl, paddingBottom: space.xl },
  mark: { width: 96, height: 96, marginBottom: space.xl, marginLeft: -8 },
  tagline: { fontSize: 20, color: color.muted, marginTop: space.sm },
  point: { flexDirection: "row", alignItems: "flex-start", marginBottom: space.lg },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: color.electric, marginTop: 8, marginRight: space.md },
});
