// The two loaders behind nearly every screen cost a fixed, small number of D1 round trips.
// getActivePlan was three sequential queries (plan, days, exercises); workoutLogsSince was
// 1 + one per 100 sessions + one per 100 exercises, so it grew with the athlete's history
// (the dashboard's 84-day window took 5, the streak job's 120 days about 10).
import { test } from "node:test";
import assert from "node:assert/strict";
import { newDb } from "./harness";
import { getOrCreateUser } from "../src/adapters/d1/v2Users";
import { getActivePlan, setActivePlan } from "../src/adapters/d1/v2Plans";
import { upsertWorkoutLog, workoutLogsSince } from "../src/adapters/d1/v2Workouts";
import type { PlanDoc, Weekday } from "../src/types";

/** Counts round trips: each awaited statement (first/all/run) and each batch is one. */
function counting(db: ReturnType<typeof newDb>) {
  const stats = { trips: 0 };
  type S = Record<string, (...a: unknown[]) => unknown>;
  const wrap = (stmt: S): S => {
    for (const m of ["first", "all", "run"]) {
      const orig = stmt[m].bind(stmt);
      stmt[m] = (...a: unknown[]) => { stats.trips++; return orig(...a); };
    }
    const bind = stmt.bind.bind(stmt);
    stmt.bind = (...a: unknown[]) => wrap(bind(...a) as S);
    return stmt;
  };
  const prepare = db.prepare.bind(db);
  const batch = db.batch.bind(db);
  db.prepare = ((sql: string) => wrap(prepare(sql) as unknown as S)) as unknown as typeof db.prepare;
  // batch() runs statements through exec(), which is not counted: a batch is one trip.
  db.batch = (async (s: Parameters<typeof batch>[0]) => { stats.trips++; return batch(s); }) as typeof db.batch;
  return stats;
}

function plan(userId: number): PlanDoc {
  return {
    userId, active: true, status: "active",
    split: [1, 3, 5].map((weekday) => ({
      weekday: weekday as Weekday, muscleGroup: `Day ${weekday}`,
      exercises: [{ name: `Lift ${weekday}a`, sets: "3 × 8", startWeight: "50 kg", technique: "", metric: "reps" }, { name: `Lift ${weekday}b`, sets: "3 × 10", startWeight: "—", technique: "", metric: "reps" }],
    })),
    nutrition: { calories: 2200, protein: 160, fats: 70, carbs: 220 }, supplements: [], methodology: "", generatedAt: new Date("2026-01-01T00:00:00.000Z"), schemaVersion: 1,
  } as unknown as PlanDoc;
}

test("getActivePlan: one round trip, the same plan", async () => {
  const db = newDb();
  await getOrCreateUser(db, 1, 1, "en", "Ann");
  await setActivePlan(db, plan(1));
  const stats = counting(db);
  const got = await getActivePlan(db, 1);
  assert.equal(stats.trips, 1);
  assert.deepEqual(got?.split.map((d) => [d.weekday, d.exercises.map((e) => e.name)]), [[1, ["Lift 1a", "Lift 1b"]], [3, ["Lift 3a", "Lift 3b"]], [5, ["Lift 5a", "Lift 5b"]]]);
  assert.equal(await getActivePlan(db, 2), null, "no plan is still null");
});

test("workoutLogsSince: one round trip however long the history is, the same logs", async () => {
  const db = newDb();
  await getOrCreateUser(db, 1, 1, "en", "Ann");
  await getOrCreateUser(db, 2, 2, "en", "Bo");
  // 40 sessions x 6 exercises = 240 exercises: three id chunks under the old loader.
  for (let i = 0; i < 40; i++) {
    const date = new Date(Date.UTC(2026, 8, 1 + i)).toISOString().slice(0, 10);
    await upsertWorkoutLog(db, 1, date, 1, Array.from({ length: 6 }, (_, e) => ({ name: `Ex ${e}`, skipped: false, setsDone: [{ weight: 50 + i, reps: 8 }, { weight: 50 + i, reps: 7 }] })), true);
  }
  await upsertWorkoutLog(db, 2, "2026-09-20", 1, [{ name: "Other", skipped: false, setsDone: [{ weight: 1, reps: 1 }] }], true);
  const stats = counting(db);
  const logs = await workoutLogsSince(db, 1, "2026-09-11");
  assert.equal(stats.trips, 1);
  assert.equal(logs.length, 30);
  assert.ok(logs.every((l) => l.exercises.length === 6 && l.exercises.every((e) => e.setsDone.length === 2)));
  const day = logs.find((l) => l.date === "2026-09-11");
  assert.deepEqual(day?.exercises[5].setsDone, [{ weight: 60, reps: 8 }, { weight: 60, reps: 7 }]);
  assert.ok(logs.every((l) => l.exercises.every((e) => e.name !== "Other")), "another account's rows stay out");
  assert.deepEqual(await workoutLogsSince(db, 3, "2026-01-01"), []);
});
