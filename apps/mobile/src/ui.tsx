// The pieces every screen is built from, in the owner's brand (docs/brand/README.md):
// Midnight behind, white cards with big radii on it, orange pill buttons with a trailing
// arrow, an orange outline on the selected option, pill status chips. Text takes its
// palette from the surface it sits on, so a Body inside a white Card is navy and the same
// Body straight on the screen is white.

import { createContext, useContext, type ReactNode } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { SafeAreaView, type Edge } from "react-native-safe-area-context";
import { LOCKUP, WORDMARK } from "./brand";
import { ARROW, CHEVRON, Radio } from "./icons";
import { color, font, radius, space } from "./theme";

type Surface = "dark" | "light";
const SurfaceContext = createContext<Surface>("dark");
export const useSurface = (): Surface => useContext(SurfaceContext);

const CARD_PAD = 20;

export function Screen(props: {
  children: ReactNode;
  /** Screens without a navigation header need the top inset too. */
  edges?: Edge[];
  refreshing?: boolean;
  onRefresh?: () => void;
  footer?: ReactNode;
}) {
  return (
    <SafeAreaView style={s.screen} edges={props.edges ?? ["bottom", "left", "right"]}>
      <ScrollView
        contentContainerStyle={s.content}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          props.onRefresh ? (
            <RefreshControl
              refreshing={props.refreshing ?? false}
              onRefresh={props.onRefresh}
              tintColor={color.white}
              colors={[color.orange]}
              progressBackgroundColor={color.navy}
            />
          ) : undefined
        }
      >
        {props.children}
      </ScrollView>
      {props.footer ? <View style={s.footer}>{props.footer}</View> : null}
    </SafeAreaView>
  );
}

export function Centered(props: { children: ReactNode }) {
  return <View style={s.centered}>{props.children}</View>;
}

export function Loading(props: { label?: string }) {
  return (
    <Centered>
      <ActivityIndicator color={color.orange} size="large" />
      {props.label ? <Muted style={{ marginTop: space.md, textAlign: "center" }}>{props.label}</Muted> : null}
    </Centered>
  );
}

// Marks.

/** The official lockup, HangoverBot: Roster Protection, as wide as its box. */
export function Lockup(props: { style?: StyleProp<ViewStyle> }) {
  return <Image source={LOCKUP.source} style={[{ width: "100%", aspectRatio: LOCKUP.aspect }, props.style]} resizeMode="contain" accessibilityLabel="HangoverBot: Roster Protection" accessibilityIgnoresInvertColors />;
}

/** The wordmark with "by TurboLabs", small, for inner screens and the navigation header. */
export function Wordmark(props: { width?: number; style?: StyleProp<ViewStyle> }) {
  const w = props.width ?? 150;
  return <Image source={WORDMARK.source} style={[{ width: w, height: w / WORDMARK.aspect }, props.style]} resizeMode="contain" accessibilityLabel="HangoverBot by TurboLabs" accessibilityIgnoresInvertColors />;
}

/** Navigation header: Midnight, no shadow, the wordmark where a title would go. */
export const navHeader = {
  headerStyle: { backgroundColor: color.midnight },
  headerTintColor: color.muted,
  headerShadowVisible: false,
  headerTitleAlign: "center" as const,
  headerTitle: () => <Wordmark width={150} />,
};

/** The headline block at the top of a screen: big bold title, lavender line under it. */
export function Header(props: { title: string; subtitle?: string; center?: boolean; lockup?: boolean; style?: StyleProp<ViewStyle> }) {
  const align = props.center ? "center" : "left";
  return (
    <View style={[{ marginBottom: space.xl }, props.style]}>
      {props.lockup ? <Lockup style={{ marginBottom: space.lg }} /> : null}
      <Title style={{ textAlign: align }}>{props.title}</Title>
      {props.subtitle ? <Body style={{ textAlign: align, marginTop: space.sm, color: color.muted, fontSize: 17 }}>{props.subtitle}</Body> : null}
    </View>
  );
}

// Surfaces.

/** A card. White by default; "dark" for option lists and the odd note; "warn" is white with an orange edge. */
export function Card(props: { children: ReactNode; tone?: "light" | "dark" | "warn"; style?: StyleProp<ViewStyle> }) {
  const tone = props.tone ?? "light";
  return (
    <SurfaceContext.Provider value={tone === "dark" ? "dark" : "light"}>
      <View style={[s.card, tone === "dark" && s.cardDark, tone === "warn" && s.cardWarn, props.style]}>{props.children}</View>
    </SurfaceContext.Provider>
  );
}

