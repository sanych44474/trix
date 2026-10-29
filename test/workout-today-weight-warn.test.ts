// The workout-today payload tells the logger, per exercise, the weight above which a typed set
// weight is an implausible jump over recent history (weightWarnAbove). Absent without history.
import { test } from "node:test";
import assert from "node:assert/strict";
import { newDb } from "./harness";
import { setActivePlan } from "../src/adapters/d1/v2Plans";
import { getOrCreateUser } from "../src/adapters/d1/v2Users";
import { buildWorkoutTodayPayload, saveWorkout } from "../src/webapp/workout";
import type { PlanDoc, UserDoc } from "../src/types";

const TODAY = "2026-07-10"; // an ISO Friday, weekday 5

function plan(userId: number, exercises: Array<{ name: string; sets: string; startWeight: string }>): PlanDoc {
  return {
    id: 1,
    userId,
    active: true,
    status: "active",
    split: [{ weekday: 5, muscleGroup: "Push", exercises: exercises.map((e) => ({ ...e, technique: "" })) }],
    nutrition: { calories: 2000, protein: 150, fats: 60, carbs: 200 },
    supplements: [],
    methodology: "",
    generatedAt: new Date(),
    schemaVersion: 1,
  } as unknown as PlanDoc;
}

test("workout-today: an exercise with two prior sessions carries weightWarnAbove and weightHistory", async () => {
  const db = newDb();
  const user = (await getOrCreateUser(db, 9201, 9201, "en", "Lifter")) as unknown as UserDoc;
  const env = { DB: db, TELEGRAM_BOT_TOKEN: "test" } as never;
  const sets = [{ reps: 8, weight: 80 }];
  await saveWorkout(env, user, [{ name: "Bench Press", sets }] as Parameters<typeof saveWorkout>[2], "2026-06-26");
  await saveWorkout(env, user, [{ name: "Bench Press", sets }] as Parameters<typeof saveWorkout>[2], "2026-07-03");
  await setActivePlan(db, plan(9201, [
    { name: "Bench Press", sets: "4 × 8", startWeight: "80 kg" },
    { name: "Lateral Raise", sets: "3 × 12", startWeight: "10 kg" },
  ]));

  const payload = await buildWorkoutTodayPayload(db, user, undefined, "test", TODAY);
  const bench = payload.exercises.find((e) => e.name === "Bench Press");
  assert.deepEqual(bench?.weightHistory, [80, 80]);
  assert.equal(bench?.weightWarnAbove, 120, "max(1.5 x 80, 80 + 20) = 120");
});

test("workout-today: no weightWarnAbove for an exercise without enough history", async () => {
  const db = newDb();
  const user = (await getOrCreateUser(db, 9202, 9202, "en", "Newbie")) as unknown as UserDoc;
  await setActivePlan(db, plan(9202, [{ name: "Lateral Raise", sets: "3 × 12", startWeight: "10 kg" }]));

  const payload = await buildWorkoutTodayPayload(db, user, undefined, "test", TODAY);
  assert.equal("weightWarnAbove" in (payload.exercises[0] ?? {}), false);
});
