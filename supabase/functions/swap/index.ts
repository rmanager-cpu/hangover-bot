// swap: the test swap the user picks on the "What we read" screen.
//   { connectionId, playerIdA, playerIdB } -> SwapResult
// The service checks both players, writes, verifies with a fresh read and receipts.
// A refusal is a SwapResult too, so it is a 200.

import { manualSwap } from "@rosterbots/service";
import { requireUser } from "../_lib/auth.ts";
import { makeDeps } from "../_lib/deps.ts";
import { json, providerId, readBody, serve, uuid } from "../_lib/http.ts";
import { adminClient, createStore } from "../_lib/store.ts";

serve("swap", async (req) => {
  const db = adminClient();
  const user = await requireUser(req, db);
  const body = await readBody(req);
  const connectionId = uuid(body, "connectionId");
  // A D/ST's id is negative and real.
  const playerIdA = providerId(body, "playerIdA");
  const playerIdB = providerId(body, "playerIdB");

  const result = await manualSwap(makeDeps(createStore(db)), user.id, connectionId, playerIdA, playerIdB);
  console.log(`swap: connection ${connectionId}: ${result.ok ? "done" : result.error}`);
  return json(result);
});
