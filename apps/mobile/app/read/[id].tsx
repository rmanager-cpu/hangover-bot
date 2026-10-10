// "What we read from ESPN": the team exactly as RosterBots read it, laid out like the ESPN
// app's My Team so the two can be compared line by line, plus the Test swap that proves
// RosterBots can change the lineup and read the change back.

import type { ReadSummary } from "@rosterbots/service";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { api, ApiError, messageOf } from "../../src/lib/api";
import { useData } from "../../src/lib/data";
import { useFlow } from "../../src/lib/flow";
import { kickoffText, slotLabel, statusTag, whenText } from "../../src/lib/format";
import { color, font, space } from "../../src/theme";
import { Banner, Body, Button, Card, Gap, H2, Header, Label, Loading, Muted, Pill, Screen } from "../../src/ui";

type ReadPlayer = ReadSummary["players"][number];

type Swap =
  | { step: "off" }
  | { step: "picking"; picked: string[] }
  | { step: "confirm"; a: string; b: string }
  | { step: "working"; a: string; b: string; back: boolean }
  | { step: "done"; a: string; b: string; back: boolean; message: string; at: string }
  | { step: "failed"; a: string; b: string; back: boolean; message: string };

const started = (p: ReadPlayer, now: number) => p.locked || (p.kickoff !== null && Date.parse(p.kickoff) <= now);

