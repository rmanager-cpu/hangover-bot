// Proposals waiting for the user's answer, with big Approve and Decline buttons. The
// approval is the user's authority, so it works at any protection level; the server
// re-reads ESPN, checks the move still makes sense, writes, verifies and receipts.

import { useState } from "react";
import { View } from "react-native";
import { api, messageOf } from "./lib/api";
import { useData, type Proposal } from "./lib/data";
import { kickoffText, whenText } from "./lib/format";
import { color, space } from "./theme";
import { Body, Button, Card, H2, Label, Muted, Pill } from "./ui";

const sentence = (t: string) => (/[.!?]$/.test(t) ? t : t + ".");

type Answer = { proposal: Proposal; ok: boolean; message: string };

export function Proposals(props: { pending: Proposal[]; limit?: number }) {
  const { refresh } = useData();
  const [busy, setBusy] = useState<{ id: string; decision: "approve" | "decline" } | null>(null);
  // Answers stay on screen after the proposal leaves the pending list, until the user moves on.
  const [answers, setAnswers] = useState<Answer[]>([]);

  const answered = new Set(answers.map((a) => a.proposal.id));
  const shown = props.pending.filter((p) => !answered.has(p.id)).slice(0, props.limit ?? 25);

  const decide = async (p: Proposal, decision: "approve" | "decline") => {
    if (busy) return;
    setBusy({ id: p.id, decision });
    let answer: Answer;
    try {
      const r = await api.decide(p.id, decision);
      answer = { proposal: p, ok: r.ok, message: r.message };
    } catch (e) {
      answer = { proposal: p, ok: false, message: messageOf(e) };
    }
    setAnswers((cur) => [answer, ...cur]);
    setBusy(null);
    refresh().catch(() => {});
  };

  return (
    <View>
      {answers.map((a) => (
        <Card key={"a" + a.proposal.id}>
          <Pill text={a.ok ? "Answered" : "Didn't go through"} tone={a.ok ? "healthy" : "out"} />
          <H2 style={{ marginTop: space.sm }}>{a.proposal.summary}</H2>
          <Body style={{ marginTop: space.sm }}>{a.message}</Body>
        </Card>
      ))}
      {shown.map((p) => {
        const auto = !!p.autoAt;
        const mine = busy?.id === p.id;
        return (
          <Card key={p.id} tone={auto ? "light" : "warn"}>
            <Label style={auto ? undefined : { color: color.orange }}>{auto ? "Scheduled move" : "Your call"}</Label>
            <H2>{p.summary}</H2>
            {p.reason ? <Body style={{ marginTop: space.xs }}>{sentence(p.reason)}</Body> : null}
            {p.autoAt ? (
              <Body style={{ marginTop: space.sm }}>I'll do it automatically at {whenText(p.autoAt)} if nothing changes. Approve to do it now.</Body>
            ) : null}
            {p.deadline ? <Muted style={{ marginTop: space.xs }}>Answer before kickoff, {kickoffText(p.deadline)}.</Muted> : null}
            <Button
              title="Approve"
              arrow
              large
              busy={mine && busy?.decision === "approve"}
              disabled={!!busy}
              onPress={() => decide(p, "approve")}
              style={{ marginTop: space.lg }}
            />
            <Button
              title="Decline"
              variant="secondary"
              large
              busy={mine && busy?.decision === "decline"}
              disabled={!!busy}
              onPress={() => decide(p, "decline")}
              style={{ marginTop: space.sm }}
            />
          </Card>
        );
      })}
    </View>
  );
}
