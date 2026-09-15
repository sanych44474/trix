import { test } from "node:test";
import assert from "node:assert/strict";
import { classifySendError, computeBackoffMs, MAX_DELIVERY_ATTEMPTS } from "../src/domain/notificationDelivery";

test("computeBackoffMs: doubles each attempt, capped at 1 hour", () => {
  assert.equal(computeBackoffMs(1), 60_000);
  assert.equal(computeBackoffMs(2), 120_000);
  assert.equal(computeBackoffMs(3), 240_000);
  assert.equal(computeBackoffMs(20), 3_600_000); // capped
});

test("classifySendError: 403 is always blocked, regardless of attempt count", () => {
  const outcome = classifySendError({ errorCode: 403 }, 0);
  assert.deepEqual(outcome, { kind: "blocked" });
});

test("classifySendError: 429 retries using Telegram's retry_after when it's the larger wait", () => {
  const outcome = classifySendError({ errorCode: 429, retryAfterSeconds: 120 }, 0);
  assert.equal(outcome.kind, "retry");
  if (outcome.kind === "retry") {
    const waitMs = outcome.nextAttemptAt.getTime() - Date.now();
    assert.ok(waitMs >= 119_000 && waitMs <= 121_000, `expected ~120s wait, got ${waitMs}ms`);
  }
});

test("classifySendError: 429 without retry_after falls back to a default wait", () => {
  const outcome = classifySendError({ errorCode: 429 }, 0);
  assert.equal(outcome.kind, "retry");
});

test("classifySendError: 429 becomes permanent_failure once attempts are exhausted", () => {
  const outcome = classifySendError({ errorCode: 429 }, MAX_DELIVERY_ATTEMPTS);
  assert.deepEqual(outcome, { kind: "permanent_failure" });
});

test("classifySendError: other 4xx (bad request) never retries", () => {
  const outcome = classifySendError({ errorCode: 400 }, 0);
  assert.deepEqual(outcome, { kind: "permanent_failure" });
});

test("classifySendError: a network/unknown error retries with backoff", () => {
  const outcome = classifySendError({}, 0);
  assert.equal(outcome.kind, "retry");
});

test("classifySendError: a network/unknown error becomes permanent_failure after MAX_DELIVERY_ATTEMPTS", () => {
  const outcome = classifySendError({}, MAX_DELIVERY_ATTEMPTS);
  assert.deepEqual(outcome, { kind: "permanent_failure" });
});