export default function WhatWeRead() {
  const { id, setup } = useLocalSearchParams<{ id: string; setup?: string }>();
  const flow = useFlow();
  const data = useData();
  const connection = data.connections.find((c) => c.id === id) ?? null;
  const [read, setRead] = useState<ReadSummary | undefined>(() => flow.readFor(id));
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<{ message: string; signIn: boolean } | null>(null);
  const [swap, setSwap] = useState<Swap>({ step: "off" });

  const readAgain = useCallback(async () => {
    setReading(true);
    setError(null);
    try {
      const fresh = await api.read(id);
      setRead(fresh);
      flow.setRead(id, fresh);
      data.refresh().catch(() => {});
    } catch (e) {
      // Only a new ESPN sign-in fixes these two; reading again would just fail again.
      const signIn = e instanceof ApiError && (e.code === "espn_rejected" || e.code === "wrong_team");
      setError({ message: messageOf(e), signIn });
    } finally {
      setReading(false);
    }
  }, [id, flow, data]);

  const signInAgain = { title: "Sign in to ESPN again", onPress: () => router.push({ pathname: "/connect/espn", params: { mode: "reauth" } }) };

  // Straight from setup the read is seconds old; otherwise ask ESPN now.
  useEffect(() => {
    if (!read) readAgain();
    // Once, on arrival; "Read again" and pull-to-refresh do the rest.
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Which slots each player may fill, from the roster the server saved with this read. Only
  // used to grey out pairs ESPN would refuse; the server checks again before writing.
  const eligible = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const e of connection?.lastRoster?.entries ?? []) m.set(e.player.id, e.player.eligibleSlots);
    return m;
  }, [connection?.lastRoster]);

  if (!read) {
    if (error) {
      return (
        <Screen>
          <Banner tone="warn" title="Couldn't read your team" body={error.message} action={error.signIn ? signInAgain : { title: "Try again", onPress: readAgain }} />
        </Screen>
      );
    }
    return <Loading label="Reading your team from ESPN" />;
  }

  const now = Date.now();
  const byId = new Map(read.players.map((p) => [p.id, p]));
  const starters = read.players.filter((p) => p.slot !== "BENCH" && p.slot !== "IR");
  const bench = read.players.filter((p) => p.slot === "BENCH");
  const ir = read.players.filter((p) => p.slot === "IR");

  const canSwapWith = (p: ReadPlayer, other: ReadPlayer | undefined): boolean => {
    if (started(p, now) || p.slot === "IR") return false;
    if (!other) return true;
    if (other.id === p.id) return true;
    if (other.slot === p.slot) return false;
    const pe = eligible.get(p.id);
    const oe = eligible.get(other.id);
    if (pe && !pe.includes(other.slot)) return false;
    if (oe && !oe.includes(p.slot)) return false;
    return true;
  };

  const tap = (p: ReadPlayer) => {
    if (swap.step !== "picking") return;
    const picked = swap.picked.includes(p.id) ? swap.picked.filter((x) => x !== p.id) : [...swap.picked, p.id];
    if (picked.length === 2) setSwap({ step: "confirm", a: picked[0]!, b: picked[1]! });
    else setSwap({ step: "picking", picked });
  };

  const runSwap = async (a: string, b: string, back: boolean) => {
    setSwap({ step: "working", a, b, back });
    try {
      const result = await api.swap(id, a, b);
      if (result.ok) {
        setRead(result.after);
        flow.setRead(id, result.after);
        setSwap({ step: "done", a, b, back, message: result.message, at: result.after.readAt });
      } else {
        setSwap({ step: "failed", a, b, back, message: result.message });
      }
    } catch (e) {
      setSwap({ step: "failed", a, b, back, message: messageOf(e) });
    }
    data.refresh().catch(() => {});
  };

  const picking = swap.step === "picking";
  const first = picking && swap.picked.length === 1 ? byId.get(swap.picked[0]!) : undefined;
  const selected = new Set(swap.step === "picking" ? swap.picked : swap.step === "confirm" ? [swap.a, swap.b] : []);

  const section = (title: string, players: ReadPlayer[]) =>
    players.length ? (
      <View style={{ marginTop: space.lg }}>
        <Label>
          {title} ({players.length})
        </Label>
        <Card style={s.table}>
          {players.map((p, i) => (
            <PlayerRow
              key={p.id}
              p={p}
              last={i === players.length - 1}
              picking={picking}
              selected={selected.has(p.id)}
              allowed={canSwapWith(p, first)}
              now={now}
              onPress={() => tap(p)}
            />
          ))}
        </Card>
      </View>
    ) : null;

  const footer = swapFooter(swap, byId, {
    cancel: () => setSwap({ step: "off" }),
    swap: (a, b, back) => runSwap(a, b, back),
  });

  return (
    <Screen
      refreshing={reading}
      onRefresh={swap.step === "off" ? readAgain : undefined}
      footer={
        footer ??
        (setup === "1" ? (
          <Button title="This is my team" arrow large onPress={() => router.push({ pathname: "/protection", params: { id, setup: "1" } })} />
        ) : undefined)
      }
    >
      <Header title={read.teamName} subtitle={`${connection?.leagueName ? connection.leagueName + " · " : ""}Week ${read.period}`} style={{ marginBottom: space.sm }} />
      <Muted>Read from ESPN at {whenText(read.readAt)}</Muted>
      <Button title={reading ? "Reading…" : "Read again"} variant="secondary" busy={reading} disabled={swap.step !== "off"} onPress={readAgain} style={{ marginTop: space.md, alignSelf: "flex-start" }} />
      {error ? <Banner tone="warn" body={error.message} action={error.signIn ? signInAgain : undefined} /> : null}

      <Gap />
      <Card>
        <H2>Check it against the ESPN app</H2>
        <Body style={{ marginTop: space.sm }}>
          Open your team in the ESPN app. Each line here should match ESPN, top to bottom: the same slot, the same player, the same injury tag (O, Q, D, IR) and the same kickoff.
        </Body>
        <Muted style={{ marginTop: space.sm }}>If something doesn't match, tap Read again. If it still doesn't, leave protection on Tell me or Ask me first for now.</Muted>
      </Card>

      {read.warnings.map((w) => (
        <Banner key={w} tone="warn" body={w} />
      ))}

      {section("Starters", starters)}
      {section("Bench", bench)}
      {section("IR", ir)}

      {swap.step === "off" ? (
        <Card style={{ marginTop: space.xl }}>
          <H2>Test swap</H2>
          <Body style={{ marginTop: space.sm }}>
            Prove RosterBots can change your ESPN lineup. Pick two players whose games haven't started, for example a WR and your FLEX. I swap them on ESPN, read your team back to check, and you can swap them straight back.
          </Body>
          <Button title="Start a test swap" arrow onPress={() => setSwap({ step: "picking", picked: [] })} style={{ marginTop: space.lg }} />
        </Card>
      ) : null}
    </Screen>
  );
}