/**
 * One choice in a list. Orange outline when selected. Dark by default, as the protection
 * levels; light for the provider and league lists.
 */
export function Option(props: {
  children: ReactNode;
  selected?: boolean;
  onPress?: () => void;
  disabled?: boolean;
  tone?: "dark" | "light";
  trailing?: "radio" | "chevron" | "none";
  accessibilityRole?: "radio" | "button";
  style?: StyleProp<ViewStyle>;
}) {
  const tone = props.tone ?? "dark";
  const light = tone === "light";
  const trailing = props.trailing ?? "radio";
  const on = !!props.selected;
  return (
    <SurfaceContext.Provider value={light ? "light" : "dark"}>
      <Pressable
        accessibilityRole={props.accessibilityRole ?? (trailing === "radio" ? "radio" : "button")}
        accessibilityState={{ checked: trailing === "radio" ? on : undefined, selected: on, disabled: !!props.disabled }}
        disabled={props.disabled || !props.onPress}
        onPress={props.onPress}
        style={({ pressed }) => [
          s.option,
          light ? s.optionLight : s.optionDark,
          on && (light ? s.optionOnLight : s.optionOnDark),
          props.disabled && s.off,
          pressed && !props.disabled && s.pressed,
          props.style,
        ]}
      >
        <View style={{ flex: 1 }}>{props.children}</View>
        {trailing === "radio" ? <Radio on={on} light={light} /> : trailing === "chevron" ? <Text style={[s.chevron, light && { color: color.inkMuted }]}>{CHEVRON}</Text> : null}
      </Pressable>
    </SurfaceContext.Provider>
  );
}

/** A small selectable pill, for a choice inside a card. */
export function Chip(props: { text: string; selected: boolean; onPress?: () => void; disabled?: boolean; note?: string }) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: props.selected, disabled: !!props.disabled }}
      disabled={props.disabled || !props.onPress}
      onPress={props.onPress}
      style={[s.chip, props.selected && s.chipOn, props.disabled && s.off]}
    >
      <Text style={[s.chipText, props.selected && { color: color.ink }]}>{props.text}</Text>
      {props.note ? <Text style={s.chipNote}>{props.note}</Text> : <Radio on={props.selected} light />}
    </Pressable>
  );
}

// Type.

type TextProps = { children: ReactNode; style?: StyleProp<TextStyle>; numberOfLines?: number };

function pick(surface: Surface, dark: string, light: string): string {
  return surface === "light" ? light : dark;
}

export function Hero(p: TextProps) {
  const sf = useSurface();
  return <Text style={[s.hero, { color: pick(sf, color.text, color.ink) }, p.style]} numberOfLines={p.numberOfLines}>{p.children}</Text>;
}
export function Title(p: TextProps) {
  const sf = useSurface();
  return <Text style={[s.title, { color: pick(sf, color.text, color.ink) }, p.style]} numberOfLines={p.numberOfLines}>{p.children}</Text>;
}
export function H2(p: TextProps) {
  const sf = useSurface();
  return <Text style={[s.h2, { color: pick(sf, color.text, color.ink) }, p.style]} numberOfLines={p.numberOfLines}>{p.children}</Text>;
}
export function Body(p: TextProps) {
  const sf = useSurface();
  return <Text style={[s.body, { color: pick(sf, color.text, color.ink) }, p.style]} numberOfLines={p.numberOfLines}>{p.children}</Text>;
}
export function Muted(p: TextProps) {
  const sf = useSurface();
  return <Text style={[s.muted, { color: pick(sf, color.muted, color.inkMuted) }, p.style]} numberOfLines={p.numberOfLines}>{p.children}</Text>;
}
/** Small capitals over a section. */
export function Label(p: TextProps) {
  const sf = useSurface();
  return <Text style={[s.label, { color: pick(sf, color.faint, color.inkFaint) }, p.style]} numberOfLines={p.numberOfLines}>{p.children}</Text>;
}

// Controls.

