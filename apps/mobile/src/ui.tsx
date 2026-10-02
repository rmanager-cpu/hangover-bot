// The handful of pieces every screen is built from. Dark shell, rounded cards, high-contrast
// type; orange only through the "warn" and "decisive" variants.

import type { ReactNode } from "react";
import {
  ActivityIndicator,
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
import { color, font, radius, space } from "./theme";

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
              tintColor={color.paper}
              colors={[color.purple]}
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
      <ActivityIndicator color={color.paper} size="large" />
      {props.label ? <Muted style={{ marginTop: space.md, textAlign: "center" }}>{props.label}</Muted> : null}
    </Centered>
  );
}

export function Card(props: { children: ReactNode; tone?: "plain" | "calm" | "warn"; style?: StyleProp<ViewStyle> }) {
  const tone = props.tone ?? "plain";
  return <View style={[s.card, tone === "calm" && s.cardCalm, tone === "warn" && s.cardWarn, props.style]}>{props.children}</View>;
}

type TextProps = { children: ReactNode; style?: StyleProp<TextStyle>; numberOfLines?: number };

export const Hero = (p: TextProps) => <Text style={[s.hero, p.style]}>{p.children}</Text>;
export const Title = (p: TextProps) => <Text style={[s.title, p.style]}>{p.children}</Text>;
export const H2 = (p: TextProps) => <Text style={[s.h2, p.style]} numberOfLines={p.numberOfLines}>{p.children}</Text>;
export const Body = (p: TextProps) => <Text style={[s.body, p.style]} numberOfLines={p.numberOfLines}>{p.children}</Text>;
export const Muted = (p: TextProps) => <Text style={[s.muted, p.style]} numberOfLines={p.numberOfLines}>{p.children}</Text>;
/** Small capitals over a section. */
export const Label = (p: TextProps) => <Text style={[s.label, p.style]}>{p.children}</Text>;

export function Button(props: {
  title: string;
  onPress: () => void;
  variant?: "primary" | "decisive" | "secondary" | "quiet";
  large?: boolean;
  busy?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const variant = props.variant ?? "primary";
  const off = props.disabled || props.busy;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!off, busy: !!props.busy }}
      onPress={off ? undefined : props.onPress}
      style={({ pressed }) => [
        s.button,
        props.large && s.buttonLarge,
        variant === "primary" && s.primary,
        variant === "decisive" && s.decisive,
        variant === "secondary" && s.secondary,
        variant === "quiet" && s.quiet,
        off && s.off,
        pressed && !off && s.pressed,
        props.style,
      ]}
    >
      {props.busy ? (
        <ActivityIndicator color={color.paper} />
      ) : (
        <Text style={[s.buttonText, props.large && s.buttonTextLarge, variant === "quiet" && s.quietText]}>{props.title}</Text>
      )}
    </Pressable>
  );
}

/** A tappable line in a list: title, optional detail under it, optional value on the right. */
export function Row(props: { title: string; detail?: string; value?: string; onPress?: () => void; tone?: "warn"; last?: boolean }) {
  return (
    <Pressable
      accessibilityRole={props.onPress ? "button" : undefined}
      onPress={props.onPress}
      style={({ pressed }) => [s.row, !props.last && s.rowLine, pressed && props.onPress ? s.pressed : null]}
    >
      <View style={{ flex: 1 }}>
        <Body style={props.tone === "warn" ? { color: color.orange } : undefined}>{props.title}</Body>
        {props.detail ? <Muted style={{ marginTop: 2 }}>{props.detail}</Muted> : null}
      </View>
      {props.value ? <Muted style={{ marginLeft: space.md }}>{props.value}</Muted> : null}
      {props.onPress ? <Text style={s.chevron}>›</Text> : null}
    </Pressable>
  );
}

/** A message that needs reading. "warn" is orange and is for things that need the user. */
export function Banner(props: { title?: string; body: string; tone?: "warn" | "info"; action?: { title: string; onPress: () => void } }) {
  const warn = props.tone === "warn";
  return (
    <View style={[s.banner, warn ? s.bannerWarn : s.bannerInfo]}>
      {props.title ? <Text style={[s.bannerTitle, warn && { color: color.orange }]}>{props.title}</Text> : null}
      <Body style={{ color: color.text }}>{props.body}</Body>
      {props.action ? (
        <Button
          title={props.action.title}
          onPress={props.action.onPress}
          variant={warn ? "decisive" : "secondary"}
          style={{ marginTop: space.md, alignSelf: "flex-start" }}
        />
      ) : null}
    </View>
  );
}

