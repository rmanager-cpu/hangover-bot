// expoPush with a fake fetch: what Expo receives. Nothing here reaches Expo.
import { test } from "node:test";
import assert from "node:assert/strict";
import { EXPO_PUSH_URL, expoPush } from "../src/index.ts";

function fakeFetch(status = 200) {
  const calls: { url: string; init: RequestInit }[] = [];
  const f = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify({ data: [] }), { status });
  }) as typeof fetch;
  return { f, calls };
}

const msg = { title: "Jaylen Wright is in at RB", body: "Achane was ruled OUT. Moved Jaylen Wright from bench to RB.", data: { actionId: "act-1" } };

test("one POST of JSON messages to Expo's push endpoint", async () => {
  const { f, calls } = fakeFetch();
  await expoPush(f).send(["ExponentPushToken[a]", "ExponentPushToken[b]"], msg);
  assert.equal(EXPO_PUSH_URL, "https://exp.host/--/api/v2/push/send");
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.url, EXPO_PUSH_URL);
  assert.equal(calls[0]!.init.method, "POST");
  assert.deepEqual(calls[0]!.init.headers, { accept: "application/json", "content-type": "application/json" });
  assert.deepEqual(JSON.parse(String(calls[0]!.init.body)), [
    { to: "ExponentPushToken[a]", title: msg.title, body: msg.body, sound: "default", priority: "high", data: { actionId: "act-1" } },
    { to: "ExponentPushToken[b]", title: msg.title, body: msg.body, sound: "default", priority: "high", data: { actionId: "act-1" } },
  ]);
});

test("at most 100 messages a request, and a token listed twice is sent once", async () => {
  const { f, calls } = fakeFetch();
  const tokens = Array.from({ length: 250 }, (_, i) => `ExponentPushToken[${i}]`);
  await expoPush(f).send([...tokens, tokens[0]!], msg);
  assert.deepEqual(calls.map((c) => JSON.parse(String(c.init.body)).length), [100, 100, 50]);
});

test("no tokens, no request", async () => {
  const { f, calls } = fakeFetch();
  await expoPush(f).send([], msg);
  assert.equal(calls.length, 0);
});

test("a refused request is an error the caller sees", async () => {
  const { f } = fakeFetch(500);
  await assert.rejects(expoPush(f).send(["ExponentPushToken[a]"], msg), /HTTP 500/);
});
