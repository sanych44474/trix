import { test } from "node:test";
import assert from "node:assert/strict";
import { musclesForExercise } from "../apps/mini-app/src/logic/exerciseMuscles";

const primary = (name: string) => musclesForExercise(name)?.primary;

test("the exercises from a real session map to the right primary muscles", () => {
  assert.deepEqual(primary("Згинання рук на лаві Скотта"), ["biceps"]);
  assert.deepEqual(primary("Згинання рук з гантелями почергово"), ["biceps"]);
  assert.deepEqual(primary("Розгинання на блоці"), ["triceps"]);
  assert.deepEqual(primary("Присідання зі штангою"), ["quadriceps", "gluteal"]);
  assert.deepEqual(primary("Румунська тяга"), ["hamstring", "gluteal"]);
  assert.deepEqual(primary("Станова тяга"), ["gluteal", "hamstring", "lower-back"]);
  assert.deepEqual(primary("Жим ногами"), ["quadriceps", "gluteal"]);
  assert.deepEqual(primary("Підйоми на носки стоячи"), ["calves"]);
  assert.deepEqual(primary("Тяга верхнього блоку"), ["upper-back"]);
  assert.deepEqual(primary("Тяга гантелі в нахилі"), ["upper-back"]);
});

test("specific patterns win over the general ones they overlap", () => {
  assert.deepEqual(primary("Жим лежачи"), ["chest"]);
  assert.deepEqual(primary("Французький жим лежачи"), ["triceps"], "not a bench press");
  assert.deepEqual(primary("Жим гантелей сидячи"), ["deltoids"]);
  assert.deepEqual(primary("Жим штанги під кутом"), ["chest", "deltoids"]);
  assert.deepEqual(primary("Згинання ніг лежачи"), ["hamstring"], "leg curl, not a biceps curl or a bench press");
  assert.deepEqual(primary("Rowing"), ["upper-back", "quadriceps"], "the cardio machine");
  assert.deepEqual(primary("Barbell Rowing"), ["upper-back"], "the back lift");
  assert.deepEqual(primary("Hammer Curl"), ["biceps", "forearm"]);
  assert.deepEqual(primary("Махи гирею"), ["gluteal", "hamstring"]);
  assert.deepEqual(primary("Lateral Raise"), ["deltoids"]);
  assert.deepEqual(primary("Farmer's walk"), ["forearm"]);
  assert.deepEqual(primary("Біг"), ["quadriceps", "calves", "hamstring"]);
});

test("secondary muscles never repeat a primary one; unknown names fall back or return null", () => {
  for (const name of ["Жим лежачи", "Присідання", "Pull-up", "Dips"]) {
    const m = musclesForExercise(name)!;
    assert.ok(m.secondary.every((s) => !m.primary.includes(s)), name);
  }
  assert.deepEqual(primary("Моя вправа на груди"), ["chest"]);
  assert.equal(musclesForExercise("Йога-потік"), null);
});