export function Pill(props: { text: string; tone?: "plain" | "calm" | "warn" }) {
  const tone = props.tone ?? "plain";
  return (
    <View style={[s.pill, tone === "calm" && s.pillCalm, tone === "warn" && s.pillWarn]}>
      <Text style={[s.pillText, tone === "warn" && { color: color.orange }]}>{props.text}</Text>
    </View>
  );
}

export function Field(props: TextInputProps & { label: string }) {
  const { label, style, ...rest } = props;
  return (
    <View style={{ marginBottom: space.lg }}>
      <Label>{label}</Label>
      <TextInput placeholderTextColor={color.faint} selectionColor={color.electric} style={[s.input, style]} {...rest} />
    </View>
  );
}

export const Gap = (p: { size?: number }) => <View style={{ height: p.size ?? space.lg }} />;

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.midnight },
  content: { padding: space.lg, paddingBottom: space.xxl },
  footer: { paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.md, borderTopWidth: 1, borderTopColor: color.line, backgroundColor: color.midnight },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", padding: space.xl, backgroundColor: color.midnight },
  card: { backgroundColor: color.navy, borderRadius: radius.md, padding: space.lg, borderWidth: 1, borderColor: color.line, marginBottom: space.md },
  cardCalm: { backgroundColor: color.purpleSoft, borderColor: "rgba(123, 47, 247, 0.45)" },
  cardWarn: { backgroundColor: color.orangeSoft, borderColor: "rgba(255, 122, 0, 0.55)" },
  hero: { color: color.text, fontSize: font.hero, fontWeight: "900", letterSpacing: 0.5 },
  title: { color: color.text, fontSize: font.title, fontWeight: "800" },
  h2: { color: color.text, fontSize: font.h2, fontWeight: "700" },
  body: { color: color.text, fontSize: font.body, lineHeight: 22 },
  muted: { color: color.muted, fontSize: font.small, lineHeight: 20 },
  label: { color: color.faint, fontSize: font.tiny, fontWeight: "700", letterSpacing: 1.2, textTransform: "uppercase", marginBottom: space.sm },
  button: { minHeight: 48, borderRadius: radius.md, paddingHorizontal: space.xl, alignItems: "center", justifyContent: "center" },
  buttonLarge: { minHeight: 60, borderRadius: radius.lg },
  primary: { backgroundColor: color.purple },
  decisive: { backgroundColor: color.orange },
  secondary: { backgroundColor: "transparent", borderWidth: 1.5, borderColor: "rgba(246, 247, 251, 0.35)" },
  quiet: { backgroundColor: "transparent", minHeight: 40, paddingHorizontal: space.sm },
  off: { opacity: 0.45 },
  pressed: { opacity: 0.8 },
  buttonText: { color: color.paper, fontSize: font.body, fontWeight: "800" },
  buttonTextLarge: { fontSize: font.h2 },
  quietText: { color: color.muted, fontWeight: "600" },
  row: { flexDirection: "row", alignItems: "center", paddingVertical: space.md },
  rowLine: { borderBottomWidth: 1, borderBottomColor: color.line },
  chevron: { color: color.faint, fontSize: 24, marginLeft: space.sm },
  banner: { borderRadius: radius.md, padding: space.lg, marginBottom: space.md, borderWidth: 1 },
  bannerWarn: { backgroundColor: color.orangeSoft, borderColor: "rgba(255, 122, 0, 0.55)" },
  bannerInfo: { backgroundColor: color.navy, borderColor: color.line },
  bannerTitle: { color: color.text, fontSize: font.body, fontWeight: "800", marginBottom: space.xs },
  pill: { alignSelf: "flex-start", borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 3, backgroundColor: color.raised },
  pillCalm: { backgroundColor: color.purpleSoft },
  pillWarn: { backgroundColor: color.orangeSoft },
  pillText: { color: color.text, fontSize: font.tiny, fontWeight: "800", letterSpacing: 0.5 },
  input: {
    color: color.text,
    fontSize: font.h2,
    backgroundColor: color.navy,
    borderWidth: 1,
    borderColor: "rgba(246, 247, 251, 0.25)",
    borderRadius: radius.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
});