function PlayerRow(props: { p: ReadPlayer; last: boolean; picking: boolean; selected: boolean; allowed: boolean; now: number; onPress: () => void }) {
  const { p } = props;
  const tag = statusTag(p.status);
  const when = p.bye ? "BYE" : p.kickoff ? kickoffText(p.kickoff) : "No kickoff time";
  const dim = props.picking && !props.allowed && !props.selected;
  return (
    <Pressable
      accessibilityRole={props.picking ? "button" : undefined}
      accessibilityState={{ selected: props.selected, disabled: dim }}
      disabled={!props.picking || dim}
      onPress={props.onPress}
      style={[s.row, !props.last && s.rowLine, props.selected && s.rowPicked, dim && { opacity: 0.35 }]}
    >
      <Text style={s.slot}>{slotLabel(p.slot)}</Text>
      <View style={{ flex: 1 }}>
        <View style={s.nameLine}>
          <Text style={s.name} numberOfLines={1}>
            {p.name}
          </Text>
          {tag ? <Pill text={tag.tag} tone={tag.tone} /> : null}
        </View>
        <Muted>
          {p.position} · {p.proTeam} · {when}
          {p.projection !== null ? ` · ${p.projection.toFixed(1)} proj` : ""}
        </Muted>
        {tag || p.locked ? (
          <Text style={s.notes}>
            {tag ? <Text style={{ color: tag.tone === "out" ? color.redInk : color.amberInk, fontWeight: "700" }}>{tag.word}</Text> : null}
            {tag && p.locked ? "  ·  " : ""}
            {p.locked ? "Locked: game started" : ""}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

function swapFooter(
  swap: Swap,
  byId: Map<string, ReadPlayer>,
  on: { cancel: () => void; swap: (a: string, b: string, back: boolean) => void },
) {
  const name = (id: string) => byId.get(id)?.name ?? "that player";
  const slot = (id: string) => slotLabel(byId.get(id)?.slot ?? "");
  switch (swap.step) {
    case "off":
      return null;
    case "picking":
      return (
        <View>
          <Body style={{ marginBottom: space.md }}>Tap two players to swap. {swap.picked.length} of 2 picked.</Body>
          <Button title="Cancel" variant="secondary" onPress={on.cancel} />
        </View>
      );
    case "confirm":
      return (
        <View>
          <H2>
            Swap {name(swap.a)} and {name(swap.b)}?
          </H2>
          <Body style={{ marginTop: space.sm }}>
            {name(swap.a)}: {slot(swap.a)} to {slot(swap.b)}
            {"\n"}
            {name(swap.b)}: {slot(swap.b)} to {slot(swap.a)}
          </Body>
          <Muted style={{ marginTop: space.sm }}>This changes your real lineup on ESPN. I read it back afterwards to check.</Muted>
          <Button title="Swap them" arrow large onPress={() => on.swap(swap.a, swap.b, false)} style={{ marginTop: space.lg }} />
          <Button title="Cancel" variant="quiet" onPress={on.cancel} style={{ marginTop: space.sm }} />
        </View>
      );
    case "working":
      return (
        <View style={{ paddingVertical: space.md }}>
          <Button title="Working" busy onPress={() => {}} />
          <Muted style={{ marginTop: space.sm, textAlign: "center" }}>Asking ESPN, then reading your team back to check.</Muted>
        </View>
      );
    case "done":
      return (
        <View>
          <Pill text={swap.back ? "Swapped back" : "Verified on ESPN"} tone="healthy" />
          <Body style={{ marginTop: space.sm }}>{swap.message}</Body>
          <Muted style={{ marginTop: space.xs }}>Checked with a fresh read from ESPN at {whenText(swap.at)}. The list above is that read.</Muted>
          {swap.back ? (
            <Button title="Done" onPress={on.cancel} style={{ marginTop: space.lg }} />
          ) : (
            <>
              <Button title="Swap back" arrow large onPress={() => on.swap(swap.a, swap.b, true)} style={{ marginTop: space.lg }} />
              <Button title="Keep it this way" variant="quiet" onPress={on.cancel} style={{ marginTop: space.sm }} />
            </>
          )}
        </View>
      );
    case "failed":
      return (
        <View>
          <Pill text={swap.back ? "Swap back didn't go through" : "Swap didn't go through"} tone="out" />
          <Body style={{ marginTop: space.sm }}>{swap.message}</Body>
          <Button title="Try again" arrow onPress={() => on.swap(swap.a, swap.b, swap.back)} style={{ marginTop: space.lg }} />
          <Button title="Close" variant="quiet" onPress={on.cancel} style={{ marginTop: space.sm }} />
        </View>
      );
  }
}

const s = StyleSheet.create({
  table: { padding: 0, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "flex-start", paddingVertical: space.md, paddingHorizontal: space.lg, borderLeftWidth: 4, borderLeftColor: "transparent" },
  rowLine: { borderBottomColor: color.inkLine, borderBottomWidth: 1 },
  rowPicked: { borderLeftColor: color.orange, backgroundColor: color.orangeSoft },
  slot: { width: 58, color: color.inkMuted, fontSize: font.small, fontWeight: "800", paddingTop: 2 },
  nameLine: { flexDirection: "row", alignItems: "center", gap: space.sm },
  name: { color: color.ink, fontSize: font.body, fontWeight: "700", flexShrink: 1 },
  notes: { color: color.inkMuted, fontSize: font.small, marginTop: 2 },
});
