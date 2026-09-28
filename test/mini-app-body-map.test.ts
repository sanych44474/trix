import { test } from "node:test";
import assert from "node:assert/strict";
import { exerciseParts, PRIMARY_COLOR, recentExerciseNames, REGION_MUSCLES, regionOfMuscle, SECONDARY_COLOR, weekParts, ZONE_COLORS } from "../apps/mini-app/src/logic/bodyMap";
import { musclesForExercise } from "../apps/mini-app/src/logic/exerciseMuscles";

test("week view: each trained region is coloured by its zone; untrained ones stay base", () => {
  const parts = weekParts([
    { group: "chest", sets: 12, zone: "optimal" },
    { group: "arms", sets: 30, zone: "above" },
    { group: "core", sets: 0, zone: "below" },
    { group: "unknown", sets: 5, zone: "optimal" },
  ]);
  assert.deepEqual(parts.filter((p) => p.slug === "chest"), [{ slug: "chest", color: ZONE_COLORS.optimal }]);
  assert.ok(parts.filter((p) => ["biceps", "triceps", "forearm"].includes(p.slug)).every((p) => p.color === ZONE_COLORS.above));
  assert.ok(!parts.some((p) => p.slug === "abs"));
});

test("exercise view: primary movers strong, helpers light", () => {
  const parts = exerciseParts(musclesForExercise("Жим лежачи")!);
  assert.deepEqual(parts.find((p) => p.slug === "chest"), { slug: "chest", color: PRIMARY_COLOR });
  assert.deepEqual(parts.find((p) => p.slug === "triceps"), { slug: "triceps", color: SECONDARY_COLOR });
});

test("every figure muscle belongs to exactly one region, and tapping maps back", () => {
  const all = Object.values(REGION_MUSCLES).flat();
  assert.equal(new Set(all).size, all.length);
  assert.equal(regionOfMuscle("trapezius"), "back");
  assert.equal(regionOfMuscle("deltoids"), "shoulders");
  assert.equal(regionOfMuscle("head"), null);
});

test("recent exercise names: newest first, deduplicated, capped", () => {
  const names = recentExerciseNames([
    { date: "2026-09-20", ex: [{ n: "Жим лежачи" }, { n: "Тяга" }] },
    { date: "2026-09-27", ex: [{ n: "Присідання" }, { n: "жим лежачи " }] },
  ], 3);
  assert.deepEqual(names, ["Присідання", "жим лежачи", "Тяга"]);
});

test("exercise dropdown: plan days in weekday order, then recent extras, no duplicates", async () => {
  const { pickerGroups } = await import("../apps/mini-app/src/logic/bodyMap");
  const groups = pickerGroups(
    [
      { weekday: 5, muscleGroup: "Руки", exercises: [{ name: "Згинання рук на лаві Скотта" }, { name: "Розгинання на блоці" }] },
      { weekday: 1, muscleGroup: "Ноги", exercises: [{ name: "Присідання" }, { name: "Жим ногами" }] },
      { weekday: 3, muscleGroup: "Порожньо", exercises: [] },
    ],
    ["Присідання", "Біг", "згинання рук на лаві скотта"],
  );
  assert.deepEqual(groups.map((g) => [g.weekday, g.names]), [
    [1, ["Присідання", "Жим ногами"]],
    [5, ["Згинання рук на лаві Скотта", "Розгинання на блоці"]],
    [null, ["Біг"]],
  ]);
});
