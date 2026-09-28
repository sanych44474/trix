import { test } from "node:test";
import assert from "node:assert/strict";
import { exerciseImageUrls, makeImageMatcher, RULE_TARGETS } from "../apps/mini-app/src/logic/exerciseImages";
import { FREE_EXERCISE_DB_COMMIT, FREE_EXERCISE_IDS } from "../apps/mini-app/src/data/freeExerciseIds";

const match = makeImageMatcher(FREE_EXERCISE_IDS);
const id = (name: string, canonical?: string) => match(name, canonical)?.id;

test("every movement pattern points at an exercise that exists in the index", () => {
  const ids = new Set(FREE_EXERCISE_IDS);
  assert.deepEqual(RULE_TARGETS.filter((target) => !ids.has(target)), []);
});

test("English names match exactly, ignoring case, punctuation and plural s", () => {
  assert.deepEqual(match("Barbell Full Squat"), { id: "Barbell_Full_Squat", title: "Barbell Full Squat", exact: true });
  assert.equal(id("Pull-up"), "Pullups");
  assert.equal(id("seated cable rows"), "Seated_Cable_Rows");
  assert.equal(match("Жим штанги лежачи", "Barbell Bench Press - Medium Grip")?.exact, true, "the catalog name wins");
});

test("Ukrainian names go through the movement table, variants first", () => {
  assert.equal(id("Розведення гантелей у сторони"), "Side_Lateral_Raise");
  assert.equal(id("Розведення гантелей в сторони нахилившись"), "Reverse_Flyes");
  assert.equal(id("Розведення гантелей лежачи"), "Dumbbell_Flyes");
  assert.equal(id("Жим гантелей лежачи"), "Dumbbell_Bench_Press");
  assert.equal(id("Жим штанги лежачи"), "Barbell_Bench_Press_-_Medium_Grip");
  assert.equal(id("Румунська тяга"), "Romanian_Deadlift");
  assert.equal(id("Станова тяга"), "Barbell_Deadlift");
  assert.equal(id("Тяга гантелі однією рукою"), "One-Arm_Dumbbell_Row");
  assert.equal(id("Тяга верхнього блоку"), "Wide-Grip_Lat_Pulldown");
  assert.equal(id("Розгинання рук на блоці з канатною рукояткою"), "Triceps_Pushdown_-_Rope_Attachment", "not a curl");
  assert.equal(id("Згинання рук на лаві Скотта"), "Preacher_Curl");
  assert.equal(id("Ягідний місток"), "Barbell_Glute_Bridge");
  assert.equal(id("Болгарські спліт-присідання"), "Split_Squat_with_Dumbbells");
  assert.equal(id("Присідання зі штангою"), "Barbell_Squat");
  assert.equal(id("Махи гантеллю"), "One-Arm_Kettlebell_Swings", "a swing, not a raise");
  assert.equal(id("Ходьба фермера"), "Farmers_Walk");
  assert.equal(match("Планка")?.exact, false, "a pattern match is only a similar movement");
});

test("names with no fitting picture return null", () => {
  assert.equal(match("Обертання стегнами стоячи"), null);
  assert.equal(match("Йога-потік"), null);
});

test("image urls come from the pinned commit", () => {
  const [a, b] = exerciseImageUrls("Barbell_Full_Squat", FREE_EXERCISE_DB_COMMIT);
  assert.equal(a, `https://cdn.jsdelivr.net/gh/yuhonas/free-exercise-db@${FREE_EXERCISE_DB_COMMIT}/exercises/Barbell_Full_Squat/0.jpg`);
  assert.ok(b!.endsWith("/1.jpg"));
});
