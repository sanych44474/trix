// Injury rules match the movement in an exercise's name. These names were matched by accident
// (a keyword inside another word, or a rule too broad), which swapped or refused exercises that do
// not load the injury; Russian names were not matched at all.
import { test } from "node:test";
import assert from "node:assert/strict";
import { conflictScore, isSafeCandidate, type InjuryArea } from "../src/domain/injury";

const score = (name: string, area: InjuryArea, extra: { movementPattern?: string } = {}) => conflictScore({ name, ...extra }, area);

test("elbow and wrist: leg curls and leg isolation work are not arm work", () => {
  for (const area of ["elbow", "wrist"] as const) {
    assert.equal(score("Lying Leg Curl", area), "none", area);
    assert.equal(score("Nordic curl", area), "none", area);
  }
  assert.equal(score("Leg Extension", "elbow", { movementPattern: "isolation" }), "none");
  assert.equal(score("Calf Raise", "elbow", { movementPattern: "isolation" }), "none");
  assert.equal(isSafeCandidate({ name: "Lying Leg Curl", muscle: "hamstrings" }, "elbow"), true);
  assert.equal(score("Barbell Curl", "elbow"), "direct", "arm curls still conflict");
  assert.equal(score("Wrist Curl", "wrist"), "direct");
});

test("keywords no longer match inside unrelated words", () => {
  assert.equal(score("Crunch", "ankle"), "none");
  assert.equal(score("Trunk rotation", "ankle"), "none");
  assert.equal(score("Box breathing", "ankle"), "none");
  assert.equal(score("Розведення ніг у тренажері", "shoulder"), "none");
  assert.equal(score("Seated calf press", "shoulder"), "none");
  assert.equal(score("Жим платформи ногами", "shoulder"), "none");
  assert.equal(score("Hip dip", "shoulder"), "none");
  assert.equal(score("Жим штанги на нахиленій лаві", "lower_back"), "none");
  assert.equal(score("Arrow push-up", "lower_back"), "none");
});

test("the real conflicts those keywords are for still match", () => {
  assert.equal(score("Treadmill run", "ankle"), "direct");
  assert.equal(score("Box jump", "ankle"), "direct");
  assert.equal(score("Розведення гантелей в сторони", "shoulder"), "direct");
  assert.equal(score("Overhead Press", "shoulder"), "direct");
  assert.equal(score("Dips", "shoulder"), "direct");
  assert.equal(score("Нахили зі штангою", "lower_back"), "direct");
  assert.equal(score("Barbell Row", "lower_back"), "related");
});

test("Russian exercise names are matched", () => {
  assert.equal(score("Приседания со штангой", "knee"), "direct");
  assert.equal(score("Выпады", "knee"), "direct");
  assert.equal(score("Прыжки на тумбу", "ankle"), "direct");
  assert.equal(score("Бег на дорожке", "ankle"), "direct");
  assert.equal(score("Приседания", "hip"), "direct");
  assert.equal(score("Становая тяга", "lower_back"), "direct");
  assert.equal(score("Сгибание рук со штангой", "elbow"), "direct");
});
