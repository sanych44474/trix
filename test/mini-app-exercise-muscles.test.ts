import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

test("names the old rules missed or got wrong light up the right muscles", () => {
  // "у сторони" (not only "в сторони"), and Cyrillic word boundaries: \w and \b are ASCII-only in JS.
  assert.deepEqual(primary("Розведення гантелей у сторони"), ["deltoids"]);
  assert.deepEqual(primary("Махи гантелями в сторони"), ["deltoids"]);
  assert.deepEqual(primary("Розведення гантелей в сторони нахилившись"), ["deltoids", "upper-back"], "rear delts");
  assert.deepEqual(primary("Ягідний місток"), ["gluteal"]);
  assert.deepEqual(primary("Close-grip pull-down"), ["upper-back"], "not a close-grip bench");
  assert.deepEqual(primary("Glute Kickback"), ["gluteal"], "not a triceps kickback");
  assert.deepEqual(primary("Махи ногою назад на сідниці"), ["gluteal"], "not a lateral raise");
  assert.deepEqual(primary("Тяга блоку до обличчя"), ["deltoids", "upper-back"]);
  assert.deepEqual(primary("Розведення гантелей лежачи"), ["chest"]);
  assert.deepEqual(primary("Махи гантеллю"), ["gluteal", "hamstring"]);
  assert.deepEqual(primary("Seated Cable Rows"), ["upper-back"]);
  assert.deepEqual(primary("Cable Crossover"), ["chest"]);
  assert.deepEqual(primary("Зведення рук у кросовері"), ["chest"]);
  assert.deepEqual(primary("Front Dumbbell Raise"), ["deltoids"]);
  assert.deepEqual(primary("Decline Barbell Bench Press"), ["chest"]);
  assert.deepEqual(primary("Зворотні віджимання від лави"), ["triceps"]);
  assert.deepEqual(primary("Bench Dips"), ["triceps"]);
  assert.deepEqual(primary("Жим Арнольда"), ["deltoids"]);
  assert.deepEqual(primary("Ходьба фермера"), ["forearm"], "not a walk");
  assert.deepEqual(primary("Жим гантелей лежа"), ["chest"]);
  assert.deepEqual(primary("Обертання стегнами"), ["gluteal"]);
});

test("every exercise in the plan bank maps to some muscles", () => {
  const sql = readFileSync(new URL("../migrations/0017_plan_bank.sql", import.meta.url), "utf8");
  const names = [...new Set([...sql.matchAll(/"name":"([^"\\]+)/g)].map((m) => m[1]))];
  assert.ok(names.length > 50, "plan bank parsed");
  const missing = names.filter((name) => !musclesForExercise(name));
  assert.deepEqual(missing, []);
});
