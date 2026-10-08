// The shared-secret gates in front of /webhook and /admin/*. Both used to compare with ===, and an
// unset secret relied on `null !== undefined` happening to be true. These pin the behaviour through
// the real Worker entry point: wrong, missing and (the dangerous case) UNSET secrets are all 401,
// and only the exact secret passes the gate.
import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index";
import { newDb } from "./harness";
import type { Env } from "../src/types";

const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;
const envWith = (extra: Partial<Env>): Env => ({ DB: newDb(), TELEGRAM_BOT_TOKEN: "1:t", ...extra } as unknown as Env);

const adminCall = (env: Env, headers: Record<string, string> = {}) =>
  worker.fetch(new Request("https://w.example/admin/ping-stuck", { method: "POST", headers }), env, ctx);
const webhookCall = (env: Env, headers: Record<string, string> = {}) =>
  worker.fetch(new Request("https://w.example/webhook", { method: "POST", headers, body: "{}" }), env, ctx);

test("/admin: wrong or missing secret is 401", async () => {
  const env = envWith({ ADMIN_SECRET: "right" });
  assert.equal((await adminCall(env)).status, 401);
  assert.equal((await adminCall(env, { "X-Admin-Secret": "wrong" })).status, 401);
  assert.equal((await adminCall(env, { "X-Admin-Secret": "righ" })).status, 401, "a prefix is not the secret");
  assert.equal((await adminCall(env, { "X-Admin-Secret": "right!" })).status, 401);
});

test("/admin: an UNSET secret never authorizes, even with an empty header", async () => {
  for (const env of [envWith({}), envWith({ ADMIN_SECRET: "" })]) {
    assert.equal((await adminCall(env)).status, 401);
    assert.equal((await adminCall(env, { "X-Admin-Secret": "" })).status, 401);
    assert.equal((await adminCall(env, { "X-Admin-Secret": "anything" })).status, 401);
  }
});

test("/admin: the exact secret passes the gate", async () => {
  const env = envWith({ ADMIN_SECRET: "right" });
  assert.notEqual((await adminCall(env, { "X-Admin-Secret": "right" })).status, 401);
});

test("/webhook: wrong, missing and unset secret are 401", async () => {
  const env = envWith({ TELEGRAM_WEBHOOK_SECRET: "hook" });
  assert.equal((await webhookCall(env)).status, 401);
  assert.equal((await webhookCall(env, { "x-telegram-bot-api-secret-token": "nope" })).status, 401);
  const unset = envWith({});
  assert.equal((await webhookCall(unset)).status, 401);
  assert.equal((await webhookCall(unset, { "x-telegram-bot-api-secret-token": "" })).status, 401);
});

test("/webhook: the exact secret passes the gate", async () => {
  const env = envWith({ TELEGRAM_WEBHOOK_SECRET: "hook" });
  assert.notEqual((await webhookCall(env, { "x-telegram-bot-api-secret-token": "hook" })).status, 401);
});
