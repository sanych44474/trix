import { test } from "node:test";
import assert from "node:assert/strict";
import { buildActivityMetrics, type ActivityRaw } from "../src/domain/activityMetrics";

const empty: ActivityRaw = { perDay: [], dau: [], wau: 0, mau: 0, totalUsers: 0, adoption: [], topEvents: [], cohorts: [], topUsers: [] };

test("activity metrics: a zero-filled row per day of the window, oldest first", () => {
  const m = buildActivityMetrics(empty, "2026-09-30", 7);
  assert.deepEqual(m.daily.map((d) => d.date), ["2026-09-24", "2026-09-25", "2026-09-26", "2026-09-27", "2026-09-28", "2026-09-29", "2026-09-30"]);
  assert.ok(m.daily.every((d) => d.dau === 0 && d.workouts === 0));
  assert.equal(m.summary.stickinessPct, 0);
  assert.deepEqual(m.retention, []);
});

test("activity metrics: per-day kinds land in their columns; stickiness and adoption shares", () => {
  const m = buildActivityMetrics({
    ...empty,
    perDay: [
      { date: "2026-09-30", kind: "workouts", n: 5, users: 4 },
      { date: "2026-09-30", kind: "water", n: 3, users: 3 },
      { date: "2026-09-29", kind: "signups", n: 2, users: 2 },
      { date: "2026-08-01", kind: "workouts", n: 9, users: 9 }, // outside the window: ignored
    ],
    dau: Array.from({ length: 7 }, (_, i) => ({ date: `2026-09-${24 + i}`, users: 10 })),
    wau: 20, mau: 40, totalUsers: 80,
    adoption: [{ feature: "water", users: 8 }, { feature: "workouts", users: 20 }],
  }, "2026-09-30", 30);
  assert.deepEqual(m.daily.at(-1), { date: "2026-09-30", dau: 10, workouts: 5, workoutUsers: 4, nutritionUsers: 0, checkins: 0, waterUsers: 3, stepsUsers: 0, events: 0, signups: 0 });
  assert.equal(m.summary.avgDau7, 10);
  assert.equal(m.summary.stickinessPct, 25);
  assert.equal(m.summary.mauSharePct, 50);
  assert.equal(m.summary.signups7, 2);
  assert.deepEqual(m.adoption.map((a) => [a.feature, a.sharePct]), [["workouts", 25], ["water", 10]]);
});
