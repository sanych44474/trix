import { test } from "node:test";
import assert from "node:assert/strict";
import { filterLibrary, parseLibrary } from "../apps/mini-app/src/logic/library";
import { FREE_EXERCISE_LIB } from "../apps/mini-app/src/data/freeExerciseLib";
import { FREE_EXERCISE_IDS } from "../apps/mini-app/src/data/freeExerciseIds";

const all = parseLibrary(FREE_EXERCISE_LIB);

test("library: one row per indexed exercise, every muscle a body-map slug", () => {
  assert.equal(all.length, FREE_EXERCISE_IDS.length);
  const slugs = new Set(["chest", "upper-back", "deltoids", "biceps", "triceps", "forearm", "abs", "obliques", "quadriceps", "hamstring", "gluteal", "calves", "adductors", "lower-back", "trapezius", "neck", "other"]);
  assert.deepEqual(all.filter((e) => !slugs.has(e.muscle)), []);
});

test("library filters: muscle + equipment, and Ukrainian words search English names", () => {
  const dumbbellChest = filterLibrary(all, { muscle: "chest", equipment: "dumbbell" });
  assert.ok(dumbbellChest.length > 3 && dumbbellChest.every((e) => e.muscle === "chest" && e.equipment === "dumbbell"));
  const squats = filterLibrary(all, { query: "присідання гантелі" });
  assert.ok(squats.some((e) => e.id === "Dumbbell_Squat"), squats.map((e) => e.id).join());
  assert.ok(filterLibrary(all, { query: "romanian" }).some((e) => e.id === "Romanian_Deadlift"));
  assert.equal(filterLibrary(all, { query: "zzzz" }).length, 0);
  const first = filterLibrary(all, { muscle: "biceps" })[0]!;
  assert.equal(first.level, "b", "beginner exercises first");
});
