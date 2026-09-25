// Mini App handler failures must reach the SAME sink the bot's failures do. The bot funnels
// everything through router.ts's onError -> recordError, which is what /ownerreport's "Errors"
// section and scheduler.ts's proactive "🚨 Error spike" alert read. The Mini App handlers used to
// catch to a bare console.error, so the primary UI could 500 for every user on every save while
// the owner report showed a clean zero.
import { test } from "node:test";
import assert from "node:assert/strict";
import { newDb } from "./harness";
import { handleV2Api } from "../src/webapp/v2Api";
import { getOrCreateUser } from "../src/adapters/d1/v2Users";
import { errorStatsSince } from "../src/adapters/d1/v2Admin";
import { apiFailure } from "../src/webapp/apiError";
import type { Env } from "../src/types";

const SINCE = "2000-01-01T00:00:00.000Z";

test("apiFailure records a handler exception where the owner report can see it", async () => {
  const db = newDb();
  await getOrCreateUser(db, 8101, 8101, "en", "Test");
  const env = { DB: db, ALLOW_DEBUG_USER: "1", TELEGRAM_BOT_TOKEN: "test" } as unknown as Env;

  const res = await apiFailure(env, "api_plan", new Error("boom"), { userId: 8101, action: "weight" });

  assert.equal(res.status, 500);
  assert.deepEqual(await res.json(), { error: "error" });

  const stats = await errorStatsSince(db, SINCE);
  const row = stats.find((s) => s.kind === "api_plan");
  assert.ok(row, `expected an api_plan row in the error sink, got ${JSON.stringify(stats)}`);
  assert.equal(row.errorType, "exception");
  assert.equal(row.n, 1);
});

test("apiFailure keeps surfaces distinguishable so the report says WHICH one is failing", async () => {
  const db = newDb();
  await getOrCreateUser(db, 8102, 8102, "en", "Test");
  const env = { DB: db, ALLOW_DEBUG_USER: "1", TELEGRAM_BOT_TOKEN: "test" } as unknown as Env;

  await apiFailure(env, "api_workout", new Error("a"), { userId: 8102 });
  await apiFailure(env, "api_workout", new Error("b"), { userId: 8102 });
  await apiFailure(env, "api_nutrition", new Error("c"), { userId: 8102 });

  const stats = await errorStatsSince(db, SINCE);
  assert.equal(stats.find((s) => s.kind === "api_workout")?.n, 2);
  assert.equal(stats.find((s) => s.kind === "api_nutrition")?.n, 1);
});

test("a failing v2 dashboard is recorded, not just logged", async () => {
  const db = newDb();
  const userId = 8103;
  await getOrCreateUser(db, userId, userId, "en", "Test");
  // Break the read the dashboard depends on, so the handler takes its catch path for real rather
  // than the test asserting against a stub.
  await db.prepare("DROP TABLE IF EXISTS v2_workout_sessions").run();
  const env = { DB: db, ALLOW_DEBUG_USER: "1", TELEGRAM_BOT_TOKEN: "test" } as unknown as Env; // no WORKER_URL -> debugUser bypass

  const request = new Request(`https://example.test/api/v2/dashboard?debugUser=${userId}`);
  const res = await handleV2Api(request, new URL(request.url), env);

  assert.equal(res.status, 503);
  const stats = await errorStatsSince(db, SINCE);
  assert.ok(
    stats.some((s) => s.kind === "v2_dashboard_failed"),
    `expected the dashboard failure in the error sink, got ${JSON.stringify(stats)}`,
  );
});
