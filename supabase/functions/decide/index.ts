// decide: the user's answer to a proposal.
//   { actionId, decision: "approve" | "decline" } -> DecisionResult
// The service checks the action is theirs and still pending, and on approve re-reads,
// writes, verifies and receipts. A refusal is a DecisionResult too, so it is a 200.

import { decideAction } from "@rosterbots/service";
import { requireUser } from "../_lib/auth.ts";
import { makeDeps } from "../_lib/deps.ts";
import { HttpError, json, readBody, serve, uuid } from "../_lib/http.ts";
import { adminClient, createStore } from "../_lib/store.ts";

serve("decide", async (req) => {
  const db = adminClient();
  const user = await requireUser(req, db);
  const body = await readBody(req);
  const actionId = uuid(body, "actionId");
  const decision = body.decision;
  if (decision !== "approve" && decision !== "decline") {
    throw new HttpError(400, "bad_request", 'decision must be "approve" or "decline".');
  }

  const result = await decideAction(makeDeps(createStore(db)), user.id, actionId, decision);
  console.log(`decide: action ${actionId} ${decision}: ${result.ok ? result.status : result.error}`);
  return json(result);
});
