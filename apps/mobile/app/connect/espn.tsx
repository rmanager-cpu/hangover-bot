// ESPN sign-in inside the app. The user signs in on ESPN's own page in a WebView; once ESPN
// has set its session cookie, the app reads SWID and espn_s2 from the native cookie store
// and hands them to espn-connect, once. They are never shown, logged or saved here, and
// the WebView's cookies are cleared afterwards. HangoverBot never sees the password.

import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, BackHandler, Pressable, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import type { WebViewHttpErrorEvent } from "react-native-webview/lib/WebViewTypes";
import { api, ApiError, messageOf } from "../../src/lib/api";
import { useData } from "../../src/lib/data";
import { forgetEspnSession, readEspnSession, type EspnSession } from "../../src/lib/espnSession";
import { useFlow } from "../../src/lib/flow";
import { color, space } from "../../src/theme";
import { Body, Button, Card, Loading, Muted } from "../../src/ui";

const LOGIN_URL = "https://www.espn.com/login";
// ESPN's own fantasy page has a Log In button, if the login page itself won't load.
const FALLBACK_URL = "https://fantasy.espn.com/football/";
const POLL_MS = 2000;

// Runs inside ESPN's page. If page JavaScript can see both cookies (espn_s2 may be
// HttpOnly, and then only the native store has it), it posts just those two, once, and
// only after two looks have seen the same pair: ESPN sets a SWID for signed-out visitors
// and writes the account's SWID and espn_s2 as separate steps, so a single look can land
// between them and hand over the visitor's SWID.
const FALLBACK_JS = `(function () {
  if (window.__hangoverbot) return;
  function pick(name) {
    var parts = (document.cookie || "").split(";");
    for (var i = 0; i < parts.length; i++) {
      var at = parts[i].indexOf("=");
      if (at > 0 && parts[i].slice(0, at).trim() === name) return parts[i].slice(at + 1).trim();
    }
    return "";
  }
  var last = "";
  function look() {
    var swid = pick("SWID"), espnS2 = pick("espn_s2");
    if (!swid || !espnS2) { last = ""; return; }
    var pair = swid + "|" + espnS2;
    if (pair !== last) { last = pair; return; }
    clearInterval(window.__hangoverbot);
    window.ReactNativeWebView.postMessage(JSON.stringify({ type: "espn-session", swid: swid, espnS2: espnS2 }));
  }
  window.__hangoverbot = setInterval(look, ${POLL_MS});
  look();
})();
true;`;

const samePair = (a: EspnSession | null, b: EspnSession): boolean => a !== null && a.swid === b.swid && a.espnS2 === b.espnS2;

const fromEspn = (url: string): boolean => {
  try {
    const host = new URL(url).hostname;
    return host === "espn.com" || host.endsWith(".espn.com");
  } catch {
    return false;
  }
};

type Phase =
  | { kind: "preparing" }
  | { kind: "signing-in" }
  | { kind: "checking" }
  | { kind: "failed"; message: string; fresh: boolean };

