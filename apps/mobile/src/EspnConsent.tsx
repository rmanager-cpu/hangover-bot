// Google Play's prominent disclosure for the ESPN session (User Data policy: authentication
// information collected for use in the background). It must be in the app, in the normal
// flow, describe the data and how it is used, sit apart from anything else, and end in an
// affirmative tap: going back is not consent, and nothing dismisses itself. The sign-in
// screen shows it before ESPN's page loads, every time, first setup and sign-in-again alike.
// Keep the wording in step with the privacy policy.

import { StyleSheet, View } from "react-native";
import { CheckDisc } from "./icons";
import { color, space } from "./theme";
import { Body, Button, Card, H2, Header, Muted, Screen } from "./ui";

const POINTS = [
  "You type your password on ESPN's own page. RosterBots never sees it.",
  "Stored encrypted on our server, never shown to anyone, and not kept on this phone.",
  "Sent only to ESPN, to read your team and change your lineup. Never sold, and never shared with anyone else.",
  "Delete it any time in Settings: Forget my ESPN sign-in, or Delete my account.",
];

export function EspnConsent(props: { onAgree: () => void; onDecline: () => void }) {
  return (
    <Screen
      footer={
        <>
          <Button title="Agree and continue" arrow large onPress={props.onAgree} />
          <Button title="Not now" variant="quiet" onPress={props.onDecline} style={{ marginTop: space.sm }} />
        </>
      }
    >
      <Header title="Before you sign in to ESPN" />
      <Card>
        <H2>Your ESPN sign-in</H2>
        <Body style={{ marginTop: space.sm }}>
          RosterBots collects and stores your ESPN sign-in session to read your lineup and make the changes your protection setting allows, including in the background on game days when the app isn't open.
        </Body>
        <Muted style={{ marginTop: space.sm }}>The session is a token ESPN gives this app after you sign in. It is not your password.</Muted>
        {POINTS.map((p, i) => (
          <View key={p} style={[s.point, i < POINTS.length - 1 && s.line]}>
            <CheckDisc size={26} />
            <Body style={{ flex: 1 }}>{p}</Body>
          </View>
        ))}
      </Card>
    </Screen>
  );
}

const s = StyleSheet.create({
  point: { flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.md },
  line: { borderBottomWidth: 1, borderBottomColor: color.inkLine },
});
