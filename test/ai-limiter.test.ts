// Atomic AI admission (src/ai/limiter.ts): a burst of parallel calls cannot overshoot the
// per-user window, the service has a daily ceiling, and old counters are pruned.
import { test } from "node:test";
import assert from "node:assert/strict";
import { newDb } from "./harness";
import { DAILY_CALLS, USER_CALLS_PER_WINDOW, USER_WINDOW_MS, admitAiCall, dayKey, pruneCounterStmts } from "../src/ai/limiter";

const NOW = Date.parse("2026-11-10T12:00:00Z");

test("per user: a burst of parallel calls admits exactly the window's cap", async () => {
  const db = newDb();
  const results = await Promise.all(Array.from({ length: USER_CALLS_PER_WINDOW + 7 }, () => admitAiCall(db, 1, NOW)));
  assert.equal(results.filter((r) => r === "ok").length, USER_CALLS_PER_WINDOW);
  assert.ok(results.slice(USER_CALLS_PER_WINDOW).every((r) => r === "user"));
  assert.equal(await admitAiCall(db, 2, NOW), "ok", "another user is not affected");
  assert.equal(await admitAiCall(db, 1, NOW + USER_WINDOW_MS), "ok", "the next window starts fresh");
});

test("whole service: past the daily ceiling every call is refused until the next UTC day", async () => {
  const db = newDb();
  db.dump("INSERT INTO v2_settings (key, value) VALUES (?, ?)", dayKey(NOW), String(DAILY_CALLS));
  assert.equal(await admitAiCall(db, 5, NOW), "global");
  assert.equal(await admitAiCall(db, null, NOW), "global", "system calls count too");
  assert.equal(await admitAiCall(db, 5, NOW + 24 * 3600_000), "ok");
});

test("a counter that cannot be written lets the call through", async () => {
  const broken = { prepare() { throw new Error("D1 down"); } } as unknown as Parameters<typeof admitAiCall>[0];
  assert.equal(await admitAiCall(broken, 1, NOW), "ok");
});

test("prune drops past windows and days, keeps the current ones", async () => {
  const db = newDb();
  await admitAiCall(db, 1, NOW - 2 * 24 * 3600_000);
  await admitAiCall(db, 1, NOW);
  await db.batch(pruneCounterStmts(db, NOW));
  const keys = db.dump<{ key: string }>("SELECT key FROM v2_settings WHERE key LIKE 'ai_%' ORDER BY key").map((r) => r.key);
  assert.equal(keys.length, 2);
  assert.ok(keys.every((k) => k.includes("2026-11-10") || k.startsWith("ai_rl:") ), keys.join(","));
});
