// Home stays small (handoff section 3): are you covered, the next kickoff, who's being
// watched, the protection level, anything unresolved, and the last receipt.

import { router, useFocusEffect } from "expo-router";
import { useCallback, useEffect } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useData, usePull, type Connection, type Proposal } from "../../src/lib/data";
import { agoText, AUTHORITY, kickoffText, slotLabel, statusTag, untilText, whenText } from "../../src/lib/format";
import { usePush } from "../../src/lib/push";
import { nextKickoff, problems, proposalFor, shortName, starters, type Problem } from "../../src/lib/roster";
import { useSession } from "../../src/lib/session";
import { Proposals } from "../../src/Proposals";
import { color, font, space } from "../../src/theme";
import { Banner, Body, Button, Card, H2, Hero, Label, Loading, Muted, Pill, Screen } from "../../src/ui";

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

  return (
    <Screen edges={["top", "left", "right"]} {...pull}>
      <View style={s.top}>
        <Text style={s.brand}>HangoverBot</Text>
        {data.connections.length > 1 ? (
          <Pressable onPress={() => cycle(data.connections, conn, data.select)} hitSlop={8}>
            <Pill text={(conn.leagueName ?? "League") + "  ›"} />
          </Pressable>
        ) : null}
      </View>

      <Status conn={conn} needTap={needTap} open={open} scheduled={scheduled} />

      {needTap.length ? <Proposals pending={needTap} limit={2} /> : null}

      {data.error ? <Banner tone="warn" body={data.error} /> : null}

      {roster ? <Kickoff roster={roster} now={now} /> : null}

      {roster ? (
        <Card>
          <Label>Watched starters</Label>
          {starters(roster).map((e, i, all) => {
            const tag = statusTag(e.player.status);
            const bye = e.player.game === null;
            return (
              <View key={e.player.id + e.slot + i} style={[s.starter, i < all.length - 1 && s.line]}>
                <Text style={s.slot}>{slotLabel(e.slot)}</Text>
                <Body style={{ flex: 1 }} numberOfLines={1}>
                  {e.player.name}
                </Body>
                {bye ? <Pill text="BYE" tone="warn" /> : tag ? <Pill text={tag.tag} tone="warn" /> : null}
              </View>
            );
          })}
          <Button title="What we read from ESPN" variant="quiet" onPress={() => router.push({ pathname: "/read/[id]", params: { id: conn.id } })} style={{ alignSelf: "flex-start", marginTop: space.sm }} />
        </Card>
      ) : (
        <Banner body="HangoverBot hasn't read your team yet." action={{ title: "Read it now", onPress: () => router.push({ pathname: "/read/[id]", params: { id: conn.id } }) }} />
      )}

      <Card>
        <Label>Protection</Label>
        <H2>{AUTHORITY[conn.authority === "ai_rescue" ? "bench_protection" : conn.authority].name}</H2>
        <Muted style={{ marginTop: space.xs }}>
          {actingAsAskMe ? "Working as Ask Me until you claim your account." : AUTHORITY[conn.authority === "ai_rescue" ? "bench_protection" : conn.authority].short}
        </Muted>
        <View style={{ flexDirection: "row", gap: space.sm, marginTop: space.md, flexWrap: "wrap" }}>
          <Button title="Change" variant="secondary" onPress={() => router.push({ pathname: "/protection", params: { id: conn.id } })} />
          {actingAsAskMe ? <Button title="Claim your account" variant="decisive" onPress={() => router.push({ pathname: "/claim", params: { id: conn.id } })} /> : null}
        </View>
      </Card>

      <Card>
        <Label>Last receipt</Label>
        {receipt ? (
          <>
            <H2>{receipt.title}</H2>
            <Body style={{ marginTop: space.xs }}>{receipt.body}</Body>
            <Muted style={{ marginTop: space.xs }}>{whenText(receipt.createdAt)}</Muted>
          </>
        ) : (
          <Muted>No moves yet. Every move I make shows up in Activity with a receipt.</Muted>
        )}
        <Button title="All activity" variant="quiet" onPress={() => router.push("/activity")} style={{ alignSelf: "flex-start", marginTop: space.sm }} />
      </Card>

      {push.state.status === "denied" ? (
        <Banner body="Alerts are off for HangoverBot on this phone, so you'll only see news when you open the app." action={{ title: "Turn on alerts", onPress: () => push.enable(true) }} />
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

function Status(props: { conn: Connection; needTap: Proposal[]; open: Problem[]; scheduled: Proposal[] }) {
  const { conn } = props;
  const team = conn.teamName ?? "your team";
  const checked = conn.lastCheckedAt ? `Last checked ${agoText(conn.lastCheckedAt)}.` : "First check coming up.";

  if (conn.status === "needs_reauth") {
    return (
      <Card tone="warn">
        <Text style={[s.state, { color: color.orange }]}>ACTION NEEDED</Text>
        <H2 style={{ marginTop: space.sm }}>ESPN signed HangoverBot out</H2>
        <Body style={{ marginTop: space.xs }}>Sign in to ESPN again so I can keep watching {team}. Until then I can't see or fix your lineup.</Body>
        <Button title="Sign in to ESPN" variant="decisive" large onPress={() => router.push({ pathname: "/connect/espn", params: { mode: "reauth" } })} style={{ marginTop: space.lg }} />
      </Card>
    );
  }
  if (conn.status === "paused") {
    return (
      <Card>
        <Text style={s.state}>PAUSED</Text>
        <Body style={{ marginTop: space.sm }}>I'm not watching {team} right now.</Body>
        <Button title="Resume in Settings" variant="secondary" onPress={() => router.push("/settings")} style={{ marginTop: space.lg, alignSelf: "flex-start" }} />
      </Card>
    );
  }
  if (props.needTap.length || props.open.length) {
    return (
      <Card tone="warn">
        <Text style={[s.state, { color: color.orange }]}>ACTION NEEDED</Text>
        {props.open.map((p, i) => (
          <Body key={p.text + i} style={{ marginTop: space.sm }}>
            {p.text}.
          </Body>
        ))}
        {props.open.length ? (
          <Muted style={{ marginTop: space.xs }}>
            {conn.authority === "alerts" ? "You're on Alerts, so I leave the fix to you in the ESPN app." : "I don't have a move I can make for this. Check your lineup in the ESPN app."}
          </Muted>
        ) : null}
        {props.needTap.length ? <Body style={{ marginTop: space.sm }}>{props.needTap.length === 1 ? "One move needs your answer." : `${props.needTap.length} moves need your answer.`}</Body> : null}
        <Muted style={{ marginTop: space.sm }}>{checked}</Muted>
      </Card>
    );
  }
  return (
    <Card tone="calm" style={s.covered}>
      <View style={s.check}>
        <View style={s.checkMark} />
      </View>
      <Hero style={{ marginTop: space.md }}>YOU'RE COVERED</Hero>
      <Body style={{ marginTop: space.xs, color: color.muted }}>{team}</Body>
      {props.scheduled.map((p) => (
        <Body key={p.id} style={{ marginTop: space.md }}>
          Scheduled for {whenText(p.autoAt!)}: {p.summary.charAt(0).toLowerCase() + p.summary.slice(1)}.
        </Body>
      ))}
      <Muted style={{ marginTop: space.sm }}>{checked}</Muted>
    </Card>
  );
}

function Kickoff(props: { roster: NonNullable<Connection["lastRoster"]>; now: Date }) {
  const next = nextKickoff(props.roster, props.now);
  return (
    <Card>
      <Label>Next kickoff</Label>
      {next ? (
        <>
          <H2>
            {kickoffText(next.at)} <Text style={{ color: color.muted, fontWeight: "400", fontSize: font.body }}>({untilText(next.at, props.now)})</Text>
          </H2>
          <Muted style={{ marginTop: space.xs }}>{next.names.map(shortName).join(", ")}</Muted>
        </>
      ) : (
        <Muted>No more kickoffs for your starters this week.</Muted>
      )}
    </Card>
  );
}

const s = StyleSheet.create({
  top: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: space.lg, marginTop: space.sm },
  brand: { color: color.text, fontSize: font.h2, fontWeight: "900", letterSpacing: 0.3 },
  state: { color: color.text, fontSize: font.title, fontWeight: "900", letterSpacing: 0.5 },
  covered: { alignItems: "flex-start", paddingVertical: space.xl },
  check: { width: 44, height: 44, borderRadius: 22, backgroundColor: color.purple, alignItems: "center", justifyContent: "center" },
  checkMark: { width: 18, height: 10, borderLeftWidth: 3.5, borderBottomWidth: 3.5, borderColor: color.paper, transform: [{ rotate: "-45deg" }], marginTop: -4 },
  starter: { flexDirection: "row", alignItems: "center", paddingVertical: space.sm, gap: space.md },
  line: { borderBottomWidth: 1, borderBottomColor: color.line },
  slot: { width: 44, color: color.muted, fontSize: font.small, fontWeight: "800" },
});

