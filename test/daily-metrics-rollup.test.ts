// Daily metrics rollup (roadmap item 4 / docs/slos.md §4) — no live Grafana wiring exists yet,
// so this only tests that the numbers landing in `daily_metrics` are actually correct: bounded
// day windows (not "since X through now"), retention cohort math, and the derived
// skipped-workout definition (planned weekday elapsed with no completed row).
import { test } from "node:test";
import assert from "node:assert/strict";
import { newDb } from "./harness";
import { getOrCreateUser } from "../src/adapters/d1/v2Users";
import { getDailyMetrics } from "../src/adapters/d1/v2DailyMetrics";
import { setActivePlan } from "../src/adapters/d1/v2Plans";
import { upsertWorkoutLog } from "../src/adapters/d1/v2Workouts";
import { rollupDailyMetrics } from "../src/dailyMetricsRollup";
import type { PlanDoc } from "../src/types";

async function setTimestamps(db: ReturnType<typeof newDb>, id: number, fields: { createdAt?: string; updatedAt?: string; lastSeenAt?: string; onboardedAt?: string }) {
  const { onboardedAt, ...accountFields } = fields;
  for (const [col, val] of Object.entries(accountFields)) {
    await db.prepare(`UPDATE v2_accounts SET ${col} = ? WHERE id = ?`).bind(val, id).run();
  }
  if (onboardedAt !== undefined) {
    await db.prepare(`UPDATE v2_onboarding SET onboardedAt = ? WHERE accountId = ?`).bind(onboardedAt, id).run();
  }
}

function plan(userId: number, weekday: number): PlanDoc {
  return {
    userId, active: true, status: "active",
    split: [{ weekday: weekday as PlanDoc["split"][number]["weekday"], muscleGroup: "Push", exercises: [{ name: "Bench", sets: "3x8", startWeight: "50", technique: "" }] }],
    nutrition: { calories: 2000, protein: 150, fats: 60, carbs: 200 },
    supplements: [], methodology: "", generatedAt: new Date(), schemaVersion: 1,
  };
}

async function metric(db: ReturnType<typeof newDb>, date: string, name: string): Promise<number | undefined> {
  const rows = await getDailyMetrics(db, date, date, name);
  return rows[0]?.value;
}

test("rollupDailyMetrics: dau counts only users active on the exact target day, not before or after", async () => {
  const db = newDb();
  await getOrCreateUser(db, 1, 1, "en", "InWindow");
  await getOrCreateUser(db, 2, 2, "en", "TooEarly");
  await getOrCreateUser(db, 3, 3, "en", "TooLate");
  await setTimestamps(db, 1, { updatedAt: "2026-06-10T12:00:00.000Z" });
  await setTimestamps(db, 2, { updatedAt: "2026-06-09T23:59:00.000Z" }); // day before
  await setTimestamps(db, 3, { updatedAt: "2026-06-11T00:00:00.000Z" }); // day after

  await rollupDailyMetrics(db, "2026-06-10");

  assert.equal(await metric(db, "2026-06-10", "dau"), 1);
});

test("rollupDailyMetrics: wau/mau widen the window but stay anchored on the target day, not 'through now'", async () => {
  const db = newDb();
  await getOrCreateUser(db, 1, 1, "en", "FiveDaysBack");
  await setTimestamps(db, 1, { updatedAt: "2026-06-05T12:00:00.000Z" }); // 5 days before target

  await rollupDailyMetrics(db, "2026-06-10");

  assert.equal(await metric(db, "2026-06-10", "dau"), 0); // not active ON the target day
  assert.equal(await metric(db, "2026-06-10", "wau"), 1); // within the trailing 7-day window
});

