import type { ProviderId } from "@rosterbots/connectors";
import { router } from "expo-router";
import { Pressable, StyleSheet, View } from "react-native";
import { color, radius, space } from "../../src/theme";
import { Body, H2, Muted, Pill, Screen } from "../../src/ui";

// Mirrors PROVIDERS in packages/connectors (only types cross into the app). ESPN only at
// launch; the rest are listed so people see they're coming.
const PROVIDERS: { id: ProviderId; name: string; available: boolean }[] = [
  { id: "espn", name: "ESPN Fantasy", available: true },
  { id: "sleeper", name: "Sleeper", available: false },
  { id: "yahoo", name: "Yahoo", available: false },
  { id: "cbs", name: "CBS", available: false },
  { id: "nfl", name: "NFL Fantasy", available: false },
];

export default function Provider() {
  return (
    <Screen>
      <Body style={{ marginBottom: space.lg }}>Where is your league?</Body>
      {PROVIDERS.map((p) => (
        <Pressable
          key={p.id}
          accessibilityRole="button"
          accessibilityState={{ disabled: !p.available }}
          disabled={!p.available}
          onPress={() => router.push("/connect/espn")}
          style={({ pressed }) => [s.option, !p.available && s.off, pressed && { opacity: 0.8 }]}
        >
          <View style={{ flex: 1 }}>
            <H2>{p.name}</H2>
            {p.available ? <Muted>Sign in to ESPN on the next screen.</Muted> : null}
          </View>
          {p.available ? <Body style={s.chevron}>›</Body> : <Pill text="Coming soon" />}
        </Pressable>
      ))}
    </Screen>
  );
}

const s = StyleSheet.create({
  option: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: color.navy,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.line,
    padding: space.lg,
    marginBottom: space.md,
    minHeight: 64,
  },
  off: { opacity: 0.55 },
  chevron: { fontSize: 28, color: color.faint },
});
