// Home stays small (handoff section 3), laid out as the brand sheet draws it: are you
// covered, the team card with its watched starters, the last action, and anything
// unresolved. The robot peeks in beside the headline when all is well.

import { router, useFocusEffect } from "expo-router";
import { useCallback, useEffect } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { ROBOT_PEEK } from "../../src/brand";
import { Clock, GearIcon, Tick, Tile } from "../../src/icons";
import { useData, usePull, type Connection, type Proposal } from "../../src/lib/data";
import { agoText, kickoffText, protectionLine, slotLabel, statusPill, untilText, whenText } from "../../src/lib/format";
import { usePush } from "../../src/lib/push";
import { nextKickoff, problems, proposalFor, shortName, starters, type Problem } from "../../src/lib/roster";
import { useSession } from "../../src/lib/session";
import { Proposals } from "../../src/Proposals";
import { color, space } from "../../src/theme";
import { Banner, Body, Button, Card, Divider, Dot, H2, Hero, Label, Loading, Muted, Pill, Row, Screen, Wordmark } from "../../src/ui";

export default function Home() {
  const data = useData();
  const { refresh } = data;
  const { claimed } = useSession();
  const push = usePush();
  const pull = usePull();
  const conn = data.connection;

  useFocusEffect(
    useCallback(() => {
      refresh().catch(() => {});
    }, [refresh]),
  );

  // The first time Home shows, ask for alerts: this is when they start to matter.
  useEffect(() => {
    if (push.state.status === "unknown") push.enable(true);
  }, [push]);

  if (!conn) return <Loading />;

  const now = new Date();
  const mine = data.pending.filter((p) => p.connectionId === conn.id);
  const needTap = mine.filter((p) => !p.autoAt);
  const scheduled = mine.filter((p) => p.autoAt);
  const roster = conn.lastRoster;
  const open = roster ? problems(roster, now).filter((pr) => !proposalFor(pr, mine, conn.id)) : [];
  const receipt = data.activity.find((a) => a.connectionId === conn.id && a.type === "ACTION_COMPLETED");
  const actingAsAskMe = (conn.authority === "bench_protection" || conn.authority === "ai_rescue") && !claimed;
  const waitingAdvice = conn.authority === "ai_rescue" ? data.advice.filter((a) => a.connectionId === conn.id && a.status === "pending").length : 0;
  const next = roster ? nextKickoff(roster, now) : null;
  const weekLine = roster ? `Week ${roster.period} · ${next ? `Next lock ${kickoffText(next.at)}` : "No more kickoffs this week"}` : "Not read yet";

  return (
    <Screen edges={["top", "left", "right"]} {...pull}>
      <View style={s.top}>
        <Wordmark width={168} />
        <Pressable accessibilityRole="button" accessibilityLabel="Settings" onPress={() => router.push("/settings")} hitSlop={10}>
          <GearIcon color={color.muted} size={26} />
        </Pressable>
      </View>
      {data.connections.length > 1 ? (
        <Pressable accessibilityRole="button" onPress={() => cycle(data.connections, conn, data.select)} hitSlop={8} style={{ alignSelf: "flex-start", marginBottom: space.md }}>
          <Pill text={(conn.leagueName ?? "League") + "  ›"} />
        </Pressable>
      ) : null}

      <Status conn={conn} claimed={claimed} needTap={needTap} open={open} scheduled={scheduled} />

      {needTap.length ? <Proposals pending={needTap} limit={2} /> : null}

      {data.error ? <Banner tone="warn" body={data.error} /> : null}

      <Card>
        <View style={s.cardHead}>
          <Tile tone="orange">
            <Tick size={16} />
          </Tile>
          <View style={{ flex: 1 }}>
            <H2 style={{ fontSize: 20 }} numberOfLines={1}>
              {conn.teamName ?? "Your team"}
            </H2>
            <Muted style={{ marginTop: 2 }}>{weekLine}</Muted>
            {next ? <Muted>{`${next.names.map(shortName).join(", ")} ${untilText(next.at, now)}`}</Muted> : null}
          </View>
        </View>
        <Divider style={{ marginVertical: space.lg }} />
        <Label>Watched starters</Label>
        {roster ? (
          starters(roster).map((e, i, all) => {
            const pill = statusPill(e.player.status, e.player.game === null);
            return (
              <View key={e.player.id + e.slot + i} style={[s.starter, i < all.length - 1 && s.starterLine]}>
                <View style={s.slot}>
                  <Text style={s.slotText}>{slotLabel(e.slot)}</Text>
                </View>
                <Body style={{ flex: 1, fontWeight: "600" }} numberOfLines={1}>
                  {e.player.name}
                </Body>
                <Pill text={pill.text} tone={pill.tone} />
              </View>
            );
          })
        ) : (
          <Muted>RosterBots hasn't read your team yet.</Muted>
        )}
        <Divider style={{ marginTop: space.sm }} />
        <Row title="What we read from ESPN" detail={roster ? "Your team as RosterBots sees it, and the test swap" : "Read it now"} onPress={() => router.push({ pathname: "/read/[id]", params: { id: conn.id } })} last />
      </Card>

      <Card>
        <View style={s.cardHead}>
          <Tile tone="grey">
            <Clock />
          </Tile>
          <View style={{ flex: 1 }}>
            <H2 style={{ fontSize: 20 }}>Last action</H2>
            {receipt ? (
              <>
                <Body style={{ marginTop: 2 }}>{receipt.title}</Body>
                <Muted style={{ marginTop: 2 }}>
                  {receipt.body ? receipt.body + " · " : ""}
                  {whenText(receipt.createdAt)}
                </Muted>
              </>
            ) : (
              <Muted style={{ marginTop: 2 }}>No moves made yet.</Muted>
            )}
          </View>
        </View>
        <View style={s.actions}>
          <Button title="View activity" variant="secondary" onPress={() => router.push("/activity")} style={s.action} />
          <Button title="Manage protection" onPress={() => router.push({ pathname: "/protection", params: { id: conn.id } })} style={s.action} />
        </View>
        {conn.authority === "ai_rescue" ? (
          <Row title="Roster Advice" detail={waitingAdvice ? `${waitingAdvice} ${waitingAdvice === 1 ? "suggestion" : "suggestions"} waiting for you` : "The AI's suggestions, one tap each"} onPress={() => router.push("/advice")} last />
        ) : null}
      </Card>

      {actingAsAskMe ? (
        <Banner
          tone="warn"
          title="Working as Alert Me"
          body="Auto Protect and AI Native only move players on their own for a claimed account. Until then I send you each move to tap."
          action={{ title: "Claim your account", onPress: () => router.push({ pathname: "/claim", params: { id: conn.id } }) }}
        />
      ) : null}

      {push.state.status === "denied" ? (
        <Banner body="Alerts are off for RosterBots on this phone, so you'll only see news when you open the app." action={{ title: "Turn on alerts", onPress: () => push.enable(true) }} />
      ) : push.state.status === "unavailable" ? (
        <Banner body={push.state.reason} />
      ) : null}
    </Screen>
  );
}

