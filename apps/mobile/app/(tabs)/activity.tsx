// Everything HangoverBot did or noticed, newest first, with proposals waiting for an answer
// at the top. Receipts are the server's own words.

import { useFocusEffect } from "expo-router";
import { useCallback } from "react";
import { StyleSheet, View } from "react-native";
import { useData, usePull } from "../../src/lib/data";
import { ACTIVITY_LABEL, isWarning, whenText } from "../../src/lib/format";
import { Proposals } from "../../src/Proposals";
import { color, radius, space } from "../../src/theme";
import { Banner, Body, H2, Label, Muted, Screen } from "../../src/ui";

export default function Activity() {
  const data = useData();
  const { refresh } = data;
  const pull = usePull();

  useFocusEffect(
    useCallback(() => {
      refresh().catch(() => {});
    }, [refresh]),
  );

  const league = (id: string) => (data.connections.length > 1 ? data.connections.find((c) => c.id === id)?.leagueName ?? null : null);

  return (
    <Screen edges={["left", "right"]} {...pull}>
      {data.error ? <Banner tone="warn" body={data.error} /> : null}

      {data.pending.length ? (
        <>
          <Label>Waiting for you</Label>
          <Proposals pending={data.pending} />
        </>
      ) : null}

      <Label style={{ marginTop: data.pending.length ? space.lg : 0 }}>Activity</Label>
      {data.activity.length === 0 ? (
        <Muted>Nothing yet. When I spot a problem or make a move, it shows up here with a receipt.</Muted>
      ) : (
        data.activity.map((a) => {
          const warn = isWarning(a.type);
          return (
            <View key={a.id} style={[s.item, warn && s.itemWarn]}>
              <View style={s.meta}>
                <Label style={[{ marginBottom: 0 }, warn && { color: color.orange }]}>{ACTIVITY_LABEL[a.type] ?? a.type}</Label>
                <Muted>{whenText(a.createdAt)}</Muted>
              </View>
              <H2 style={{ marginTop: space.xs }}>{a.title}</H2>
              {a.body ? <Body style={{ marginTop: space.xs }}>{a.body}</Body> : null}
              {league(a.connectionId) ? <Muted style={{ marginTop: space.xs }}>{league(a.connectionId)}</Muted> : null}
            </View>
          );
        })
      )}
    </Screen>
  );
}

const s = StyleSheet.create({
  item: {
    backgroundColor: color.navy,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.line,
    borderLeftWidth: 4,
    borderLeftColor: color.electric,
    padding: space.lg,
    marginBottom: space.md,
  },
  itemWarn: { borderLeftColor: color.orange },
  meta: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
});
