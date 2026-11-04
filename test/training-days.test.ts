import { test } from "node:test";
import assert from "node:assert/strict";
import { dayTargets, isTrainingDay, trainingWeekdaysOf } from "../src/domain/trainingDays";
import { newDb } from "./harness";
import { getOrCreateUser, getUser, updateUser } from "../src/adapters/d1/v2Users";
import { setActivePlan } from "../src/adapters/d1/v2Plans";
import { handleNutritionApi } from "../src/webapp/nutritionApi";
import { localParts } from "../src/domain/localTime";
import type { Env, NutritionTargets, PlanDoc, UserDoc } from "../src/types";

const train: NutritionTargets = { calories: 2500, protein: 160, fats: 70, carbs: 300 };
const rest: NutritionTargets = { calories: 2100, protein: 160, fats: 70, carbs: 180 };

test("training days: the plan's days win over the profile's, the profile is the fallback", () => {
  const profile = { trainingWeekdays: [2, 4] };
  assert.deepEqual(trainingWeekdaysOf({ profile, plan: { split: [{ weekday: 5 }, { weekday: 1 }, { weekday: 1 }] } }), [1, 5]);
  assert.deepEqual(trainingWeekdaysOf({ profile, plan: { split: [] } }), [2, 4]);
  assert.deepEqual(trainingWeekdaysOf({ profile, plan: null }), [2, 4]);
  assert.deepEqual(trainingWeekdaysOf({ profile: {}, plan: null }), []);
  assert.equal(isTrainingDay({ profile, plan: { split: [{ weekday: 1 }] } }, 2), false);
});

test("day targets: rest-day macros only on a rest day and only when the plan has them", () => {
  const plan = { split: [{ weekday: 1 }], restDayNutrition: rest };
  assert.deepEqual(dayTargets({ profile: {}, plan, nutrition: train }, 1), { targets: train, isRestDay: false });
  assert.deepEqual(dayTargets({ profile: {}, plan, nutrition: train }, 2), { targets: rest, isRestDay: true });
  assert.deepEqual(dayTargets({ profile: {}, plan: { split: [{ weekday: 1 }] }, nutrition: train }, 2), { targets: train, isRestDay: false });
  assert.deepEqual(dayTargets({ profile: {}, plan: null, nutrition: null }, 2), { targets: null, isRestDay: false });
});

// The bug as a user met it: the Mini App profile save moved the training day off today, the plan
// still trains today. The reminder (plan-first) said "train today"; Fuel said "rest day".
test("Fuel agrees with the plan after the profile's weekdays change", async () => {
  const db = newDb();
  const { weekday } = localParts("UTC");
  const other = (weekday % 7) + 1;
  await getOrCreateUser(db, 31, 31, "en", "Ann");
  const u = (await getUser(db, 31)) as UserDoc;
  await updateUser(db, 31, { nutrition: train, profile: { ...u.profile, timezone: "UTC", trainingWeekdays: [other] } });
  await setActivePlan(db, {
    userId: 31, active: true, status: "active",
    split: [{ weekday, muscleGroup: "Push", exercises: [{ name: "Bench Press", sets: "3 × 8", startWeight: "60 kg", technique: "" }] }],
    nutrition: train, restDayNutrition: rest, supplements: [], methodology: "",
    generatedAt: new Date("2026-01-01T00:00:00.000Z"), schemaVersion: 1,
  } as unknown as PlanDoc);
  const env = { DB: db, ALLOW_DEBUG_USER: "1", TELEGRAM_BOT_TOKEN: "t" } as unknown as Env;
  const req = new Request("https://x.test/api/nutrition?debugUser=31");
  const body = await (await handleNutritionApi(req, new URL(req.url), env)).json() as { isRestDay: boolean; targets: NutritionTargets };
  assert.equal(body.isRestDay, false, "today is a plan day: training macros, as the reminder and the Today workout say");
  assert.equal(body.targets.carbs, train.carbs);
});
