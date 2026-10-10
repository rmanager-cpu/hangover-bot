import { router } from "expo-router";
import { StyleSheet, View } from "react-native";
import { Letter } from "../../src/icons";
import { space } from "../../src/theme";
import { H2, Header, Muted, Option, Pill, Screen } from "../../src/ui";

// ESPN only at launch (CLAUDE.md). The rest are names in the order the brand sheet lists
// them, so people see they're coming; our own one-letter marks, never their logos.
const PROVIDERS: { id: string; name: string; available: boolean }[] = [
  { id: "espn", name: "ESPN", available: true },
  { id: "yahoo", name: "Yahoo", available: false },
  { id: "sleeper", name: "Sleeper", available: false },
  { id: "mfl", name: "MyFantasyLeague", available: false },
];

export default function Provider() {
  return (
    <Screen>
      <Header title="Sync a league" subtitle="Choose where your team lives." center />
      {PROVIDERS.map((p) => (
        <Option key={p.id} tone="light" trailing={p.available ? "chevron" : "none"} disabled={!p.available} onPress={p.available ? () => router.push("/connect/espn") : undefined} accessibilityRole="button">
          <View style={s.row}>
            <Letter letter={p.name.charAt(0)} dim={!p.available} />
            <H2 style={{ flex: 1, fontSize: 20 }}>{p.name}</H2>
            {p.available ? null : <Pill text="Coming soon" />}
          </View>
        </Option>
      ))}
      <Muted style={s.note}>You sign in to ESPN on the next screen, inside the app. RosterBots never sees your password.</Muted>
    </Screen>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: space.md },
  note: { textAlign: "center", marginTop: space.md, paddingHorizontal: space.lg },
});
