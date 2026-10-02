import { Redirect } from "expo-router";
import { useState } from "react";
import { useData } from "../src/lib/data";
import { launchedFromAlert } from "../src/lib/push";
import { Body, Button, Centered, Gap, Loading } from "../src/ui";

// Where the app opens: setup for someone with no league yet, Home for everyone else, and
// Activity when a tapped alert opened the app.
export default function Index() {
  const { loading, error, connections, refresh } = useData();
  const [fromAlert] = useState(launchedFromAlert);

  if (loading) return <Loading />;
  if (error && !connections.length) {
    return (
      <Centered>
        <Body style={{ textAlign: "center" }}>{error}</Body>
        <Gap />
        <Button title="Try again" onPress={() => refresh().catch(() => {})} />
      </Centered>
    );
  }
  if (!connections.length) return <Redirect href="/welcome" />;
  return <Redirect href={fromAlert ? "/activity" : "/home"} />;
}
