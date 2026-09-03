import { test } from "node:test";
import assert from "node:assert/strict";
import { liftKeyOf, strengthStandard } from "../src/domain/standards";

test("liftKeyOf: matches the big lifts in EN and UK", () => {
  assert.equal(liftKeyOf("Barbell Bench Press"), "bench");
  assert.equal(liftKeyOf("Жим лежачи зі штангою"), "bench");
  assert.equal(liftKeyOf("Back Squat"), "squat");
  assert.equal(liftKeyOf("Присідання зі штангою"), "squat");
  assert.equal(liftKeyOf("Deadlift"), "deadlift");
  assert.equal(liftKeyOf("Станова тяга"), "deadlift");
  assert.equal(liftKeyOf("Overhead Press"), "ohp");
  assert.equal(liftKeyOf("Barbell Row"), "row");
});

test("liftKeyOf: excludes variations with different standards", () => {
  assert.equal(liftKeyOf("Front Squat"), null);
  assert.equal(liftKeyOf("Leg Press"), null);
  assert.equal(liftKeyOf("Жим ногами"), null);
  assert.equal(liftKeyOf("Incline Bench Press"), null);
  assert.equal(liftKeyOf("Romanian Deadlift"), null);
  assert.equal(liftKeyOf("Dumbbell Shoulder Press"), null);
  assert.equal(liftKeyOf("Cable Row"), null);
});

test("liftKeyOf: returns null for non-tracked exercises", () => {
  assert.equal(liftKeyOf("Bicep Curl"), null);
  assert.equal(liftKeyOf("Plank"), null);
});

test("strengthStandard: classifies a 100kg bench at 100kg bodyweight (male) as intermediate", () => {
  // e1RM 100 / bw 100 = ratio 1.0 → male bench intermediate entry is 1.0
  const r = strengthStandard("Bench Press", "male", 100, 100);
  assert.ok(r);
  assert.equal(r!.key, "bench");
  assert.equal(r!.level, "intermediate");
  assert.equal(r!.ratio, 1.0);
  assert.equal(r!.next, "advanced");
  assert.equal(r!.nextTargetKg, 150); // 1.5 × 100
});

test("strengthStandard: floors below the first threshold to beginner", () => {
  const r = strengthStandard("Squat", "male", 100, 40); // ratio 0.4 < 0.75 beginner entry
  assert.ok(r);
  assert.equal(r!.level, "beginner");
});

test("strengthStandard: elite has no next level", () => {
  const r = strengthStandard("Deadlift", "male", 100, 320); // 3.2 ≥ 3.0 elite
  assert.ok(r);
  assert.equal(r!.level, "elite");
  assert.equal(r!.next, undefined);
  assert.equal(r!.nextTargetKg, undefined);
});

test("strengthStandard: female thresholds are lower than male", () => {
  // 70kg bench at 70kg bodyweight (ratio 1.0): female elite entry is 1.4 → not elite; advanced entry 1.0 → advanced
  const f = strengthStandard("Bench Press", "female", 70, 70);
  assert.equal(f!.level, "advanced");
  // same ratio for male is only intermediate
  const m = strengthStandard("Bench Press", "male", 70, 70);
  assert.equal(m!.level, "intermediate");
});

test("strengthStandard: returns null on bad inputs or unknown lift", () => {
  assert.equal(strengthStandard("Bicep Curl", "male", 80, 40), null);
  assert.equal(strengthStandard("Bench Press", "male", 0, 100), null);
  assert.equal(strengthStandard("Bench Press", "male", 80, 0), null);
});
