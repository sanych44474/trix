import assert from "node:assert/strict";
import test from "node:test";
import { handleV2Api } from "../src/webapp/v2Api";
import { isV2Failure } from "../src/contracts/v2";
import { v2CohortEnabled } from "../src/contracts/rollout";
import type { Env } from "../src/types";

const env = { WORKER_URL: "https://example.test", TELEGRAM_BOT_TOKEN: "test" } as unknown as Env;

test("v2 dashboard returns the unified unauthorized envelope", async () => {
  const request = new Request("https://example.test/api/v2/dashboard");
  const response = await handleV2Api(request, new URL(request.url), env);
  assert.equal(response.status, 401);
  const body = await response.json() as unknown;
  assert.equal(isV2Failure(body), true);
  assert.equal((body as { error: { code: string } }).error.code, "unauthorized");
});

test("v2 unknown routes return a stable not_found error", async () => {
  const request = new Request("https://example.test/api/v2/does-not-exist");
  const response = await handleV2Api(request, new URL(request.url), env);
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: { code: "not_found", message: "Route not found" } });
});

test("v2 rejects malformed idempotency headers before touching a handler", async () => {
  const request = new Request("https://example.test/api/v2/log", { method: "POST", headers: { "Idempotency-Key": "short" } });
  const response = await handleV2Api(request, new URL(request.url), env);
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: { code: "validation_error", message: "Idempotency-Key must be 8-128 characters" } });
});

test("v2 long-tail adapters use the same unauthorized envelope", async () => {
  const request = new Request("https://example.test/api/v2/challenges");
  const response = await handleV2Api(request, new URL(request.url), env);
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: { code: "unauthorized", message: "unauthorized" } });
});

test("v2 failure detection rejects success envelopes", () => {
  assert.equal(isV2Failure({ data: { ok: true } }), false);
  assert.equal(isV2Failure({ error: { code: "conflict", message: "stale" } }), true);
});

test("v2 rollout uses stable percentage buckets and internal allow-list", () => {
  const rolloutEnv = { V2_DUAL_WRITE: "0", V2_COHORT_PERCENT: "10", V2_INTERNAL_USER_IDS: "42, 99" } as Env;
  assert.equal(v2CohortEnabled(rolloutEnv, 42), true);
  assert.equal(v2CohortEnabled(rolloutEnv, 99), true);
  assert.equal(v2CohortEnabled(rolloutEnv, 9), true);
  assert.equal(v2CohortEnabled(rolloutEnv, 11), false);
  assert.equal(v2CohortEnabled(rolloutEnv, 111), false);
});
