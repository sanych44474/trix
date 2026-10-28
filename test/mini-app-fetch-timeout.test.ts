import { test } from "node:test";
import assert from "node:assert/strict";
import { isNetworkError, shouldRetry } from "../apps/mini-app/src/logic/offlineSaves";

// api.ts gives every request AbortSignal.timeout(): the rejection is a TimeoutError, not an HTTP
// error. It must count as "no network" so a timed-out workout save stays queued with its key.
function timeout(): Error {
  const err = new Error("The operation was aborted due to timeout");
  err.name = "TimeoutError";
  return err;
}

test("a request timeout is a network failure: the save stays queued and retryable", () => {
  assert.equal(isNetworkError(timeout()), true);
  assert.equal(shouldRetry(timeout()), true);
});
