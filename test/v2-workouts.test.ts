// Domain 4 (workout logs + strength/PR records) v2-native repo — src/adapters/d1/v2Workouts.ts.
// Exercises it against the same in-memory D1 harness the legacy repo tests use (test/harness.ts),
// which builds its schema from every migrations/*.sql file, including 0069/0070 (v2_workout_
// sessions/exercises/sets) and 0079 (v2_workout_sets.rpe + v2_strength_records).
import { test } from "node:test";
import assert from "node:assert/strict";
import { newDb } from "./harness";
import type { LoggedExercise, Weekday } from "../src/types";
import {
  countCompletedWorkouts,
  countCompletedWorkoutsBetween,
  countWorkoutsSince,
  getWorkoutLog,
  allWorkoutLogsSince,
  listStrength,
  recentWorkoutLogs,
  upsertStrengthRecord,
  upsertWorkoutLog,
  workoutLogsSince,
} from "../src/adapters/d1/v2Workouts";

// v2_workout_sessions.accountId / v2_strength_records.accountId FK to v2_accounts(id) -- real D1
// enforces it (unlike the node:sqlite harness in some configurations), so every account this
// file writes for must exist first. Same reasoning as test/v2-catalog.test.ts's seedAccount.
function seedAccount(db: ReturnType<typeof newDb>, id: number): void {
  const now = new Date().toISOString();
  db.prepare(
    "INSERT INTO v2_accounts (id, legacyUserId, chatId, role, status, createdAt, updatedAt) VALUES (?, ?, ?, 'solo', 'active', ?, ?)",
  ).bind(id, id, id, now, now).run();
}

function makeExercises(): LoggedExercise[] {
  return [
    {
      name: "Bench Press",
      skipped: false,
      rpe: 8,
      setsDone: [
        { reps: 8, weight: 60, rpe: 7 },
        { reps: 6, weight: 65, rpe: 9 },
      ],
    },
    {
      name: "Plank",
      skipped: false,
      setsDone: [{ reps: 0, weight: 0, seconds: 90 }],
    },
  ];
}

// ---------- upsertWorkoutLog / getWorkoutLog round-trip ----------

test("getWorkoutLog: missing session returns null", async () => {
  const db = newDb();
  seedAccount(db, 1);
  assert.equal(await getWorkoutLog(db, 1, "2026-01-01"), null);
});

test("upsertWorkoutLog / getWorkoutLog: full round-trip, including per-set rpe with no dedicated column before 0079", async () => {
  const db = newDb();
  seedAccount(db, 10);
  await upsertWorkoutLog(db, 10, "2026-01-05", 1 as Weekday, makeExercises(), true, "felt strong");
  const log = await getWorkoutLog(db, 10, "2026-01-05");
  assert.ok(log);
  assert.equal(log!.userId, 10);
  assert.equal(log!.date, "2026-01-05");
  assert.equal(log!.weekday, 1);
  assert.equal(log!.completed, true);
  assert.equal(log!.notes, "felt strong");
  assert.equal(log!.exercises.length, 2);
  assert.equal(log!.exercises[0].name, "Bench Press");
  assert.equal(log!.exercises[0].rpe, 8);
  assert.deepEqual(log!.exercises[0].setsDone, [
    { reps: 8, weight: 60, rpe: 7 },
    { reps: 6, weight: 65, rpe: 9 },
  ]);
  assert.deepEqual(log!.exercises[1].setsDone, [{ reps: 0, weight: 0, seconds: 90 }]);
});

test("upsertWorkoutLog: ON CONFLICT(accountId, date) replaces the exercise/set tree, not accumulates it", async () => {
  const db = newDb();
  seedAccount(db, 11);
  await upsertWorkoutLog(db, 11, "2026-02-01", 1 as Weekday, makeExercises(), false);
  await upsertWorkoutLog(db, 11, "2026-02-01", 3 as Weekday, [{ name: "Squat", skipped: false, setsDone: [{ reps: 5, weight: 100 }] }], true, "rewritten");
  const log = await getWorkoutLog(db, 11, "2026-02-01");
  assert.equal(log!.weekday, 3);
  assert.equal(log!.completed, true);
  assert.equal(log!.notes, "rewritten");
  assert.equal(log!.exercises.length, 1);
  assert.equal(log!.exercises[0].name, "Squat");
});

test("upsertWorkoutLog: empty exercises array (a planned rest/skip day) round-trips as an empty log", async () => {
  const db = newDb();
  seedAccount(db, 12);
  await upsertWorkoutLog(db, 12, "2026-02-02", 2 as Weekday, [], false);
  const log = await getWorkoutLog(db, 12, "2026-02-02");
  assert.equal(log!.completed, false);
  assert.deepEqual(log!.exercises, []);
});

// ---------- bulk readers ----------

test("allWorkoutLogsSince: all users, date >= cutoff, preserves per-session exercise fidelity", async () => {
  const db = newDb();
  seedAccount(db, 20);
  seedAccount(db, 21);
  await upsertWorkoutLog(db, 20, "2026-03-01", 1 as Weekday, makeExercises(), true);
  await upsertWorkoutLog(db, 21, "2026-03-02", 2 as Weekday, [], false);
  await upsertWorkoutLog(db, 20, "2026-02-01", 1 as Weekday, [], true); // before cutoff -- excluded

  const logs = await allWorkoutLogsSince(db, "2026-03-01");
  assert.equal(logs.length, 2);
  const byUser = new Map(logs.map((l) => [l.userId, l]));
  assert.equal(byUser.get(20)!.exercises.length, 2);
  assert.equal(byUser.get(21)!.exercises.length, 0);
});

