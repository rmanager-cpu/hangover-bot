import { Tabs } from "expo-router/js-tabs";
import { GearIcon, HomeIcon, ListIcon } from "../../src/icons";
import { useData } from "../../src/lib/data";
import { color } from "../../src/theme";
import { navHeader } from "../../src/ui";

// Home · Activity · Settings, the handoff's navigation (section 3) and the beta contract.
// The brand sheet's Team tab is the "What we read from ESPN" entry on Home's team card.
export default function TabsLayout() {
  const { pending } = useData();
  // Only proposals that need a tap count; a scheduled move will happen on its own.
  const waiting = pending.filter((p) => !p.autoAt).length;
  return (
    <Tabs
      screenOptions={{
        ...navHeader,
        tabBarStyle: { backgroundColor: color.midnight, borderTopColor: color.line },
        tabBarActiveTintColor: color.orange,
        tabBarInactiveTintColor: color.muted,
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
          tabBarBadgeStyle: { backgroundColor: color.orange, color: color.white },
        }}
      />
      <Tabs.Screen name="settings" options={{ title: "Settings", tabBarIcon: ({ color: c }) => <GearIcon color={c} /> }} />
    </Tabs>
  );
}
