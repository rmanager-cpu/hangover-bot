import * as Notifications from "expo-notifications";
import { DarkTheme, router, Stack, ThemeProvider } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { DataProvider, useData } from "../src/lib/data";
import { FlowProvider } from "../src/lib/flow";
import { PushProvider, takeResponse } from "../src/lib/push";
import { SessionProvider, useSession } from "../src/lib/session";
import { configured } from "../src/lib/supabase";
import { color } from "../src/theme";
import { Body, Button, Centered, Gap, Loading, Lockup, Muted, navHeader } from "../src/ui";

SplashScreen.preventAutoHideAsync().catch(() => {});

const theme = {
  ...DarkTheme,
  colors: { ...DarkTheme.colors, background: color.midnight, card: color.midnight, text: color.text, border: color.line, primary: color.orange, notification: color.orange },
};

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <ThemeProvider value={theme}>
        <StatusBar style="light" />
        {configured ? (
          <SessionProvider>
            <DataProvider>
              <PushProvider>
                <FlowProvider>
                  <Gate />
                </FlowProvider>
              </PushProvider>
            </DataProvider>
          </SessionProvider>
        ) : (
          <NotConfigured />
        )}
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

function Gate() {
  const { state, retry } = useSession();
  const ready = state.status === "ready";
  useEffect(() => {
    if (state.status !== "loading") SplashScreen.hideAsync().catch(() => {});
  }, [state.status]);

  if (state.status === "loading") return <Loading />;
  if (state.status === "error") {
    return (
      <Centered>
        <Lockup />
        <Gap />
        <Body style={{ textAlign: "center" }}>{state.message}</Body>
        <Gap />
        <Button title="Try again" arrow onPress={retry} />
      </Centered>
    );
  }
  // Every inner screen wears the wordmark where a title would go, as the mockups do, with
  // just a chevron to go back; the screen's own headline sits in its content. The titles
  // stay for screen readers and the back-button label.
  return (
    <>
      {ready ? <NotificationRouting /> : null}
      <Stack
        screenOptions={{
          ...navHeader,
          headerBackButtonDisplayMode: "minimal",
          contentStyle: { backgroundColor: color.midnight },
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="welcome" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="connect/provider" options={{ title: "Sync a League" }} />
        <Stack.Screen name="connect/espn" options={{ title: "Sign in to ESPN" }} />
        <Stack.Screen name="connect/leagues" options={{ title: "Your league" }} />
        <Stack.Screen name="read/[id]" options={{ title: "What we read from ESPN" }} />
        <Stack.Screen name="protection" options={{ title: "Protection" }} />
        <Stack.Screen name="claim" options={{ title: "Claim your account" }} />
        <Stack.Screen name="signin" options={{ title: "Sign in" }} />
        <Stack.Screen name="order" options={{ title: "Replacement order" }} />
        <Stack.Screen name="droppable" options={{ title: "Droppable players" }} />
        <Stack.Screen name="advice" options={{ title: "Roster Advice" }} />
      </Stack>
    </>
  );
}

// A tapped alert opens Activity, where proposals have their Approve button. The alert that
// launched the app is handled by the index route instead, once it knows where to go.
// Anything that arrives while the app is open refreshes what's on screen.
function NotificationRouting() {
  const { refresh } = useData();
  useEffect(() => {
    const tapped = Notifications.addNotificationResponseReceivedListener((r) => {
      if (!takeResponse(r)) return;
      refresh().catch(() => {});
      router.push("/activity");
    });
    const received = Notifications.addNotificationReceivedListener(() => {
      refresh().catch(() => {});
    });
    return () => {
      tapped.remove();
      received.remove();
    };
  }, [refresh]);
  return null;
}

function NotConfigured() {
  useEffect(() => {
    SplashScreen.hideAsync().catch(() => {});
  }, []);
  return (
    <Centered>
      <Lockup />
      <Gap />
      <Body style={{ textAlign: "center" }}>This build isn't connected to a RosterBots server yet.</Body>
      <Gap size={8} />
      <Muted style={{ textAlign: "center" }}>
        Put the Supabase URL and anon key into eas.json (EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY) and build again.
      </Muted>
    </Centered>
  );
}
