// A tapped-again save must reach the server under the same Idempotency-Key, or the server cannot
// tell it from a new one and logs a slow meal twice.
import { test } from "node:test";
import assert from "node:assert/strict";
import { settleKey, stableKey } from "../apps/mini-app/src/api";

test("the same request keeps its key until it is answered", () => {
  const first = stableKey("/api/v2/nutrition", '{"a":1}');
  assert.equal(stableKey("/api/v2/nutrition", '{"a":1}'), first);
  assert.notEqual(stableKey("/api/v2/nutrition", '{"a":2}'), first);
  assert.notEqual(stableKey("/api/v2/log", '{"a":1}'), first);
});

test("a success frees the key, so the same meal logged later is a new one", () => {
  const first = stableKey("/p", "{}");
  settleKey("/p", "{}");
  assert.notEqual(stableKey("/p", "{}"), first);
});

test("a server error or timeout keeps the key; a refusal frees it", () => {
  const a = stableKey("/q", "{}");
  settleKey("/q", "{}", 503);
  assert.equal(stableKey("/q", "{}"), a);
  settleKey("/q", "{}", 409);
  assert.equal(stableKey("/q", "{}"), a);
  settleKey("/q", "{}", 400);
  assert.notEqual(stableKey("/q", "{}"), a);
});
