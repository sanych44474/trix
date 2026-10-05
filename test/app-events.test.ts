import { test } from "node:test";
import assert from "node:assert/strict";
import { newDb } from "./harness";
import { getOrCreateUser } from "../src/adapters/d1/v2Users";
import { bumpEvent } from "../src/adapters/d1/v2Admin";
import { orEngagement } from "../src/bot/ownerReport";
import { APP_EVENT_RE } from "../src/webapp/miscApi";
import { targetUse } from "../apps/mini-app/src/logic/logger";

test("app event names: only the app_* allowlist shape", () => {
  assert.ok(APP_EVENT_RE.test("app_coach_action_weight"));
  for (const bad of ["coach_ask", "app_", "app_DROP TABLE", "app_" + "x".repeat(50)]) assert.ok(!APP_EVENT_RE.test(bad), bad);
});

test("owner events report lists Mini App features in their own block", async () => {
  const db = newDb();
  await getOrCreateUser(db, 3, 3, "uk", "Ann");
  const today = new Date().toISOString().slice(0, 10);
  await bumpEvent(db, 3, "app_coach_ask", today);
  await bumpEvent(db, 3, "app_coach_ask", today);
  await bumpEvent(db, 3, "menu:coach", today);
  const text = await orEngagement(db);
  assert.match(text, /Mini App features/);
  assert.match(text, /coach_ask/);
});

test("targetUse: kept when every filled set used the target weight", () => {
  const ex = (w: number, sets: Array<[number, number]>) => ({ index: 0, name: "x", metric: "reps", sets: 3, target: { w, r: 8, lastW: w, lastR: 8, step: "reps" }, setsDone: sets.map(([weight, reps]) => ({ weight, reps })) });
  assert.deepEqual(targetUse([ex(60, [[60, 8], [60, 8]]), ex(40, [[42.5, 8]]), ex(20, [])] as never), { kept: 1, edited: 1 });
});
