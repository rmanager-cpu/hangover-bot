// Small marks drawn from Views, not a font or a third party's artwork: nothing to load,
// nothing to fail, and nothing that is somebody else's trademark.

import type { ReactNode } from "react";
import { StyleSheet, Text, View, type ColorValue } from "react-native";
import { color } from "./theme";

/** A tick: the bottom-left corner of a rotated box. */
export function Tick(props: { color?: ColorValue; size?: number }) {
  const n = props.size ?? 12;
  return (
    <View
      style={{
        width: n * 1.4,
        height: n * 0.8,
        borderLeftWidth: n / 4,
        borderBottomWidth: n / 4,
        borderColor: props.color ?? color.white,
        transform: [{ rotate: "-45deg" }],
        marginTop: -n / 4,
      }}
    />
  );
}

/** An orange disc with a white tick: "this is covered". */
export function CheckDisc(props: { size?: number; tone?: "orange" | "green" }) {
  const n = props.size ?? 24;
  return (
    <View style={{ width: n, height: n, borderRadius: n / 2, backgroundColor: props.tone === "green" ? color.green : color.orange, alignItems: "center", justifyContent: "center" }}>
      <Tick size={n * 0.4} />
    </View>
  );
}

/** A radio: hollow ring, or an orange ring with a white dot when on. */
export function Radio(props: { on: boolean; light?: boolean }) {
  const off = props.light ? color.inkFaint : color.faint;
  return (
    <View style={[i.radio, { borderColor: props.on ? color.orange : off, backgroundColor: props.on ? color.orange : "transparent" }]}>
      {props.on ? <View style={i.radioDot} /> : null}
    </View>
  );
}

/** The rounded square an icon sits in, as on the team and last-action cards. */
export function Tile(props: { tone: "orange" | "grey"; children: ReactNode }) {
  return <View style={[i.tile, props.tone === "orange" ? i.tileOrange : i.tileGrey]}>{props.children}</View>;
}

/** A clock face: a ring and two hands. */
export function Clock(props: { color?: ColorValue }) {
  const c = props.color ?? color.inkMuted;
  return (
    <View style={[i.clock, { borderColor: c }]}>
      <View style={{ position: "absolute", width: 2.5, height: 8, backgroundColor: c, top: 4, left: 10.75 }} />
      <View style={{ position: "absolute", width: 7, height: 2.5, backgroundColor: c, top: 10.75, left: 11 }} />
    </View>
  );
}

/** A one-letter mark in a disc, for a provider row. Our own, not the provider's. */
export function Letter(props: { letter: string; dim?: boolean }) {
  return (
    <View style={[i.letter, props.dim && { backgroundColor: color.inkRaised }]}>
      <Text style={[i.letterText, props.dim && { color: color.inkFaint }]}>{props.letter}</Text>
    </View>
  );
}

/** A right arrow, as a glyph, for the end of a button or link. */
export const ARROW = "→";
/** A chevron for a row that opens something. */
export const CHEVRON = "›";

// Tab bar.

export function HomeIcon(props: { color: ColorValue }) {
  return (
    <View style={i.box}>
      <View style={[i.roof, { borderColor: props.color }]} />
      <View style={[i.house, { borderColor: props.color }]} />
    </View>
  );
}

export function ListIcon(props: { color: ColorValue }) {
  return (
    <View style={[i.box, { justifyContent: "center", gap: 4 }]}>
      {[18, 13, 18].map((w, n) => (
        <View key={n} style={{ width: w, height: 2.5, borderRadius: 2, backgroundColor: props.color }} />
      ))}
    </View>
  );
}

export function GearIcon(props: { color: ColorValue; size?: number }) {
  const n = props.size ?? 24;
  return (
    <View style={{ width: n, height: n, alignItems: "center", justifyContent: "center" }}>
      {[0, 45, 90, 135].map((deg) => (
        <View key={deg} style={{ position: "absolute", width: n * 0.28, height: n, borderRadius: 2, backgroundColor: props.color, transform: [{ rotate: `${deg}deg` }] }} />
      ))}
      <View style={{ width: n * 0.72, height: n * 0.72, borderRadius: n * 0.36, backgroundColor: props.color }} />
      <View style={{ position: "absolute", width: n * 0.3, height: n * 0.3, borderRadius: n * 0.15, backgroundColor: color.midnight }} />
    </View>
  );
}

const i = StyleSheet.create({
  radio: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  radioDot: { width: 9, height: 9, borderRadius: 4.5, backgroundColor: color.white },
  tile: { width: 48, height: 48, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  tileOrange: { backgroundColor: color.orange },
  tileGrey: { backgroundColor: color.inkRaised },
  clock: { width: 24, height: 24, borderRadius: 12, borderWidth: 2.5 },
  letter: { width: 36, height: 36, borderRadius: 18, backgroundColor: color.navy, alignItems: "center", justifyContent: "center" },
  letterText: { color: color.white, fontSize: 16, fontWeight: "900" },
  box: { width: 24, height: 24, alignItems: "center", justifyContent: "flex-end" },
  roof: { position: "absolute", top: 3, width: 13, height: 13, borderTopWidth: 2.5, borderLeftWidth: 2.5, transform: [{ rotate: "45deg" }] },
  house: { width: 14, height: 11, borderWidth: 2.5, borderTopWidth: 0, marginBottom: 2 },
});
