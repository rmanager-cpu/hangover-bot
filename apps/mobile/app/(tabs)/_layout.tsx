import { Tabs } from "expo-router/js-tabs";
import { StyleSheet, View, type ColorValue } from "react-native";
import { useData } from "../../src/lib/data";
import { color } from "../../src/theme";

// Home · Activity · Settings, as the handoff's navigation (section 3).
export default function TabsLayout() {
  const { pending } = useData();
  // Only proposals that need a tap count; a scheduled move will happen on its own.
  const waiting = pending.filter((p) => !p.autoAt).length;
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: color.midnight },
        headerTintColor: color.paper,
        headerTitleStyle: { fontWeight: "800" },
        headerShadowVisible: false,
        tabBarStyle: { backgroundColor: color.navy, borderTopColor: color.line },
        tabBarActiveTintColor: color.paper,
        tabBarInactiveTintColor: color.faint,
        tabBarLabelStyle: { fontSize: 12, fontWeight: "700" },
        sceneStyle: { backgroundColor: color.midnight },
      }}
    >
      <Tabs.Screen name="home" options={{ title: "Home", headerShown: false, tabBarIcon: ({ color: c }) => <HomeIcon color={c} /> }} />
      <Tabs.Screen
        name="activity"
        options={{
          title: "Activity",
          tabBarIcon: ({ color: c }) => <ListIcon color={c} />,
          tabBarBadge: waiting || undefined,
          tabBarBadgeStyle: { backgroundColor: color.orange, color: color.paper },
        }}
      />
      <Tabs.Screen name="settings" options={{ title: "Settings", tabBarIcon: ({ color: c }) => <DialIcon color={c} /> }} />
    </Tabs>
  );
}

// Drawn, not a font: nothing to load, nothing to fail.
function HomeIcon(props: { color: ColorValue }) {
  return (
    <View style={i.box}>
      <View style={[i.roof, { borderColor: props.color }]} />
      <View style={[i.house, { borderColor: props.color }]} />
    </View>
  );
}

function ListIcon(props: { color: ColorValue }) {
  return (
    <View style={[i.box, { justifyContent: "center", gap: 4 }]}>
      {[18, 13, 18].map((w, n) => (
        <View key={n} style={{ width: w, height: 2.5, borderRadius: 2, backgroundColor: props.color }} />
      ))}
    </View>
  );
}

function DialIcon(props: { color: ColorValue }) {
  return (
    <View style={[i.box, { justifyContent: "center" }]}>
      <View style={[i.ring, { borderColor: props.color }]}>
        <View style={[i.dot, { backgroundColor: props.color }]} />
      </View>
    </View>
  );
}

const i = StyleSheet.create({
  box: { width: 24, height: 24, alignItems: "center", justifyContent: "flex-end" },
  roof: { position: "absolute", top: 3, width: 13, height: 13, borderTopWidth: 2.5, borderLeftWidth: 2.5, transform: [{ rotate: "45deg" }] },
  house: { width: 14, height: 11, borderWidth: 2.5, borderTopWidth: 0, marginBottom: 2 },
  ring: { width: 19, height: 19, borderRadius: 10, borderWidth: 2.5, alignItems: "center", justifyContent: "center" },
  dot: { width: 6, height: 6, borderRadius: 3 },
});
