// The in-session swap list (GET /api/v2/workout/swap -> workoutSwapAlternatives) leaves out
// exercises that load an active injury directly, the same rule the plan editor refuses
// (domain/safety.ts). Before, a client with a knee injury swapping leg press could be offered lunges.
import { test } from "node:test";
import assert from "node:assert/strict";
import { newDb } from "./harness";
import { getOrCreateUser, getUser } from "../src/adapters/d1/v2Users";
import { upsertExercise } from "../src/adapters/d1/v2Catalog";
import { createInjury } from "../src/adapters/d1/v2Tracking";
import { workoutSwapAlternatives } from "../src/webapp/workout";
import type { UserDoc } from "../src/types";

async function setup() {
  const db = newDb();
  await getOrCreateUser(db, 1, 1, "en", "Ann");
  for (const [id, name] of [["lunge", "Walking Lunge"], ["squat", "Goblet Squat"], ["leg-ext", "Leg Extension"], ["sissy", "Wall Sit Hold"], ["adductor", "Spanish Squat Hold"]]) {
    await upsertExercise(db, { id, name, muscle: "quadriceps", equipments: ["body only"], instructions: "", safetyInfo: "" });
  }
  return db;
}

test("swap list: with an active knee injury, squats, lunges and leg extensions are not offered", async () => {
  const db = await setup();
  await createInjury(db, { userId: 1, area: "knee", severity: "mild", checkAfter: "2099-01-01", swaps: [] });
  const user = (await getUser(db, 1)) as UserDoc;
  for (let i = 0; i < 5; i++) {
    const r = await workoutSwapAlternatives(db, user, null, 0, "Leg Press", "quads");
    const names = (r?.alternatives ?? []).map((a) => a.name);
    assert.ok(names.every((n) => !/squat|lunge|extension/i.test(n)), names.join(", "));
    assert.deepEqual(names, ["Wall Sit Hold"]);
  }
});

test("swap list: without an injury the same candidates are all offered", async () => {
  const db = await setup();
  const user = (await getUser(db, 1)) as UserDoc;
  const r = await workoutSwapAlternatives(db, user, null, 0, "Leg Press", "quads");
  assert.equal(r?.alternatives.length, 5);
});

test("swap list: an exercise that is not in today's plan is looked up by its own name, not by today's slot", async () => {
  // Tuesday is chest day; the athlete back-fills Monday's legs and swaps "Squat" at index 0.
  const db = await setup();
  const { upsertExercise: add } = await import("../src/adapters/d1/v2Catalog");
  await add(db, { id: "fly", name: "Cable Fly", muscle: "chest", equipments: ["cable"], instructions: "", safetyInfo: "" });
  const { setActivePlan } = await import("../src/adapters/d1/v2Plans");
  const { localParts } = await import("../src/domain/localTime");
  const user = (await getUser(db, 1)) as UserDoc;
  const weekday = localParts(user.profile.timezone).weekday;
  await setActivePlan(db, { userId: 1, active: true, status: "active", split: [{ weekday, muscleGroup: "Chest", exercises: [{ name: "Bench Press", sets: "3 × 8", startWeight: "60 kg", technique: "", metric: "reps", muscles: "chest" }] }], nutrition: { calories: 2000, protein: 150, fats: 60, carbs: 200 }, supplements: [], methodology: "", generatedAt: new Date(), schemaVersion: 1 } as never);
  const { getActivePlan } = await import("../src/adapters/d1/v2Plans");
  const r = await workoutSwapAlternatives(db, user, await getActivePlan(db, 1), 0, "Squat");
  const names = (r?.alternatives ?? []).map((a) => a.name);
  assert.ok(names.length > 0 && !names.includes("Cable Fly"), `quad alternatives, got: ${names.join(", ")}`);
});
