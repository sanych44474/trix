import { test } from "node:test";
import assert from "node:assert/strict";
import { autoBalanceSplit } from "../src/domain/planAutoBalance";
import { planBalance } from "../src/domain/muscleLoad";
import { planWeight } from "../src/bot/guidedLog";
import type { PlanDay } from "../src/types";

const day = (weekday: number, names: string[]): PlanDay => ({
  weekday: weekday as PlanDay["weekday"],
  muscleGroup: "x",
  exercises: names.map((name) => ({ name, sets: "4 × 8", startWeight: "40 kg", technique: "" })),
});

test("a push/legs-only plan gets back, biceps and hamstring work added, and is balanced afterwards", () => {
  const split = [
    day(1, ["Жим лежачи", "Жим під кутом", "Віджимання", "Розгинання рук на блоці"]),
    day(4, ["Присідання", "Жим ногами", "Розгинання ніг", "Планка"]),
  ];
  const { split: fixed, added } = autoBalanceSplit(split, "uk", 6);
  assert.deepEqual(added.map((a) => a.slug).sort(), ["biceps", "hamstring", "upper-back"]);
  assert.ok(fixed.find((d) => d.weekday === 4)!.exercises.some((e) => e.name === "Румунська тяга"), "hinge on the leg day");
  const left = planBalance(fixed);
  assert.ok(!left.some((i) => i.kind === "missing"), "no muscle left untrained");
  assert.ok(!left.some((i) => i.slug === "hamstring"), "one hinge fixes the legs");
  const rowSets = fixed.flatMap((d) => d.exercises).find((e) => e.name === "Тяга гантелі в нахилі")!.sets;
  assert.match(rowSets, /^5 ×/, "0 back vs 12 chest: the added row is bumped to 5 sets");
  assert.equal(split[0]!.exercises.length, 4, "the input is not mutated");
  const row = fixed.flatMap((d) => d.exercises).find((e) => e.name === "Тяга гантелі в нахилі")!;
  assert.equal(row.role, "accessory");
  assert.equal(row.canonicalName, "One-Arm Dumbbell Row");
  assert.equal(planWeight(row.startWeight), 0, "no number the logger would read as kg");
});

test("respects the per-day cap and leaves a balanced plan alone", () => {
  const full = [day(1, ["Жим лежачи", "Жим під кутом", "Віджимання", "Розгинання рук на блоці", "Присідання", "Жим ногами"])];
  assert.deepEqual(autoBalanceSplit(full, "en", 6).added, [], "every day full: nothing added");
  const balanced = [
    day(1, ["Жим лежачи", "Тяга штанги в нахилі", "Жим гантелей сидячи", "Згинання рук", "Французький жим"]),
    day(4, ["Присідання", "Румунська тяга", "Ягідний місток", "Планка"]),
  ];
  assert.deepEqual(autoBalanceSplit(balanced, "en", 6).added, []);
});

test("English plans get English names; a timed plank keeps its metric", () => {
  const { split } = autoBalanceSplit([
    day(1, ["Bench press", "Barbell row", "Overhead press", "Barbell curl", "Skull crusher"]),
    day(3, ["Squat", "Romanian deadlift", "Glute bridge", "Leg curl"]),
  ], "en", 6);
  const plank = split.flatMap((d) => d.exercises).find((e) => e.name === "Plank");
  assert.equal(plank?.metric, "time");
});