function cycle(all: Connection[], cur: Connection, select: (id: string) => void) {
  const i = all.findIndex((c) => c.id === cur.id);
  const next = all[(i + 1) % all.length];
  if (next) select(next.id);
}

function Status(props: { conn: Connection; claimed: boolean; needTap: Proposal[]; open: Problem[]; scheduled: Proposal[] }) {
  const { conn } = props;
  const team = conn.teamName ?? "your team";
  const line = protectionLine(conn.authority, props.claimed, conn.status);
  const checked = conn.lastCheckedAt
    ? `Last checked ${agoText(conn.lastCheckedAt)}.`
    : conn.nextCheckAt
      ? `First check ${untilText(conn.nextCheckAt)}.`
      : "First check coming up.";

  if (conn.status === "needs_reauth") {
    return (
      <>
        <Headline tone="red" title="Signed out of ESPN" line="ESPN signed RosterBots out." />
        <Card tone="warn">
          <Body>Sign in to ESPN again so I can keep watching {team}. Until then I can't see or fix your lineup.</Body>
          <Button title="Sign in to ESPN" arrow large onPress={() => router.push({ pathname: "/connect/espn", params: { mode: "reauth" } })} style={{ marginTop: space.lg }} />
        </Card>
      </>
    );
  }
  if (conn.status === "paused") {
    return (
      <>
        <Headline tone="muted" title="Paused" line={line} />
        <Card>
          <Body>I'm not watching {team} right now.</Body>
          <Button title="Resume in Settings" variant="secondary" onPress={() => router.push("/settings")} style={{ marginTop: space.lg, alignSelf: "flex-start" }} />
        </Card>
      </>
    );
  }
  if (props.needTap.length || props.open.length) {
    return (
      <>
        <Headline tone="orange" title="Action needed" line={line} note={checked} />
        <Card tone="warn">
          {props.open.map((p, i) => (
            <Body key={p.text + i} style={{ fontWeight: "600", marginBottom: space.xs }}>
              {p.text}.
            </Body>
          ))}
          {props.open.length ? (
            <Muted>
              {conn.authority === "alerts" || conn.authority === "ask_me"
                ? "You're on Alert Me, so the fix is yours to tap: it's in Activity when I have one."
                : !conn.lastCheckedAt
                  ? // Before the first check nothing has been judged yet, so "no move" would be
                    // wrong: the Oct 3 install showed it for an OUT starter with a healthy bench.
                    "I haven't checked this yet. If there's a move to make, it comes here after the first check."
                  : "I don't have a move I can make for this. Check your lineup in the ESPN app."}
            </Muted>
          ) : null}
          {props.needTap.length ? (
            <Body style={{ fontWeight: "600", marginTop: props.open.length ? space.sm : 0 }}>
              {props.needTap.length === 1 ? "One move needs your answer." : `${props.needTap.length} moves need your answer.`}
            </Body>
          ) : null}
        </Card>
      </>
    );
  }
  return (
    <>
      <Headline tone="green" title="You're covered" line={line} note={checked} robot />
      {props.scheduled.map((p) => (
        <Body key={p.id} style={{ color: color.muted, marginBottom: space.md }}>
          Scheduled for {whenText(p.autoAt!)}: {p.summary.charAt(0).toLowerCase() + p.summary.slice(1)}.
        </Body>
      ))}
    </>
  );
}

