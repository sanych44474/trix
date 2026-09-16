import assert from "node:assert/strict";
import test from "node:test";
import { handleV2Api } from "../src/webapp/v2Api";
import { isV2Failure } from "../src/contracts/v2";
import { v2CohortEnabled } from "../src/contracts/rollout";
import { getOrCreateUser } from "../src/adapters/d1/v2Users";
import { newDb } from "./harness";
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

// Regression for a live production bug: forward() used to wrap EVERY mutating /api/v2/* request
// in its own runIdempotent claim, then call the underlying handler -- but handleWorkoutApi (like
// settingsApi.ts, trainerApi.ts, and miscApi.ts's handleInjuriesApi) ALSO claims the same
// Idempotency-Key internally. The outer claim always committed first, so the inner claim's insert
// always collided with it (a real conflict, not a race) and the inner handler always got "still
// processing" -> 409, with saveWorkout never actually running. Confirmed live: /api/v2/workout/save
// 409'd on every attempt while v2_workout_sessions received zero writes. Uses the ?debugUser dev
// auth bypass (src/webapp/auth.ts), which only activates when env.WORKER_URL is unset.
test("v2 workout save is not double-claimed by forward()'s own idempotency wrap", async () => {
  const db = newDb();
  const userId = 9001;
  await getOrCreateUser(db, userId, userId, "en", "Test");
  const testEnv = { DB: db, TELEGRAM_BOT_TOKEN: "test" } as unknown as Env; // no WORKER_URL -> debugUser bypass live

  const request = new Request(`https://example.test/api/v2/workout/save?debugUser=${userId}`, {
    method: "POST",
    headers: { "Idempotency-Key": "regression-test-key-001" },
    body: JSON.stringify({ entries: [{ name: "Bench Press", sets: [{ reps: 8, weight: 60 }] }] }),
  });
  const response = await handleV2Api(request, new URL(request.url), testEnv);
  const body = await response.json() as unknown;
  assert.equal(response.status, 200, `expected a real save to succeed, got ${response.status}: ${JSON.stringify(body)}`);

  const row = await db.prepare("SELECT id FROM v2_workout_sessions WHERE accountId = ?").bind(userId).first<{ id: number }>();
  assert.ok(row, "saveWorkout must have actually written a v2_workout_sessions row, not just returned 200");
});

test("v2 rollout uses stable percentage buckets and internal allow-list", () => {
  const rolloutEnv = { V2_DUAL_WRITE: "0", V2_COHORT_PERCENT: "10", V2_INTERNAL_USER_IDS: "42, 99" } as Env;
  assert.equal(v2CohortEnabled(rolloutEnv, 42), true);
  assert.equal(v2CohortEnabled(rolloutEnv, 99), true);
  assert.equal(v2CohortEnabled(rolloutEnv, 9), true);
  assert.equal(v2CohortEnabled(rolloutEnv, 11), false);
  assert.equal(v2CohortEnabled(rolloutEnv, 111), false);
});
