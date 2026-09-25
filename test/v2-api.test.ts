import assert from "node:assert/strict";
import test from "node:test";
import { handleV2Api } from "../src/webapp/v2Api";
import { isV2Failure } from "../src/contracts/v2";
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
  const testEnv = { DB: db, ALLOW_DEBUG_USER: "1", TELEGRAM_BOT_TOKEN: "test" } as unknown as Env; // no WORKER_URL -> debugUser bypass live

  const request = new Request(`https://example.test/api/v2/workout/save?debugUser=${userId}`, {
    method: "POST",
    // Not "...-key-001": that literal tripped gitleaks' generic-api-key rule (entropy 3.50 vs its
    // 3.5 threshold) and red-failed the Secret scan workflow on every push after it landed.
    headers: { "Idempotency-Key": "regression-test-0001" },
    body: JSON.stringify({ entries: [{ name: "Bench Press", sets: [{ reps: 8, weight: 60 }] }] }),
  });
  const response = await handleV2Api(request, new URL(request.url), testEnv);
  const body = await response.json() as unknown;
  assert.equal(response.status, 200, `expected a real save to succeed, got ${response.status}: ${JSON.stringify(body)}`);

  const row = await db.prepare("SELECT id FROM v2_workout_sessions WHERE accountId = ?").bind(userId).first<{ id: number }>();
  assert.ok(row, "saveWorkout must have actually written a v2_workout_sessions row, not just returned 200");
});

// Skipping a rest in the app has to clear the SERVER row, not just the local countdown: that
// row is what the minute-cron turns into a Telegram "rest is over" push, so without a cancel
// route the user still got pinged ~a minute after abandoning the rest.
test("v2 workout rest: DELETE cancels the pending timer so the cron can't still push it", async () => {
  const db = newDb();
  const userId = 9002;
  await getOrCreateUser(db, userId, userId, "en", "Test");
  const testEnv = { DB: db, ALLOW_DEBUG_USER: "1", TELEGRAM_BOT_TOKEN: "test" } as unknown as Env;

  const start = new Request(`https://example.test/api/v2/workout/rest?debugUser=${userId}`, {
    method: "POST",
    body: JSON.stringify({ seconds: 90 }),
  });
  const started = await handleV2Api(start, new URL(start.url), testEnv);
  assert.equal(started.status, 200, `starting a rest should succeed: ${await started.clone().text()}`);
  const pending = await db.prepare("SELECT accountId FROM v2_rest_timers WHERE accountId = ?").bind(userId).first();
  assert.ok(pending, "POST /workout/rest must persist a pending timer row");

  const cancel = new Request(`https://example.test/api/v2/workout/rest?debugUser=${userId}`, { method: "DELETE" });
  const cancelled = await handleV2Api(cancel, new URL(cancel.url), testEnv);
  assert.equal(cancelled.status, 200, `cancelling a rest should succeed: ${await cancelled.clone().text()}`);
  const after = await db.prepare("SELECT accountId FROM v2_rest_timers WHERE accountId = ?").bind(userId).first();
  assert.equal(after, null, "DELETE /workout/rest must remove the row the cron would have pushed");

  // Cancelling with nothing pending is a no-op, not an error -- the client fires this on every
  // Stop tap without knowing whether a row exists.
  const again = new Request(`https://example.test/api/v2/workout/rest?debugUser=${userId}`, { method: "DELETE" });
  assert.equal((await handleV2Api(again, new URL(again.url), testEnv)).status, 200);
});
