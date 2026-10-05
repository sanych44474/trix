import { test } from "node:test";
import assert from "node:assert/strict";
import { knownByRules, musclesForExercise, registerLearnedMuscles, slugForCatalogMuscle } from "../src/domain/exerciseMuscles";
import { weeklyMuscleSets } from "../src/domain/muscleLoad";

test("a learned exercise counts on the body map; the rules still win", () => {
  const own = "Тяга Т-грифа з упором у грудь у клубі X";
  const before = knownByRules(own) ? musclesForExercise(own) : null;
  registerLearnedMuscles([{ name: "  ТЯГА Т-грифа з упором у грудь у клубі X ", primary: ["upper-back"], secondary: ["biceps", "nonsense"] }]);
  if (!before) assert.deepEqual(musclesForExercise(own), { primary: ["upper-back"], secondary: ["biceps"] });
  // Learned entries never override what the rules already know.
  registerLearnedMuscles([{ name: "Жим лежачи", primary: ["calves"] }]);
  assert.deepEqual(musclesForExercise("Жим лежачи")?.primary, ["chest"]);
  // An empty classification teaches nothing.
  registerLearnedMuscles([{ name: "zzz-unknown-move", primary: [] }]);
  assert.equal(musclesForExercise("zzz-unknown-move"), null);
});

test("learned exercises add sets to the weekly muscle map", () => {
  registerLearnedMuscles([{ name: "Станок Хаммер для спини", primary: ["upper-back"], secondary: [] }]);
  const week = weeklyMuscleSets([{ date: "2026-10-05", done: true, ex: [{ n: "Станок Хаммер для спини", s: 4 }] }], "2026-10-01");
  assert.equal(week.find((m) => m.slug === "upper-back")?.sets, 4);
});

test("catalog muscles map onto body-map muscles", () => {
  assert.equal(slugForCatalogMuscle("middle back"), "upper-back");
  assert.equal(slugForCatalogMuscle("Abdominals"), "abs");
  assert.equal(slugForCatalogMuscle("unknown"), null);
});
