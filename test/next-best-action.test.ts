import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveNextBestAction, type NextBestActionInput } from "../src/domain/nextBestAction";

function baseInput(overrides: Partial<NextBestActionInput> = {}): NextBestActionInput {
  return {
    totalCompletedWorkouts: 5,
    todayPending: false,
    missedLapse: false,
    checkedInToday: true,
    completedWorkoutToday: false,
    loggedNutritionToday: false,
    ...overrides,
  };
}

test("resolveNextBestAction: zero completed workouts ever always wins (first_workout)", () => {
  const action = resolveNextBestAction(baseInput({
    totalCompletedWorkouts: 0,
    todayPending: true, // would otherwise resolve to today_workout
    missedLapse: true,
    checkedInToday: false,
  }));
  assert.deepEqual(action, { kind: "first_workout" });
});

test("resolveNextBestAction: today's pending session beats recovery/checkin/nutrition", () => {
  const action = resolveNextBestAction(baseInput({
    todayPending: true,
    missedLapse: true,
    checkedInToday: false,
  }));
  assert.deepEqual(action, { kind: "today_workout" });
});

test("resolveNextBestAction: a lapse beats check-in and nutrition when today isn't pending", () => {
  const action = resolveNextBestAction(baseInput({
    missedLapse: true,
    checkedInToday: false,
  }));
  assert.deepEqual(action, { kind: "recovery" });
});

test("resolveNextBestAction: check-in beats post-workout nutrition", () => {
  const action = resolveNextBestAction(baseInput({
    checkedInToday: false,
    completedWorkoutToday: true,
    loggedNutritionToday: false,
  }));
  assert.deepEqual(action, { kind: "checkin" });
});

test("resolveNextBestAction: trained today + no nutrition logged -> post_workout_nutrition", () => {
  const action = resolveNextBestAction(baseInput({
    checkedInToday: true,
    completedWorkoutToday: true,
    loggedNutritionToday: false,
  }));
  assert.deepEqual(action, { kind: "post_workout_nutrition" });
});

test("resolveNextBestAction: nothing urgent -> rest", () => {
  const action = resolveNextBestAction(baseInput());
  assert.deepEqual(action, { kind: "rest" });
});

test("resolveNextBestAction: trained today but nutrition already logged -> rest, not nutrition", () => {
  const action = resolveNextBestAction(baseInput({
    completedWorkoutToday: true,
    loggedNutritionToday: true,
  }));
  assert.deepEqual(action, { kind: "rest" });
});
