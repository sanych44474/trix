// Daily-habit reads for the apps: wellbeing averages/trend (the bot's /well numbers), the evening
// survey checklist, and the plan's difficulty action's guard. Route tests go through the handler
// directly with the debugUser bypass, as the other webapp tests do.
import { test } from "node:test";
import assert from "node:assert/strict";
import { newDb } from "./harness";
import { getOrCreateUser, updateUser } from "../src/adapters/d1/v2Users";
import { recordDailyCheckin, upsertStepLog } from "../src/adapters/d1/v2Tracking";
import { handleDailyApi } from "../src/webapp/dailyApi";
import { handlePlanApi } from "../src/webapp/planApi";
import { wellbeingAverages, wellbeingTrend } from "../src/domain/wellbeing";
import type { DailyCheckinDoc } from "../src/types";

const env = (db: ReturnType<typeof newDb>) => ({ DB: db, ALLOW_DEBUG_USER: "1", TELEGRAM_BOT_TOKEN: "t" }) as never;

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
}

async function user(db: ReturnType<typeof newDb>, id: number, remindersOff?: string[]) {
  await getOrCreateUser(db, id, id, "en", `U${id}`);
  await updateUser(db, id, { onboarded: true, ...(remindersOff ? { profile: { remindersOff } as never } : {}) });
}

function checkin(energy: number, sleep: number, stress: number, date = daysAgo(0)): DailyCheckinDoc {
  return { userId: 1, date, energy, sleep, stress, createdAt: new Date() };
}

async function get(db: ReturnType<typeof newDb>, id: number, path: string, init?: RequestInit) {
  const url = new URL(`https://x${path}${path.includes("?") ? "&" : "?"}debugUser=${id}`);
  return handleDailyApi(new Request(url, init), url, env(db));
}

test("wellbeing averages and trend are the bot's numbers", () => {
  assert.equal(wellbeingAverages([checkin(3, 3, 3)]), null, "under two check-ins there is no average");
  const set = [checkin(1, 2, 4), checkin(2, 2, 4), checkin(4, 4, 2), checkin(5, 4, 2)];
  const avg = wellbeingAverages(set);
  assert.deepEqual(avg, { energy: 3, sleep: 3, stress: 3 });
  // First half vs second half: energy rose by 3, sleep by 2, stress fell by 2.
  assert.deepEqual(wellbeingTrend(set), { energy: 3, sleep: 2, stress: -2 });
});

test("GET /api/wellbeing: averages, trend and count over the 90-day window", async () => {
  const db = newDb();
  await user(db, 1);
  await recordDailyCheckin(db, 1, daysAgo(3), 1, 2, 4);
  await recordDailyCheckin(db, 1, daysAgo(2), 2, 2, 4);
  await recordDailyCheckin(db, 1, daysAgo(1), 4, 4, 2);
  await recordDailyCheckin(db, 1, daysAgo(0), 5, 4, 2);
  await recordDailyCheckin(db, 1, daysAgo(120), 1, 1, 5); // outside the window
  const body = (await (await get(db, 1, "/api/wellbeing")).json()) as {
    count: number; averages: Record<string, number>; trend: Record<string, number>;
  };
  assert.equal(body.count, 4);
  assert.deepEqual(body.averages, { energy: 3, sleep: 3, stress: 3 });
  assert.deepEqual(body.trend, { energy: 3, sleep: 2, stress: -2 });
});

test("GET /api/wellbeing: one check-in gives no averages", async () => {
  const db = newDb();
  await user(db, 2);
  await recordDailyCheckin(db, 2, daysAgo(0), 3, 3, 3);
  const body = (await (await get(db, 2, "/api/wellbeing")).json()) as { count: number; averages: unknown; trend: unknown };
  assert.deepEqual(body, { count: 1, averages: null, trend: null });
});

test("GET /api/survey: lists today's unlogged items and drops them as they are logged", async () => {
  const db = newDb();
  await user(db, 3, ["water"]);
  const first = (await (await get(db, 3, "/api/survey")).json()) as { items: Array<{ key: string; label: string }> };
  assert.deepEqual(first.items.map((i) => i.key), ["food", "steps", "checkin"], "water is switched off in reminders");
  assert.ok(first.items.every((i) => i.label.length > 0));

  const today = new Date().toISOString().slice(0, 10);
  await upsertStepLog(db, 3, today, 4000);
  await recordDailyCheckin(db, 3, today, 3, 3, 3);
  const second = (await (await get(db, 3, "/api/survey")).json()) as { items: Array<{ key: string }> };
  assert.deepEqual(second.items.map((i) => i.key), ["food"]);
});

test("routes refuse anonymous calls and other methods", async () => {
  const db = newDb();
  await user(db, 4);
  const anon = await handleDailyApi(new Request("https://x/api/wellbeing"), new URL("https://x/api/wellbeing"), env(db));
  assert.equal(anon.status, 401);
  const post = await get(db, 4, "/api/wellbeing", { method: "POST" });
  assert.equal(post.status, 405);
});

test("POST /api/plan difficulty: without an active plan there is nothing to step", async () => {
  const db = newDb();
  await user(db, 5);
  const url = new URL("https://x/api/plan?debugUser=5");
  const res = await handlePlanApi(
    new Request(url, { method: "POST", body: JSON.stringify({ action: "difficulty", weekday: 1, dir: "up" }), headers: { "content-type": "application/json" } }),
    url,
    env(db),
  );
  assert.equal(res.status, 404);
  assert.deepEqual(await res.json(), { error: "no_plan", code: "not_found", retryable: false });
});