/** The big line at the top of Home, with the robot peeking in from the right when asked. */
function Headline(props: { tone: "green" | "orange" | "red" | "muted"; title: string; line: string; note?: string; robot?: boolean }) {
  return (
    <View style={s.headline}>
      {props.robot ? <Image source={ROBOT_PEEK.source} style={s.robot} resizeMode="contain" accessibilityIgnoresInvertColors /> : null}
      <View style={[{ flex: 1 }, props.robot && { paddingRight: 96 }]}>
        <View style={s.headRow}>
          <Dot tone={props.tone} />
          <Hero style={s.hero}>{props.title}</Hero>
        </View>
        <Body style={s.line}>{props.line}</Body>
        {props.note ? <Muted style={{ marginTop: space.xs }}>{props.note}</Muted> : null}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  top: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: space.lg, marginTop: space.xs },
  headline: { minHeight: 96, justifyContent: "center", marginBottom: space.lg },
  headRow: { flexDirection: "row", alignItems: "center", gap: space.md },
  hero: { fontSize: 32, lineHeight: 38, flexShrink: 1 },
  line: { color: color.muted, fontSize: 17, marginTop: space.xs, marginLeft: 14 + space.md },
  robot: { position: "absolute", right: -space.sm, top: -space.md, width: 176, height: 176 / ROBOT_PEEK.aspect },
  cardHead: { flexDirection: "row", alignItems: "center", gap: space.md },
  starter: { flexDirection: "row", alignItems: "center", paddingVertical: space.sm, gap: space.md },
  starterLine: { borderBottomWidth: 1, borderBottomColor: color.inkLine },
  slot: { width: 44, height: 44, borderRadius: 22, backgroundColor: color.inkRaised, alignItems: "center", justifyContent: "center" },
  slotText: { color: color.inkMuted, fontSize: 11, fontWeight: "800" },
  actions: { flexDirection: "row", gap: space.sm, marginTop: space.lg },
  action: { flex: 1, paddingHorizontal: space.md },
});
