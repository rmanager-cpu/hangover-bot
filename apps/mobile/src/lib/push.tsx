// Push registration: ask once, get this phone's Expo push token, and store it in `devices`
// so the checker can reach the user. A build without Firebase (no google-services.json)
// or without an EAS project id cannot get a token; the app says so and carries on, since
// everything also lands in Activity.

import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { Platform } from "react-native";
import { color } from "../theme";
import { useSession } from "./session";
import { supabase } from "./supabase";

export type PushState =
  | { status: "unknown" }
  | { status: "working" }
  | { status: "on" }
  | { status: "denied" }
  | { status: "unavailable"; reason: string };

// A notice that arrives while the app is open still shows; the screens refresh themselves.
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

// The same tap can arrive both as the launch response and through the listener.
const opened = new Set<string>();

/** True the first time this tapped alert is seen, so it opens Activity once. */
export function takeResponse(r: Notifications.NotificationResponse | null): boolean {
  if (!r) return false;
  const id = r.notification.request.identifier;
  if (opened.has(id)) return false;
  opened.add(id);
  return true;
}

/** Whether the app was opened by tapping an alert that hasn't been handled yet. */
export function launchedFromAlert(): boolean {
  try {
    return takeResponse(Notifications.getLastNotificationResponse());
  } catch {
    return false;
  }
}

function projectId(): string | undefined {
  const fromConfig = (Constants.expoConfig?.extra as { eas?: { projectId?: unknown } } | undefined)?.eas?.projectId;
  const id = typeof fromConfig === "string" ? fromConfig : Constants.easConfig?.projectId;
  return id || undefined;
}

async function register(userId: string, ask: boolean): Promise<PushState> {
  if (!Device.isDevice) return { status: "unavailable", reason: "Alerts need a real phone, not a simulator." };
  if (Platform.OS === "android") {
    // The checker names this channel on every push (service ANDROID_CHANNEL). Created before
    // there is a token, so it exists on any phone the checker can reach. High, so alerts show
    // on a locked phone.
    await Notifications.setNotificationChannelAsync("default", {
      name: "Lineup alerts",
      importance: Notifications.AndroidImportance.HIGH,
      lightColor: color.purple,
    });
  }
  let { status } = await Notifications.getPermissionsAsync();
  if (status !== "granted" && ask) status = (await Notifications.requestPermissionsAsync()).status;
  if (status !== "granted") return { status: "denied" };

  const id = projectId();
  if (!id) return { status: "unavailable", reason: "This build has no EAS project id, so it can't sign up for alerts. Everything still shows in Activity." };
  let token: string;
  try {
    token = (await Notifications.getExpoPushTokenAsync({ projectId: id })).data;
  } catch {
    return {
      status: "unavailable",
      reason:
        Platform.OS === "android"
          ? "This build was made without Firebase, so Android alerts are off. Everything still shows in Activity."
          : "Apple didn't hand out an alert address this time. Try again later; everything still shows in Activity.",
    };
  }
  const { error } = await supabase
    .from("devices")
    .upsert({ user_id: userId, expo_push_token: token, platform: Platform.OS }, { onConflict: "expo_push_token" });
  if (error) return { status: "unavailable", reason: "Couldn't save this phone for alerts. Try again in a minute." };
  return { status: "on" };
}

interface Push {
  state: PushState;
  /** `ask` shows the system prompt if the user hasn't answered it yet. */
  enable: (ask: boolean) => Promise<void>;
}

const PushContext = createContext<Push | null>(null);

export function PushProvider(props: { children: ReactNode }) {
  const { user } = useSession();
  const [state, setState] = useState<PushState>({ status: "unknown" });
  const busy = useRef(false);

  const enable = useCallback(
    async (ask: boolean) => {
      if (!user || busy.current) return;
      busy.current = true;
      setState({ status: "working" });
      try {
        setState(await register(user.id, ask));
      } catch {
        setState({ status: "unavailable", reason: "Couldn't turn on alerts. Try again in a minute." });
      } finally {
        busy.current = false;
      }
    },
    [user],
  );

  const value = useMemo(() => ({ state, enable }), [state, enable]);
  return <PushContext.Provider value={value}>{props.children}</PushContext.Provider>;
}

export function usePush(): Push {
  const p = useContext(PushContext);
  if (!p) throw new Error("usePush outside PushProvider");
  return p;
}
