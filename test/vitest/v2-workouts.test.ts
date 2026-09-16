// Domain 4 v2-native repo (src/adapters/d1/v2Workouts.ts) against REAL D1 (workerd) — the
// node:sqlite-backed node:test harness (test/v2-workouts.test.ts) can't promise db.batch()'s
// atomicity guarantees, nor its statement-execution-order semantics, match real D1.
// upsertWorkoutLog fans a single logical write out across v2_workout_sessions + N
// v2_workout_exercises + M v2_workout_sets rows (an upsert, then a re-select of the assigned id,
// then a chunked db.batch() for the exercise/set tree — see the file-header comment in
// v2Workouts.ts) and upsertStrengthRecord's read-then-write PR comparison depends on real
// SQLite row visibility across two separate statements against the same connection — neither is
// something the node:sqlite harness's synchronous exec loop is guaranteed to model faithfully.
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import type { LoggedExercise, Weekday } from "../../src/types";
import {
  countCompletedWorkouts,
  getWorkoutLog,
  listStrength,
  upsertStrengthRecord,
  upsertWorkoutLog,
} from "../../src/adapters/d1/v2Workouts";

// v2_workout_sessions.accountId / v2_strength_records.accountId FK to v2_accounts(id) -- real D1
// enforces it, so every account this file writes for must exist first. Same reasoning as
// test/vitest/v2-plans.test.ts's seedAccount.
async function seedAccount(id: number): Promise<void> {
  const now = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO v2_accounts (id, legacyUserId, chatId, role, status, createdAt, updatedAt) VALUES (?, ?, ?, 'solo', 'active', ?, ?)",
  ).bind(id, id, id, now, now).run();
}

function makeExercises(): LoggedExercise[] {
  return [
    { name: "Bench Press", skipped: false, rpe: 8, setsDone: [{ reps: 8, weight: 60, rpe: 7 }, { reps: 6, weight: 65, rpe: 9 }] },
    { name: "Row", skipped: false, setsDone: [{ reps: 0, weight: 0, meters: 500 }] },
  ];
}

describe("v2Workouts: upsertWorkoutLog — session row + its exercise/set rows all land together, correctly linked", () => {
  it("the session row, its exercise rows and their set rows all land after one call", async () => {
    await seedAccount(800);
    await upsertWorkoutLog(env.DB, 800, "2026-05-01", 5 as Weekday, makeExercises(), true, "solid session");

    const session = await env.DB.prepare("SELECT * FROM v2_workout_sessions WHERE accountId = ? AND date = ?").bind(800, "2026-05-01").first<{ id: number; completed: number }>();
    expect(session).not.toBeNull();
    expect(session!.completed).toBe(1);

    const exercises = await env.DB.prepare("SELECT name, position, metric FROM v2_workout_exercises WHERE sessionId = ? ORDER BY position").bind(session!.id).all();
    expect(exercises.results).toEqual([
      { name: "Bench Press", position: 0, metric: "reps" },
      { name: "Row", position: 1, metric: "distance" },
    ]);

    const benchId = (await env.DB.prepare("SELECT id FROM v2_workout_exercises WHERE sessionId = ? AND position = 0").bind(session!.id).first<{ id: number }>())!.id;
    const sets = await env.DB.prepare("SELECT weight, reps, rpe FROM v2_workout_sets WHERE exerciseId = ? ORDER BY position").bind(benchId).all();
    expect(sets.results).toEqual([
      { weight: 60, reps: 8, rpe: 7 },
      { weight: 65, reps: 6, rpe: 9 },
    ]);
  });

  it("round-trips through getWorkoutLog with per-set rpe intact", async () => {
    await seedAccount(801);
    await upsertWorkoutLog(env.DB, 801, "2026-05-02", 6 as Weekday, makeExercises(), true);
    const log = await getWorkoutLog(env.DB, 801, "2026-05-02");
    expect(log?.exercises[0].setsDone[1]).toEqual({ reps: 6, weight: 65, rpe: 9 });
    expect(log?.exercises[1].setsDone[0]).toEqual({ reps: 0, weight: 0, meters: 500 });
  });

  it("a second upsertWorkoutLog for the same (account, date) replaces the tree atomically, not accumulates it", async () => {
    await seedAccount(802);
    await upsertWorkoutLog(env.DB, 802, "2026-05-03", 1 as Weekday, makeExercises(), false);
    await upsertWorkoutLog(env.DB, 802, "2026-05-03", 2 as Weekday, [{ name: "Squat", skipped: false, setsDone: [{ reps: 5, weight: 120 }] }], true);

    const sessions = await env.DB.prepare("SELECT COUNT(*) AS c FROM v2_workout_sessions WHERE accountId = ? AND date = ?").bind(802, "2026-05-03").first<{ c: number }>();
    expect(sessions?.c).toBe(1); // upsert, not a duplicate row

    const log = await getWorkoutLog(env.DB, 802, "2026-05-03");
    expect(log?.exercises.length).toBe(1);
    expect(log?.exercises[0].name).toBe("Squat");
    expect(log?.completed).toBe(true);
  });

  it("countCompletedWorkouts sees the committed session row", async () => {
    await seedAccount(803);
    await upsertWorkoutLog(env.DB, 803, "2026-05-04", 3 as Weekday, [], true);
    await upsertWorkoutLog(env.DB, 803, "2026-05-05", 4 as Weekday, [], false);
    expect(await countCompletedWorkouts(env.DB, 803)).toBe(1);
  });
});

describe("v2Workouts: upsertStrengthRecord — read-then-write PR comparison against real D1 row visibility", () => {
  it("a heavier attempt after the first-ever record is correctly flagged a PR, with the previous best returned", async () => {
    await seedAccount(810);
    const first = await upsertStrengthRecord(env.DB, 810, "Deadlift", { metric: "reps", weight: 100, reps: 5 }, "2026-01-01");
    expect(first.isPR).toBe(false);

    const pr = await upsertStrengthRecord(env.DB, 810, "Deadlift", { metric: "reps", weight: 120, reps: 5 }, "2026-01-08");
    expect(pr.isPR).toBe(true);
    expect(pr.prevWeight).toBe(100);

    const [record] = await listStrength(env.DB, 810);
    expect(record.bestWeight).toBe(120);
    expect(record.history.length).toBe(2);
  });

  it("three sequential attempts for the same exercise serialize correctly (no lost update)", async () => {
    await seedAccount(811);
    await upsertStrengthRecord(env.DB, 811, "Squat", { metric: "reps", weight: 100, reps: 5 }, "2026-01-01");
    await upsertStrengthRecord(env.DB, 811, "Squat", { metric: "reps", weight: 105, reps: 5 }, "2026-01-08");
    await upsertStrengthRecord(env.DB, 811, "Squat", { metric: "reps", weight: 110, reps: 5 }, "2026-01-15");
    const [record] = await listStrength(env.DB, 811);
    expect(record.bestWeight).toBe(110);
    expect(record.history.length).toBe(3);
  });
});