export function Button(props: {
  title: string;
  onPress: () => void;
  /** primary is the orange pill; secondary is the quiet grey one beside it; quiet is a text link. */
  variant?: "primary" | "secondary" | "quiet";
  /** A trailing arrow, for the button that moves the user on. */
  arrow?: boolean;
  large?: boolean;
  busy?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const sf = useSurface();
  const variant = props.variant ?? "primary";
  const off = props.disabled || props.busy;
  const light = sf === "light";
  const labelColor = variant === "primary" ? color.white : variant === "secondary" ? (light ? color.ink : color.white) : light ? color.inkMuted : color.muted;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!off, busy: !!props.busy }}
      onPress={off ? undefined : props.onPress}
      style={({ pressed }) => [
        s.button,
        props.large && s.buttonLarge,
        variant === "primary" && s.primary,
        variant === "secondary" && (light ? s.secondaryLight : s.secondaryDark),
        variant === "quiet" && s.quiet,
        off && s.off,
        pressed && !off && s.pressed,
        props.style,
      ]}
    >
      {props.busy ? (
        <ActivityIndicator color={labelColor} />
      ) : (
        <Text style={[s.buttonText, props.large && s.buttonTextLarge, variant === "quiet" && s.quietText, { color: labelColor }]} numberOfLines={1} adjustsFontSizeToFit>
          {props.title}
          {props.arrow ? `  ${ARROW}` : ""}
        </Text>
      )}
    </Pressable>
  );
}

/** A tappable line in a list: title, optional detail under it, optional value on the right. */
export function Row(props: { title: string; detail?: string; value?: string; onPress?: () => void; tone?: "warn"; last?: boolean; left?: ReactNode }) {
  const sf = useSurface();
  return (
    <Pressable
      accessibilityRole={props.onPress ? "button" : undefined}
      onPress={props.onPress}
      disabled={!props.onPress}
      style={({ pressed }) => [s.row, !props.last && (sf === "light" ? s.rowLineLight : s.rowLineDark), pressed && props.onPress ? s.pressed : null]}
    >
      {props.left ? <View style={{ marginRight: space.md }}>{props.left}</View> : null}
      <View style={{ flex: 1 }}>
        <Body style={[{ fontWeight: "600" }, props.tone === "warn" ? { color: color.orange } : undefined]}>{props.title}</Body>
        {props.detail ? <Muted style={{ marginTop: 2 }}>{props.detail}</Muted> : null}
      </View>
      {props.value ? <Muted style={{ marginLeft: space.md }}>{props.value}</Muted> : null}
      {props.onPress ? <Text style={[s.chevron, sf === "light" && { color: color.inkFaint }]}>{CHEVRON}</Text> : null}
    </Pressable>
  );
}

/** A message that needs reading. "warn" is white with an orange edge and is for things that need the user. */
export function Banner(props: { title?: string; body: string; tone?: "warn" | "info"; action?: { title: string; onPress: () => void } }) {
  const warn = props.tone === "warn";
  return (
    <SurfaceContext.Provider value={warn ? "light" : "dark"}>
      <View style={[s.banner, warn ? s.bannerWarn : s.bannerInfo]}>
        {props.title ? <Text style={[s.bannerTitle, { color: warn ? color.orange : color.text }]}>{props.title}</Text> : null}
        <Body>{props.body}</Body>
        {props.action ? <Button title={props.action.title} onPress={props.action.onPress} variant={warn ? "primary" : "secondary"} arrow={warn} style={{ marginTop: space.md, alignSelf: "flex-start" }} /> : null}
      </View>
    </SurfaceContext.Provider>
  );
}

/** A status chip: green Healthy, amber Questionable, red Out, purple for our own notes. */
export function Pill(props: { text: string; tone?: "plain" | "healthy" | "warn" | "out" | "calm" | "orange" }) {
  const sf = useSurface();
  const tone = props.tone ?? "plain";
  const look =
    tone === "healthy"
      ? { bg: color.greenSoft, fg: color.greenInk }
      : tone === "warn"
        ? { bg: color.amberSoft, fg: color.amberInk }
        : tone === "out"
          ? { bg: color.redSoft, fg: color.redInk }
          : tone === "calm"
            ? { bg: color.purpleSoft, fg: color.purple }
            : tone === "orange"
              ? { bg: color.orangeSoft, fg: color.orangeInk }
              : sf === "light"
                ? { bg: color.inkRaised, fg: color.inkMuted }
                : { bg: color.raised, fg: color.muted };
  return (
    <View style={[s.pill, { backgroundColor: look.bg }]}>
      <Text style={[s.pillText, { color: look.fg }]}>{props.text}</Text>
    </View>
  );
}

/** A coloured dot before a headline. */
export function Dot(props: { tone: "green" | "orange" | "red" | "muted" }) {
  const bg = props.tone === "green" ? color.green : props.tone === "orange" ? color.orange : props.tone === "red" ? color.red : color.faint;
  return <View style={[s.dot, { backgroundColor: bg }]} />;
}

export function Field(props: TextInputProps & { label: string }) {
  const { label, style, ...rest } = props;
  return (
    <View style={{ marginBottom: space.lg }}>
      <Label>{label}</Label>
      <TextInput placeholderTextColor={color.faint} selectionColor={color.orange} style={[s.input, style]} {...rest} />
    </View>
  );
}

