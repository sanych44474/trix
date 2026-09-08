// obProgress()'s checks array must mirror obSteps()'s order/count exactly (see its own comment
// in src/bot/onboarding.ts) — a manual sync point with no compiler enforcement, so a drift here
// is a real regression risk. This guards it directly instead of relying on eyeballing the diff.
import { test } from "node:test";
import assert from "node:assert/strict";
import { obProgress, obSteps } from "../src/bot/onboarding";
import type { UserProfile } from "../src/types";

const FULL_PROFILE: UserProfile = {
  sex: "male",
  age: 30,
  heightCm: 180,
  weightKg: 80,
  goal: "muscle gain",
  level: "intermediate",
  baselineLifts: "bench 60kg, squat 80kg, deadlift 100kg",
  trainingWeekdays: [1, 3, 5],
  sessionMinutes: 60,
  equipment: "full gym",
  lifestyle: "moderate",
  sleepSchedule: "morning",
  dietPrefs: "none",
  limitations: "none",
};

test("obProgress: check count matches obSteps() length", () => {
  const steps = obSteps("en");
  const { total } = obProgress(FULL_PROFILE);
  assert.equal(total, steps.length);
});

test("obProgress: a fully answered profile reports answered === total", () => {
  const { answered, total } = obProgress(FULL_PROFILE);
  assert.equal(answered, total);
});

test("obProgress: missing the new baselineLifts/sessionMinutes fields is detected", () => {
  const withoutBaseline = { ...FULL_PROFILE, baselineLifts: undefined };
  assert.equal(obProgress(withoutBaseline).answered, obProgress(FULL_PROFILE).answered - 1);
  const withoutDuration = { ...FULL_PROFILE, sessionMinutes: undefined };
  assert.equal(obProgress(withoutDuration).answered, obProgress(FULL_PROFILE).answered - 1);
});
