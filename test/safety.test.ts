import { test } from "node:test";
import assert from "node:assert/strict";
import { checkExerciseAgainstInjuries, shouldEscalateForPainScore, shouldEscalateForSeverity } from "../src/domain/safety";
import type { InjuryDoc } from "../src/types";

function activeInjury(area: string): InjuryDoc {
  return {
    id: 1, userId: 1, area, severity: "strong", status: "active",
    reportedAt: new Date().toISOString(), checkAfter: "2099-01-01", lastAskedAt: null,
    swaps: [], resolvedAt: null, checkinsHistory: [],
  };
}

test("checkExerciseAgainstInjuries: a direct conflict blocks", () => {
  const result = checkExerciseAgainstInjuries({ name: "Barbell Squat" }, [activeInjury("knee")]);
  assert.equal(result.blocked, true);
  assert.equal(result.area, "knee");
  assert.equal(result.level, "direct");
});

test("checkExerciseAgainstInjuries: an unrelated exercise does not block", () => {
  const result = checkExerciseAgainstInjuries({ name: "Dumbbell Bicep Curl" }, [activeInjury("knee")]);
  assert.equal(result.blocked, false);
});

test("checkExerciseAgainstInjuries: no active injuries never blocks", () => {
  const result = checkExerciseAgainstInjuries({ name: "Barbell Squat" }, []);
  assert.equal(result.blocked, false);
});

test("checkExerciseAgainstInjuries: only the RELATED level (not direct) does not block", () => {
  // "Leg Curl" is related-only for knee (domain/injury.ts's `related` regex, not `keywords`).
  const result = checkExerciseAgainstInjuries({ name: "Leg Curl" }, [activeInjury("knee")]);
  assert.equal(result.blocked, false);
});

test("shouldEscalateForSeverity: strong escalates, mild does not", () => {
  assert.equal(shouldEscalateForSeverity("strong"), true);
  assert.equal(shouldEscalateForSeverity("mild"), false);
});

test("shouldEscalateForPainScore: matches the existing 7+ threshold", () => {
  assert.equal(shouldEscalateForPainScore(6), false);
  assert.equal(shouldEscalateForPainScore(7), true);
  assert.equal(shouldEscalateForPainScore(10), true);
});
