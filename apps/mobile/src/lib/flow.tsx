// What one screen hands the next during setup, kept in memory only: the leagues ESPN
// listed after sign-in, and the read that came back with connection-setup (so the "What
// we read" screen does not ask ESPN a second time straight away). Never the ESPN cookies.

import type { ReadSummary } from "@rosterbots/service";
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type { EspnConnectResult } from "./api";

interface Flow {
  signIn: EspnConnectResult | null;
  setSignIn: (r: EspnConnectResult | null) => void;
  readFor: (connectionId: string) => ReadSummary | undefined;
  setRead: (connectionId: string, read: ReadSummary) => void;
}

const FlowContext = createContext<Flow | null>(null);

export function FlowProvider(props: { children: ReactNode }) {
  const [signIn, setSignIn] = useState<EspnConnectResult | null>(null);
  const [reads, setReads] = useState<Record<string, ReadSummary>>({});
  const value = useMemo<Flow>(
    () => ({
      signIn,
      setSignIn,
      readFor: (id) => reads[id],
      setRead: (id, read) => setReads((cur) => ({ ...cur, [id]: read })),
    }),
    [signIn, reads],
  );
  return <FlowContext.Provider value={value}>{props.children}</FlowContext.Provider>;
}

export function useFlow(): Flow {
  const f = useContext(FlowContext);
  if (!f) throw new Error("useFlow outside FlowProvider");
  return f;
}