export default function EspnSignIn() {
  const { mode } = useLocalSearchParams<{ mode?: string }>();
  const reauth = mode === "reauth";
  const flow = useFlow();
  const data = useData();
  const web = useRef<WebView>(null);
  const [uri, setUri] = useState(LOGIN_URL);
  const [webKey, setWebKey] = useState(0);
  const [canGoBack, setCanGoBack] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: "preparing" });
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const busy = useRef(false);

  // Start signed out, so an expired session left on the phone is never handed over as new.
  // And leave signed out: a handover that failed for a passing reason keeps ESPN's session
  // in the store while this screen is up, so going back must not leave it on the phone.
  useEffect(() => {
    forgetEspnSession().finally(() => setPhase({ kind: "signing-in" }));
    return () => {
      forgetEspnSession().catch(() => {});
    };
  }, []);

  // Android's back button walks back through ESPN's pages before leaving the screen.
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (!canGoBack) return false;
      web.current?.goBack();
      return true;
    });
    return () => sub.remove();
  }, [canGoBack]);

  const startOver = useCallback(async (message: string) => {
    await forgetEspnSession();
    setUri(LOGIN_URL);
    setWebKey((k) => k + 1);
    setPhase({ kind: "failed", message, fresh: true });
  }, []);

  const handOver = useCallback(
    async (session: EspnSession) => {
      if (busy.current || phaseRef.current.kind !== "signing-in") return;
      busy.current = true;
      setPhase({ kind: "checking" });
      try {
        const result = await api.espnConnect(session.swid, session.espnS2);
        // Handed over: the phone keeps no ESPN session of its own.
        await forgetEspnSession();
        if (reauth) {
          await data.refresh().catch(() => {});
          Alert.alert("Signed in", "ESPN accepted the new sign-in. HangoverBot is watching your league again.");
          if (router.canGoBack()) router.back();
          else router.replace("/settings");
        } else {
          flow.setSignIn(result);
          router.replace("/connect/leagues");
        }
      } catch (e) {
        if (e instanceof ApiError && (e.code === "espn_rejected" || e.code === "bad_request")) {
          await startOver("ESPN didn't accept that sign-in. Please sign in again.");
        } else {
          // ESPN's session is still in the store; trying again picks it up without a new sign-in.
          setPhase({ kind: "failed", message: messageOf(e), fresh: false });
        }
      } finally {
        busy.current = false;
      }
    },
    [reauth, data, flow, startOver],
  );

  // The main path: look in the native cookie store every two seconds until espn_s2 is there,
  // and hand over once two looks in a row have seen the same pair (see FALLBACK_JS for why).
  useEffect(() => {
    if (phase.kind !== "signing-in") return;
    let reading = false;
    let seen: EspnSession | null = null;
    const timer = setInterval(() => {
      if (reading || busy.current) return;
      reading = true;
      readEspnSession()
        .then((s) => {
          if (!s) {
            seen = null;
            return;
          }
          if (samePair(seen, s)) return handOver(s);
          seen = s;
        })
        .catch(() => {
          // The store couldn't be read; the page script below still can.
        })
        .finally(() => {
          reading = false;
        });
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [phase.kind, handOver]);

  const onMessage = (e: WebViewMessageEvent) => {
    if (!fromEspn(e.nativeEvent.url)) return;
    let msg: unknown;
    try {
      msg = JSON.parse(e.nativeEvent.data);
    } catch {
      return;
    }
    const m = msg as { type?: unknown; swid?: unknown; espnS2?: unknown } | null;
    if (m?.type === "espn-session" && typeof m.swid === "string" && typeof m.espnS2 === "string" && m.swid && m.espnS2) {
      handOver({ swid: m.swid, espnS2: m.espnS2 });
    }
  };

  // Only the first page falls back: once ESPN is showing, its own errors are its business.
  const loginFailed = (url: string) => url.startsWith(LOGIN_URL) && uri === LOGIN_URL;
  const onError = (e: { nativeEvent: { url: string } }) => {
    if (loginFailed(e.nativeEvent.url)) setUri(FALLBACK_URL);
  };
  const onHttpError = (e: WebViewHttpErrorEvent) => {
    if (e.nativeEvent.statusCode >= 400 && loginFailed(e.nativeEvent.url)) setUri(FALLBACK_URL);
  };

  if (phase.kind === "preparing") return <Loading />;

  return (
    <SafeAreaView style={s.screen} edges={["bottom", "left", "right"]}>
      <View style={s.intro}>
        <Body>Sign in with your ESPN email and password.</Body>
        <Muted>HangoverBot keeps the sign-in ESPN gives this screen, encrypted on its server. It never sees your password.</Muted>
        {uri === LOGIN_URL ? (
          <Pressable accessibilityRole="button" onPress={() => setUri(FALLBACK_URL)} hitSlop={8}>
            <Muted style={s.link}>Page not loading? Open ESPN Fantasy instead</Muted>
          </Pressable>
        ) : null}
      </View>
      <View style={{ flex: 1 }}>
        <WebView
          key={webKey}
          ref={web}
          source={{ uri }}
          style={s.web}
          onMessage={onMessage}
          injectedJavaScript={FALLBACK_JS}
          onError={onError}
          onHttpError={onHttpError}
          onNavigationStateChange={(nav) => setCanGoBack(nav.canGoBack)}
          javaScriptEnabled
          domStorageEnabled
          thirdPartyCookiesEnabled
          setSupportMultipleWindows={false}
          allowsBackForwardNavigationGestures
          startInLoadingState
          renderLoading={() => <Loading label="Opening ESPN" />}
        />
        {phase.kind === "checking" ? (
          <View style={s.cover}>
            <Loading label="Checking your sign-in with ESPN" />
          </View>
        ) : null}
        {phase.kind === "failed" ? (
          <View style={s.sheet}>
            <Card tone="warn" style={{ marginBottom: 0 }}>
              <Body style={{ marginBottom: space.md }}>{phase.message}</Body>
              <Button
                title={phase.fresh ? "Sign in again" : "Try again"}
                arrow
                onPress={() => {
                  // A reload runs the page script again, for phones where only it can see the session.
                  if (!phase.fresh) web.current?.reload();
                  setPhase({ kind: "signing-in" });
                }}
              />
            </Card>
          </View>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.midnight },
  intro: { paddingHorizontal: space.lg, paddingTop: space.xs, paddingBottom: space.md, gap: space.xs },
  link: { color: color.orange, textDecorationLine: "underline", marginTop: space.xs },
  web: { flex: 1, backgroundColor: color.paper },
  cover: { ...StyleSheet.absoluteFill, backgroundColor: color.midnight },
  sheet: { position: "absolute", left: 0, right: 0, bottom: 0, padding: space.md },
});
