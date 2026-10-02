// Every user starts as an anonymous Supabase session on first launch, with nothing to fill
// in. Claiming the account by email (claim.tsx) turns the same user into a real one, which
// is what Bench Protection needs before it may move anyone unattended.

import type { User } from "@supabase/supabase-js";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { supabase } from "./supabase";

type State = { status: "loading" } | { status: "ready"; user: User } | { status: "error"; message: string };

interface Session {
  state: State;
  user: User | null;
  /** Claimed by email: no longer anonymous. */
  claimed: boolean;
  retry: () => void;
}

const SessionContext = createContext<Session | null>(null);

export function SessionProvider(props: { children: ReactNode }) {
  const [state, setState] = useState<State>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    (async () => {
      const { data, error: stored } = await supabase.auth.getSession();
      if (data.session) {
        if (live) setState({ status: "ready", user: data.session.user });
        return;
      }
      // A saved session that couldn't be refreshed (offline, say) is still this user's. Starting
      // a new anonymous one here would orphan their league, so wait for a retry instead.
      if (stored) {
        if (live) setState({ status: "error", message: "Couldn't reach HangoverBot. Check your connection and try again." });
        return;
      }
      const { data: signedIn, error } = await supabase.auth.signInAnonymously();
      if (!live) return;
      if (error || !signedIn.user) {
        setState({ status: "error", message: "Couldn't start HangoverBot. Check your connection and try again." });
      } else {
        setState({ status: "ready", user: signedIn.user });
      }
    })().catch(() => {
      if (live) setState({ status: "error", message: "Couldn't start HangoverBot. Check your connection and try again." });
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (live && session?.user) setState({ status: "ready", user: session.user });
    });
    return () => {
      live = false;
      sub.subscription.unsubscribe();
    };
  }, [attempt]);

  const retry = useCallback(() => {
    setState({ status: "loading" });
    setAttempt((n) => n + 1);
  }, []);

  const value = useMemo<Session>(() => {
    const user = state.status === "ready" ? state.user : null;
    return { state, user, claimed: !!user && !user.is_anonymous, retry };
  }, [state, retry]);

  return <SessionContext.Provider value={value}>{props.children}</SessionContext.Provider>;
}

export function useSession(): Session {
  const s = useContext(SessionContext);
  if (!s) throw new Error("useSession outside SessionProvider");
  return s;
}
