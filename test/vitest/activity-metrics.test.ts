// GET /admin/metrics/activity's queries against real D1 (db.batch with SELECTs, UNION, julianday).
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { activityRaw } from "../../src/adapters/d1/activityMetrics";
import { buildActivityMetrics } from "../../src/domain/activityMetrics";

describe("activity metrics", () => {
  it("counts daily actives across sources, WAU/MAU, adoption, events and the most active users", async () => {
    const t = "2026-09-01T09:00:00.000Z";
    await env.DB.batch([
      env.DB.prepare("INSERT INTO v2_accounts (id, legacyUserId, chatId, role, status, createdAt, updatedAt) VALUES (901, 901, 901, 'solo', 'active', ?, ?), (902, 902, 902, 'solo', 'active', ?, ?)").bind(t, t, t, t),
      env.DB.prepare("INSERT INTO v2_profiles (accountId, lang, name, updatedAt) VALUES (901, 'uk', 'Ann', ?), (902, 'uk', 'Bo', ?)").bind(t, t),
      env.DB.prepare("INSERT INTO v2_workout_sessions (accountId, date, weekday, completed, createdAt, updatedAt) VALUES (901, '2026-09-28', 1, 1, ?, ?), (901, '2026-09-30', 3, 1, ?, ?)").bind(t, t, t, t),
      env.DB.prepare("INSERT INTO v2_water_logs (accountId, date, ml, createdAt) VALUES (902, '2026-09-30', 1500, ?), (901, '2026-09-30', 900, ?)").bind(t, t),
      env.DB.prepare("INSERT INTO v2_analytics_events (accountId, event, date, count) VALUES (902, 'menu:progress', '2026-09-29', 3)"),
    ]);
    const raw = await activityRaw(env.DB, "2026-09-01", "2026-09-24", "2026-09-01");
    const m = buildActivityMetrics(raw, "2026-09-30", 30);
    const day = (d: string) => m.daily.find((x) => x.date === d)!;
    expect(day("2026-09-30")).toMatchObject({ dau: 2, workouts: 1, workoutUsers: 1, waterUsers: 2 });
    expect(day("2026-09-29")).toMatchObject({ dau: 1, events: 3 });
    expect(day("2026-09-01").signups).toBeGreaterThanOrEqual(2);
    expect(m.summary.wau).toBeGreaterThanOrEqual(2);
    expect(m.adoption.find((a) => a.feature === "workouts")?.users).toBeGreaterThanOrEqual(1);
    expect(m.topEvents.find((e) => e.event === "menu:progress")).toMatchObject({ n: 3, users: 1 });
    expect(m.topUsers.find((u) => u.id === 901)).toMatchObject({ name: "Ann", workouts: 2, activeDays: 2, lastActive: "2026-09-30" });
  });
});
