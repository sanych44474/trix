// nextTargetGuidance (domain/progression.ts): the RPE-autoregulated "what to do next time". The
// chat's post-workout recap that used it was retired with the chat (ADR-0012); the rule stays.
import { test } from "node:test";
import assert from "node:assert/strict";
import { nextTargetGuidance } from "../src/domain/progression";
import type { LoggedExercise } from "../src/types";

test("nextTargetGuidance: prioritizes PR exercises first and caps the list", () => {
  const exercises: LoggedExercise[] = [
    { name: "A", setsDone: [{ weight: 40, reps: 8 }], skipped: false },
    { name: "B", setsDone: [{ weight: 50, reps: 8 }], skipped: false },
    { name: "C (PR)", setsDone: [{ weight: 60, reps: 8 }], skipped: false },
    { name: "D", setsDone: [{ weight: 70, reps: 8 }], skipped: false },
  ];
  const guidance = nextTargetGuidance(exercises, ["C (PR)"], 2);
  assert.equal(guidance.length, 2);
  assert.equal(guidance[0].name, "C (PR)"); // PR exercise surfaces first despite being 3rd in the log
});

test("nextTargetGuidance: skips skipped exercises and non-weight metrics (time/distance)", () => {
  const exercises: LoggedExercise[] = [
    { name: "Skipped Lift", setsDone: [{ weight: 40, reps: 8 }], skipped: true },
    { name: "Plank", setsDone: [{ weight: 0, reps: 0, seconds: 60 }], skipped: false },
    { name: "Real Lift", setsDone: [{ weight: 40, reps: 8 }], skipped: false },
  ];
  const guidance = nextTargetGuidance(exercises, []);
  assert.deepEqual(guidance.map((g) => g.name), ["Real Lift"]);
});

test("nextTargetGuidance: flags overload only at RPE >= 9.5, matching nextTarget's own hold threshold", () => {
  const moderate: LoggedExercise[] = [{ name: "A", setsDone: [{ weight: 40, reps: 8 }], skipped: false, rpe: 8 }];
  const max: LoggedExercise[] = [{ name: "A", setsDone: [{ weight: 40, reps: 8 }], skipped: false, rpe: 9.5 }];
  assert.equal(nextTargetGuidance(moderate, [])[0].overload, false);
  assert.equal(nextTargetGuidance(max, [])[0].overload, true);
});
