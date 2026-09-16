// Domain 9 (owner/admin reporting, AI/error/analytics logging, notification outbox,
// daily-metrics rollup) against REAL D1 (workerd) -- the node:sqlite-backed node:test harness
// (test/v2-admin.test.ts) fakes db.batch() as a plain sequential `.run()` loop with no `results`,
// so it cannot exercise dashboardExtrasBatch (a db.batch() of three SELECTs + one aggregate
// SELECT) at all -- see the comment left in test/v2-admin.test.ts where that case was dropped.
// This file also spot-checks the FK-enforcing tables this domain's migration
// (0081_v2_admin_complete.sql) added/changed (v2_feedback, v2_rest_timers, v2_notifications),
// since real D1 enforces v2_accounts(id) FKs that the node:sqlite harness doesn't reliably model.
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { dashboardExtrasBatch } from "../../src/adapters/d1/v2Admin";
import { enqueueNotification } from "../../src/adapters/d1/v2Notifications";

async function seedAccount(id: number): Promise<void> {
  const now = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO v2_accounts (id, legacyUserId, chatId, role, status, createdAt, updatedAt) VALUES (?, ?, ?, 'solo', 'active', ?, ?)",
  ).bind(id, id, id, now, now).run();
}

describe("v2Admin: dashboardExtrasBatch — one db.batch() round trip, SELECTs included", () => {
  it("returns real counts/achievements/water/steps from a single batch, not empty results", async () => {
    await seedAccount(801);
    const now = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO v2_workout_sessions (accountId, date, weekday, completed, createdAt, updatedAt) VALUES (801, '2026-09-01', 2, 1, ?, ?)",
      ).bind(now, now),
      env.DB.prepare("INSERT INTO v2_achievements (accountId, code, earnedAt) VALUES (801, 'first_workout', ?)").bind(now),
      env.DB.prepare("INSERT INTO v2_step_logs (accountId, date, steps, createdAt) VALUES (801, '2026-09-01', 5000, ?)").bind(now),
      env.DB.prepare("INSERT INTO v2_water_logs (accountId, date, ml, createdAt) VALUES (801, '2026-09-01', 1500, ?)").bind(now),
    ]);

    const extras = await dashboardExtrasBatch(env.DB, 801, "2026-09-01");
    expect(extras.statCounts.workouts).toBe(1);
    expect(extras.statCounts.badges).toBe(1);
    expect(extras.achievements).toEqual(["first_workout"]);
    expect(extras.waterMl).toBe(1500);
    expect(extras.steps).toBe(5000);
  });

  it("an account with no activity gets all-zero/empty results, not a thrown error", async () => {
    await seedAccount(802);
    const extras = await dashboardExtrasBatch(env.DB, 802, "2026-09-01");
    expect(extras.statCounts).toEqual({ workouts: 0, nutrition: 0, checkins: 0, steps: 0, badges: 0 });
    expect(extras.achievements).toEqual([]);
    expect(extras.waterMl).toBe(0);
    expect(extras.steps).toBe(0);
  });
});

describe("v2Admin/v2Notifications: FK-enforced tables from migrations/0081", () => {
  it("v2_notifications.accountId FKs to v2_accounts -- a real account can enqueue", async () => {
    await seedAccount(803);
    const id = await enqueueNotification(env.DB, {
      userId: 803, chatId: 803, kind: "reminder", idempotencyKey: "k", payload: { text: "hi" },
    });
    expect(id).not.toBeNull();
    const row = await env.DB.prepare("SELECT accountId, chatId FROM v2_notifications WHERE id = ?").bind(id).first<{ accountId: number; chatId: number }>();
    expect(row?.accountId).toBe(803);
    expect(row?.chatId).toBe(803);
  });

  it("the rebuilt v2_notifications keeps the idempotency-key uniqueness scoped per account under real D1", async () => {
    await seedAccount(804);
    await seedAccount(805);
    const key = "2026-09-01:same templated text";
    const id1 = await enqueueNotification(env.DB, { userId: 804, chatId: 804, kind: "reminder", idempotencyKey: key, payload: { text: "hi" } });
    const id2 = await enqueueNotification(env.DB, { userId: 805, chatId: 805, kind: "reminder", idempotencyKey: key, payload: { text: "hi" } });
    expect(id1).not.toBeNull();
    expect(id2).not.toBeNull(); // must NOT collide across accounts
    const dup = await enqueueNotification(env.DB, { userId: 804, chatId: 804, kind: "reminder", idempotencyKey: key, payload: { text: "hi" } });
    expect(dup).toBeNull(); // same account + same key IS a real duplicate
  });
});
