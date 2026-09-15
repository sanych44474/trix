import { test } from "node:test";
import assert from "node:assert/strict";
import { exerciseCountLimits, hasCriticalIssues, lintPlan, type LintContext } from "../src/domain/plan-lint";
import type { PlanDoc } from "../src/types";

function emptyCtx(): LintContext {
  return { knownCatalogIds: new Set(), activeInjurySwaps: [] };
}

function planWithDay(exercises: PlanDoc["split"][number]["exercises"]): PlanDoc {
  return {
    userId: 1,
    active: true,
    status: "active",
    split: [{ weekday: 1, muscleGroup: "chest", exercises }],
    nutrition: { calories: 2200, protein: 160, fats: 70, carbs: 220 },
    supplements: [],
    methodology: "linear progression",
    generatedAt: new Date(),
    schemaVersion: 1,
  };
}

test("exerciseCountLimits: adapts the generation gate to session length and endurance goals", () => {
  assert.deepEqual(exerciseCountLimits({ goal: "muscle gain", sessionMinutes: 60 }), { min: 5, max: 6 });
  assert.deepEqual(exerciseCountLimits({ goal: "strength", sessionMinutes: 30 }), { min: 3, max: 4 });
  assert.deepEqual(exerciseCountLimits({ goal: "hypertrophy", sessionMinutes: 45 }), { min: 4, max: 5 });
  assert.deepEqual(exerciseCountLimits({ goal: "10k running", sessionMinutes: 90 }), { min: 3, max: 4 });
});

test("lintPlan: a clean plan has no issues", () => {
  const plan = planWithDay([{ name: "Bench Press", sets: "3x8", startWeight: "60kg", technique: "Press." }]);
  const issues = lintPlan(plan, emptyCtx());
  assert.deepEqual(issues, []);
  assert.equal(hasCriticalIssues(issues), false);
});

test("lintPlan: empty split is critical", () => {
  const plan = planWithDay([]);
  plan.split = [];
  const issues = lintPlan(plan, emptyCtx());
  assert.ok(issues.some((i) => i.code === "empty_split" && i.severity === "critical"));
  assert.equal(hasCriticalIssues(issues), true);
});

test("lintPlan: duplicate exercise names within a day is critical", () => {
  const plan = planWithDay([
    { name: "Bench Press", sets: "3x8", startWeight: "60kg", technique: "Press." },
    { name: "bench press", sets: "3x8", startWeight: "60kg", technique: "Press again." },
  ]);
  const issues = lintPlan(plan, emptyCtx());
  assert.ok(issues.some((i) => i.code === "duplicate_exercise" && i.severity === "critical"));
});

test("lintPlan: exerciseId not in the known catalog is critical", () => {
  const plan = planWithDay([{ name: "Bench Press", exerciseId: "ghost-id", sets: "3x8", startWeight: "60kg", technique: "Press." }]);
  const issues = lintPlan(plan, emptyCtx());
  assert.ok(issues.some((i) => i.code === "unknown_catalog_id" && i.severity === "critical"));
});

test("lintPlan: a known exerciseId passes", () => {
  const plan = planWithDay([{ name: "Bench Press", exerciseId: "real-id", sets: "3x8", startWeight: "60kg", technique: "Press." }]);
  const issues = lintPlan(plan, { knownCatalogIds: new Set(["real-id"]), activeInjurySwaps: [] });
  assert.deepEqual(issues, []);
});

test("lintPlan: an exercise reappearing after an active injury swap is a WARNING, not critical", () => {
  const plan = planWithDay([{ name: "Barbell Squat", sets: "3x8", startWeight: "80kg", technique: "Squat." }]);
  const ctx: LintContext = {
    knownCatalogIds: new Set(),
    activeInjurySwaps: [
      { weekday: 1, index: 0, original: { name: "Barbell Squat", sets: "3x8", startWeight: "80kg", technique: "Squat." }, replacementCanonical: "Leg Press" },
    ],
  };
  const issues = lintPlan(plan, ctx);
  assert.ok(issues.some((i) => i.code === "injury_conflict" && i.severity === "warning"));
  assert.equal(hasCriticalIssues(issues), false); // a warning alone must not block the save
});

test("lintPlan: non-positive calories is critical", () => {
  const plan = planWithDay([{ name: "Bench Press", sets: "3x8", startWeight: "60kg", technique: "Press." }]);
  plan.nutrition.calories = 0;
  const issues = lintPlan(plan, emptyCtx());
  assert.ok(issues.some((i) => i.code === "invalid_nutrition" && i.severity === "critical"));
});

test("lintPlan: calories below the sanity floor is critical (bug trap, not a diet minimum)", () => {
  const plan = planWithDay([{ name: "Bench Press", sets: "3x8", startWeight: "60kg", technique: "Press." }]);
  plan.nutrition.calories = 400; // e.g. a unit mix-up or truncated AI response
  const issues = lintPlan(plan, emptyCtx());
  assert.ok(issues.some((i) => i.code === "implausible_calories" && i.severity === "critical"));
});

test("lintPlan: a modest but plausible calorie target passes", () => {
  const plan = planWithDay([{ name: "Bench Press", sets: "3x8", startWeight: "60kg", technique: "Press." }]);
  plan.nutrition.calories = 1400;
  const issues = lintPlan(plan, emptyCtx());
  assert.equal(issues.filter((i) => i.code === "implausible_calories").length, 0);
});

test("lintPlan: negative macro is critical", () => {
  const plan = planWithDay([{ name: "Bench Press", sets: "3x8", startWeight: "60kg", technique: "Press." }]);
  plan.nutrition.protein = -5;
  const issues = lintPlan(plan, emptyCtx());
  assert.ok(issues.some((i) => i.code === "invalid_nutrition" && i.severity === "critical"));
});

test("lintPlan: a light 1-exercise day is NOT flagged (that's an AI-generation-time rule, not a structural one)", () => {
  const plan = planWithDay([{ name: "Bench Press", sets: "3x8", startWeight: "60kg", technique: "Press." }]);
  const issues = lintPlan(plan, emptyCtx());
  assert.equal(issues.length, 0);
});
