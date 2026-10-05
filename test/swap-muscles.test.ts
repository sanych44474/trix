import { test } from "node:test";
import assert from "node:assert/strict";
import { catalogMusclesForExercise, muscleFromQuery } from "../src/domain/swapMuscles";

test("a triceps pushdown swaps within triceps, whatever the day's group", () => {
  assert.deepEqual(catalogMusclesForExercise("Розгинання рук на верхньому блоці з прямою ручкою"), ["triceps"]);
  assert.deepEqual(catalogMusclesForExercise("Жим гантелей з підлоги"), ["chest"]);
  assert.deepEqual(catalogMusclesForExercise("щось незрозуміле"), []);
});

test("a typed muscle name finds its group; an exercise name does not", () => {
  assert.equal(muscleFromQuery("трицепс")?.slug, "triceps");
  assert.equal(muscleFromQuery(" Біцепс ")?.slug, "biceps");
  assert.deepEqual(muscleFromQuery("спина")?.catalog, ["lats", "middle back"]);
  assert.equal(muscleFromQuery("glutes")?.slug, "gluteal");
  assert.equal(muscleFromQuery("Французький жим"), null);
  assert.equal(muscleFromQuery("жим на трицепс"), null);
});

test("swap options seen in the logger are all on the body map", async () => {
  const { musclesForExercise } = await import("../src/domain/exerciseMuscles");
  for (const n of ["Французький жим", "Вузький жим", "Кікбек", "Віджимання на брусах", "Згинання зі штангою", "Зворотні випади з TRX", "Скручування на прес із додатковою вагою"]) {
    assert.ok(musclesForExercise(n), n);
  }
});