test("rollupDailyMetrics: new_users is bounded to exactly the target day", async () => {
  const db = newDb();
  await getOrCreateUser(db, 1, 1, "en", "Today");
  await getOrCreateUser(db, 2, 2, "en", "Yesterday");
  await setTimestamps(db, 1, { createdAt: "2026-06-10T08:00:00.000Z" });
  await setTimestamps(db, 2, { createdAt: "2026-06-09T08:00:00.000Z" });

  await rollupDailyMetrics(db, "2026-06-10");

  assert.equal(await metric(db, "2026-06-10", "new_users"), 1);
});

test("rollupDailyMetrics: retention_dN is the fraction of the N-days-back cohort seen again today", async () => {
  const db = newDb();
  // Cohort onboarded exactly 7 days before the target date.
  await getOrCreateUser(db, 1, 1, "en", "Retained");
  await getOrCreateUser(db, 2, 2, "en", "Churned");
  await setTimestamps(db, 1, { onboardedAt: "2026-06-03T09:00:00.000Z", lastSeenAt: "2026-06-10T09:00:00.000Z" });
  await setTimestamps(db, 2, { onboardedAt: "2026-06-03T09:00:00.000Z", lastSeenAt: "2026-06-05T09:00:00.000Z" }); // not seen on target day

  await rollupDailyMetrics(db, "2026-06-10");

  assert.equal(await metric(db, "2026-06-10", "retention_d7"), 0.5);
});

test("rollupDailyMetrics: an empty cohort writes no retention row at all (not a misleading 0)", async () => {
  const db = newDb();
  await getOrCreateUser(db, 1, 1, "en", "Solo"); // never onboarded -> onboardedAt stays null

  await rollupDailyMetrics(db, "2026-06-10");

  const rows = await getDailyMetrics(db, "2026-06-10", "2026-06-10");
  assert.equal(rows.some((r) => r.metric === "retention_d1"), false);
  assert.equal(rows.some((r) => r.metric === "retention_d7"), false);
  assert.equal(rows.some((r) => r.metric === "retention_d30"), false);
});

test("rollupDailyMetrics: skipped_workouts counts a planned weekday with no completed log, not an unplanned or logged one", async () => {
  const db = newDb();
  await getOrCreateUser(db, 1, 1, "en", "Skipped"); // plan trains Wed, no log
  await getOrCreateUser(db, 2, 2, "en", "Completed"); // plan trains Wed, has a completed log
  await getOrCreateUser(db, 3, 3, "en", "RestDay"); // plan doesn't train Wed at all
  const wednesday = "2026-06-10"; // isoWeekday("2026-06-10") == 3 (Wed)

  await setActivePlan(db, plan(1, 3));
  await setActivePlan(db, plan(2, 3));
  await setActivePlan(db, plan(3, 5)); // trains Friday, not this date

  await upsertWorkoutLog(db, 2, wednesday, 3 as never, [{ name: "Bench", setsDone: [{ weight: 50, reps: 8 }], skipped: false }] as never, true, "raw");

  await rollupDailyMetrics(db, wednesday);

  assert.equal(await metric(db, wednesday, "skipped_workouts"), 1); // only user 1
});

test("rollupDailyMetrics: ai_fallback_rate and error_rate are 0 (not NaN) on a day with zero AI calls", async () => {
  const db = newDb();
  await getOrCreateUser(db, 1, 1, "en", "Quiet");

  await rollupDailyMetrics(db, "2026-06-10");

  assert.equal(await metric(db, "2026-06-10", "ai_fallback_rate"), 0);
  assert.equal(await metric(db, "2026-06-10", "error_rate"), 0);
});

test("rollupDailyMetrics: re-running the same day upserts in place, not duplicate rows", async () => {
  const db = newDb();
  await getOrCreateUser(db, 1, 1, "en", "Ann");
  await setTimestamps(db, 1, { updatedAt: "2026-06-10T12:00:00.000Z" });

  await rollupDailyMetrics(db, "2026-06-10");
  await rollupDailyMetrics(db, "2026-06-10");

  const rows = await getDailyMetrics(db, "2026-06-10", "2026-06-10", "dau");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].value, 1);
});