test("recentWorkoutLogs: ordered by date desc, respects limit", async () => {
  const db = newDb();
  seedAccount(db, 30);
  await upsertWorkoutLog(db, 30, "2026-01-01", 1 as Weekday, [], true);
  await upsertWorkoutLog(db, 30, "2026-01-03", 3 as Weekday, [], true);
  await upsertWorkoutLog(db, 30, "2026-01-02", 2 as Weekday, [], true);
  const logs = await recentWorkoutLogs(db, 30, 2);
  assert.deepEqual(logs.map((l) => l.date), ["2026-01-03", "2026-01-02"]);
});

test("workoutLogsSince: scoped to one user, date >= cutoff", async () => {
  const db = newDb();
  seedAccount(db, 40);
  seedAccount(db, 41);
  await upsertWorkoutLog(db, 40, "2026-01-10", 1 as Weekday, [], true);
  await upsertWorkoutLog(db, 40, "2026-01-05", 1 as Weekday, [], true);
  await upsertWorkoutLog(db, 41, "2026-01-10", 1 as Weekday, [], true);
  const logs = await workoutLogsSince(db, 40, "2026-01-08");
  assert.deepEqual(logs.map((l) => l.date), ["2026-01-10"]);
});

// ---------- counters ----------

test("countWorkoutsSince / countCompletedWorkouts / countCompletedWorkoutsBetween", async () => {
  const db = newDb();
  seedAccount(db, 50);
  seedAccount(db, 51);
  await upsertWorkoutLog(db, 50, "2026-04-01", 1 as Weekday, [], true);
  await upsertWorkoutLog(db, 50, "2026-04-02", 2 as Weekday, [], false);
  await upsertWorkoutLog(db, 51, "2026-04-03", 3 as Weekday, [], true);

  assert.equal(await countWorkoutsSince(db, "2026-04-01"), 3);
  assert.equal(await countWorkoutsSince(db, "2026-04-02"), 2);
  assert.equal(await countCompletedWorkouts(db, 50), 1);
  assert.equal(await countCompletedWorkoutsBetween(db, "2026-04-01", "2026-04-03"), 1);
  assert.equal(await countCompletedWorkoutsBetween(db, "2026-04-01", "2026-04-04"), 2);
});

// ---------- strength records / PR detection ----------

test("upsertStrengthRecord: first-ever record is never a PR", async () => {
  const db = newDb();
  seedAccount(db, 60);
  const r = await upsertStrengthRecord(db, 60, "Deadlift", { metric: "reps", weight: 100, reps: 5 }, "2026-01-01");
  assert.equal(r.isPR, false);
  const records = await listStrength(db, 60);
  assert.equal(records.length, 1);
  assert.equal(records[0].bestWeight, 100);
  assert.equal(records[0].bestReps, 5);
  assert.equal(records[0].history.length, 1);
});

test("upsertStrengthRecord: reps-metric PR (heavier weight) vs. a worse attempt (no PR, best unchanged)", async () => {
  const db = newDb();
  seedAccount(db, 61);
  await upsertStrengthRecord(db, 61, "Squat", { metric: "reps", weight: 100, reps: 5 }, "2026-01-01");
  const pr = await upsertStrengthRecord(db, 61, "Squat", { metric: "reps", weight: 110, reps: 5 }, "2026-01-08", 9);
  assert.equal(pr.isPR, true);
  assert.equal(pr.prevWeight, 100);

  const worse = await upsertStrengthRecord(db, 61, "Squat", { metric: "reps", weight: 90, reps: 5 }, "2026-01-15");
  assert.equal(worse.isPR, false);

  const [record] = await listStrength(db, 61);
  assert.equal(record.bestWeight, 110); // unchanged by the worse attempt
  assert.equal(record.bestReps, 5);
  assert.equal(record.history.length, 3); // every attempt is logged, PR or not
});

test("upsertStrengthRecord: time-metric PR tracks bestSeconds independently of weight", async () => {
  const db = newDb();
  seedAccount(db, 62);
  await upsertStrengthRecord(db, 62, "Plank", { metric: "time", weight: 0, reps: 0, seconds: 60 }, "2026-01-01");
  const pr = await upsertStrengthRecord(db, 62, "Plank", { metric: "time", weight: 0, reps: 0, seconds: 90 }, "2026-01-08");
  assert.equal(pr.isPR, true);
  const [record] = await listStrength(db, 62);
  assert.equal(record.bestSeconds, 90);
  assert.equal(record.metric, "time");
});

test("upsertStrengthRecord: distance-metric PR tracks bestMeters", async () => {
  const db = newDb();
  seedAccount(db, 63);
  await upsertStrengthRecord(db, 63, "Row", { metric: "distance", weight: 0, reps: 0, meters: 500 }, "2026-01-01");
  const pr = await upsertStrengthRecord(db, 63, "Row", { metric: "distance", weight: 0, reps: 0, meters: 600 }, "2026-01-08");
  assert.equal(pr.isPR, true);
  const [record] = await listStrength(db, 63);
  assert.equal(record.bestMeters, 600);
});

test("listStrength: ordered by bestWeight desc, respects limit", async () => {
  const db = newDb();
  seedAccount(db, 70);
  await upsertStrengthRecord(db, 70, "A", { metric: "reps", weight: 50, reps: 10 }, "2026-01-01");
  await upsertStrengthRecord(db, 70, "B", { metric: "reps", weight: 150, reps: 3 }, "2026-01-01");
  await upsertStrengthRecord(db, 70, "C", { metric: "reps", weight: 100, reps: 5 }, "2026-01-01");
  const all = await listStrength(db, 70);
  assert.deepEqual(all.map((r) => r.exercise), ["B", "C", "A"]);
  const limited = await listStrength(db, 70, 2);
  assert.deepEqual(limited.map((r) => r.exercise), ["B", "C"]);
});
