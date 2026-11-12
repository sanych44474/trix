// Two retries that both find the same abandoned "processing" claim must not both take it over:
// each would run the handler, and a workout save or a meal would be applied twice.
import { test } from "node:test";
import assert from "node:assert/strict";
import { newDb } from "./harness";
import { getOrCreateUser } from "../src/adapters/d1/v2Users";
import { claimIdempotencyKey } from "../src/adapters/d1/v2Idempotency";

test("only one of two simultaneous retries takes over an abandoned claim", async () => {
  const db = newDb();
  await getOrCreateUser(db, 1, 10, "uk", "A");
  const stale = new Date(Date.now() - 5 * 60_000).toISOString();
  await db.prepare("INSERT INTO v2_idempotency (accountId, key, response, status, state, createdAt) VALUES (1, 'key-12345678', '{}', 0, 'processing', ?)").bind(stale).run();
  const results = await Promise.all([1, 2, 3].map(() => claimIdempotencyKey(db, 1, "key-12345678")));
  assert.equal(results.filter((r) => r.claimed).length, 1);
});