export function Divider(props: { style?: StyleProp<ViewStyle> }) {
  const sf = useSurface();
  return <View style={[{ height: 1, backgroundColor: sf === "light" ? color.inkLine : color.line }, props.style]} />;
}

export const Gap = (p: { size?: number }) => <View style={{ height: p.size ?? space.lg }} />;

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.midnight },
  content: { padding: space.lg, paddingBottom: space.xxl },
  footer: { paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.md, backgroundColor: color.midnight },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", padding: space.xl, backgroundColor: color.midnight },

  card: { backgroundColor: color.white, borderRadius: radius.lg, padding: CARD_PAD, marginBottom: space.md },
  cardDark: { backgroundColor: color.navy, borderWidth: 1, borderColor: color.line },
  cardWarn: { borderWidth: 2, borderColor: color.orange },

  option: { flexDirection: "row", alignItems: "center", borderRadius: radius.lg, borderWidth: 2, padding: CARD_PAD, marginBottom: space.md, minHeight: 72 },
  optionDark: { backgroundColor: color.navy, borderColor: color.line },
  optionLight: { backgroundColor: color.white, borderColor: color.white },
  optionOnDark: { borderColor: color.orange, backgroundColor: color.orangeGlow },
  optionOnLight: { borderColor: color.orange },

  chip: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.sm, borderRadius: radius.md, borderWidth: 2, borderColor: color.inkLine, paddingVertical: space.md, paddingHorizontal: space.md, backgroundColor: color.white },
  chipOn: { borderColor: color.orange, backgroundColor: color.orangeSoft },
  chipText: { color: color.inkMuted, fontSize: font.small, fontWeight: "700", flexShrink: 1 },
  chipNote: { color: color.inkFaint, fontSize: font.tiny, fontWeight: "700" },

  hero: { fontSize: font.hero, fontWeight: "800", letterSpacing: -0.5, lineHeight: 42 },
  title: { fontSize: font.title, fontWeight: "800", letterSpacing: -0.4, lineHeight: 34 },
  h2: { fontSize: font.h2, fontWeight: "700" },
  body: { fontSize: font.body, lineHeight: 22 },
  muted: { fontSize: font.small, lineHeight: 20 },
  label: { fontSize: font.tiny, fontWeight: "700", letterSpacing: 1.2, textTransform: "uppercase", marginBottom: space.sm },

  button: { minHeight: 52, borderRadius: radius.pill, paddingHorizontal: space.xl, alignItems: "center", justifyContent: "center" },
  buttonLarge: { minHeight: 58 },
  primary: { backgroundColor: color.orange },
  secondaryLight: { backgroundColor: color.inkRaised },
  secondaryDark: { backgroundColor: color.glass, borderWidth: 1, borderColor: "rgba(246, 247, 251, 0.2)" },
  quiet: { backgroundColor: "transparent", minHeight: 40, paddingHorizontal: space.sm },
  off: { opacity: 0.45 },
  pressed: { opacity: 0.8 },
  buttonText: { fontSize: font.body, fontWeight: "800" },
  buttonTextLarge: { fontSize: 17 },
  quietText: { fontWeight: "600" },

  row: { flexDirection: "row", alignItems: "center", paddingVertical: space.md },
  rowLineLight: { borderBottomWidth: 1, borderBottomColor: color.inkLine },
  rowLineDark: { borderBottomWidth: 1, borderBottomColor: color.line },
  chevron: { color: color.faint, fontSize: 26, lineHeight: 28, marginLeft: space.sm, fontWeight: "600" },

  banner: { borderRadius: radius.lg, padding: CARD_PAD, marginBottom: space.md },
  bannerWarn: { backgroundColor: color.white, borderLeftWidth: 5, borderLeftColor: color.orange },
  bannerInfo: { backgroundColor: color.navy, borderWidth: 1, borderColor: color.line, borderLeftWidth: 5, borderLeftColor: color.electric },
  bannerTitle: { fontSize: font.body, fontWeight: "800", marginBottom: space.xs },

  pill: { alignSelf: "flex-start", borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 5 },
  pillText: { fontSize: 13, fontWeight: "700" },
  dot: { width: 14, height: 14, borderRadius: 7 },

  input: {
    color: color.text,
    fontSize: font.h2,
    backgroundColor: color.navy,
    borderWidth: 1.5,
    borderColor: "rgba(246, 247, 251, 0.2)",
    borderRadius: radius.md,
    paddingHorizontal: space.lg,
    paddingVertical: 14,
  },
});
