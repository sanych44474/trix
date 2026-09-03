import { test } from "node:test";
import assert from "node:assert/strict";
import {
  adherenceDeloadDue,
  buildActivityCells,
  complianceScore,
  computePlanProgression,
  fatLossGoalReached,
  gainGoalReached,
  mesocyclePhase,
  nextLevel,
  shouldLevelUp,
} from "../src/domain/progression";
import type { PlanDoc, PlanExercise, WorkoutLogDoc } from "../src/types";

const wlog = (completed: boolean): WorkoutLogDoc => ({
  userId: 1,
  date: "2026-06-01",
  weekday: 1,
  exercises: [],
  completed,
  createdAt: new Date(0),
});

test("adherenceDeloadDue: triggers when most recent sessions are mostly skipped", () => {
  assert.equal(adherenceDeloadDue([wlog(true), wlog(false), wlog(false), wlog(false), wlog(false)]), true); // 20%
  assert.equal(adherenceDeloadDue([wlog(true), wlog(true), wlog(true), wlog(true), wlog(false)]), false); // 80%
  assert.equal(adherenceDeloadDue([wlog(false), wlog(false)]), false); // too few sessions
});

test("mesocyclePhase: 4-week accumulation→intensification→peak→deload cycle that wraps", () => {
  assert.deepEqual(mesocyclePhase(0), { phase: "accumulation", weekInBlock: 1 });
  assert.deepEqual(mesocyclePhase(1), { phase: "intensification", weekInBlock: 2 });
  assert.deepEqual(mesocyclePhase(2), { phase: "peak", weekInBlock: 3 });
  assert.deepEqual(mesocyclePhase(3), { phase: "deload", weekInBlock: 4 });
  assert.equal(mesocyclePhase(4).phase, "accumulation");
  assert.equal(mesocyclePhase(7).phase, "deload");
});

test("complianceScore: percentages clamp at 100 and handle zero denominators", () => {
  assert.deepEqual(complianceScore({ completedWorkouts: 3, scheduledWorkouts: 4, nutritionDays: 5, windowDays: 7 }), {
    workoutPct: 75,
    nutritionPct: 71,
  });
  assert.deepEqual(complianceScore({ completedWorkouts: 5, scheduledWorkouts: 3, nutritionDays: 0, windowDays: 0 }), {
    workoutPct: 100,
    nutritionPct: 0,
  });
});

test("buildActivityCells: oldest→newest window with workout/nutrition flags", () => {
  const cells = buildActivityCells("2026-06-07", new Set(["2026-06-07", "2026-06-05"]), new Set(["2026-06-06"]), 7);
  assert.equal(cells.length, 7);
  assert.equal(cells[0].date, "2026-06-01");
  assert.equal(cells[6].date, "2026-06-07");
  assert.equal(cells[6].workout, true);
  assert.equal(cells[5].nutrition, true);
  assert.equal(cells[4].workout, true);
  assert.equal(cells[0].workout, false);
});

test("nextLevel walks the ladder and stops at the top", () => {
  assert.equal(nextLevel("beginner"), "intermediate");
  assert.equal(nextLevel("intermediate"), "advanced");
  assert.equal(nextLevel("advanced"), null);
});

test("shouldLevelUp: fast pace + consistent weekly progress + headroom", () => {
  assert.equal(shouldLevelUp("beginner", "fast", 4), true);
  assert.equal(shouldLevelUp("beginner", "fast", 3), false); // not enough weeks
  assert.equal(shouldLevelUp("beginner", "normal", 6), false); // pace not fast
  assert.equal(shouldLevelUp("advanced", "fast", 6), false); // already top
});

test("fatLossGoalReached: meaningful cut that has plateaued", () => {
  const w = [
    { date: "2026-05-01", weight: 90 },
    { date: "2026-05-15", weight: 88 },
    { date: "2026-06-01", weight: 86.5 },
    { date: "2026-06-08", weight: 86.4 },
    { date: "2026-06-15", weight: 86.6 },
  ];
  assert.equal(fatLossGoalReached("fat loss", w), true);
  assert.equal(fatLossGoalReached("схуднення", w), true);
  assert.equal(fatLossGoalReached("muscle gain", w), false); // not a cut goal
  // still actively losing (no plateau) → not done
  assert.equal(fatLossGoalReached("fat loss", [
    { date: "2026-05-01", weight: 90 }, { date: "2026-05-15", weight: 88 },
    { date: "2026-06-01", weight: 86 }, { date: "2026-06-15", weight: 84 },
  ]), false);
});

test("gainGoalReached: meaningful bulk that has plateaued", () => {
  const w = [
    { date: "2026-04-01", weight: 70 },
    { date: "2026-04-20", weight: 72 },
    { date: "2026-05-10", weight: 73.5 },
    { date: "2026-05-20", weight: 73.4 },
    { date: "2026-05-27", weight: 73.6 },
  ];
  assert.equal(gainGoalReached("muscle gain", w), true);
  assert.equal(gainGoalReached("набір маси", w), true);
  assert.equal(gainGoalReached("fat loss", w), false); // wrong goal direction
});

function plan(ex: PlanExercise): PlanDoc {
  return {
    userId: 1, active: true, status: "active",
    split: [{ weekday: 1, muscleGroup: "x", exercises: [ex] }],
    nutrition: { calories: 0, protein: 0, fats: 0, carbs: 0 }, supplements: [], methodology: "", generatedAt: new Date(),
  };
}
function log(date: string, name: string, reps: number, weight: number, rpe: number): WorkoutLogDoc {
  return { userId: 1, date, weekday: 1, exercises: [{ name, setsDone: [{ reps, weight }], skipped: false, rpe }], completed: true, createdAt: new Date() };
}

test("computePlanProgression: easy sets (RPE≤7) → double the weight jump", () => {
  const ex: PlanExercise = { name: "Bench Press", sets: "3 × 8", startWeight: "60 kg", technique: "", muscles: "chest", role: "primary", isKeyLift: true };
  const logs = [log("2026-06-01", "Bench Press", 8, 60, 7), log("2026-06-03", "Bench Press", 8, 60, 7)];
  const r = computePlanProgression(plan(ex), logs, []);
  assert.equal(r.changes.length, 1);
  assert.equal(r.changes[0].field, "weight");
  assert.equal(r.changes[0].to, "65 kg"); // upper-body step 2.5 × 2 (easy)
});

test("computePlanProgression: hard sets (RPE 8) → single weight step", () => {
  const ex: PlanExercise = { name: "Bench Press", sets: "3 × 8", startWeight: "60 kg", technique: "", muscles: "chest", role: "primary", isKeyLift: true };
  const logs = [log("2026-06-01", "Bench Press", 8, 60, 8), log("2026-06-03", "Bench Press", 8, 60, 8)];
  const r = computePlanProgression(plan(ex), logs, []);
  assert.equal(r.changes[0].to, "62.5 kg");
});

test("computePlanProgression: bodyweight at the rep cap → flagged for a harder variation", () => {
  const ex: PlanExercise = { name: "Push-Up", sets: "3 × 20", startWeight: "Bodyweight", technique: "", muscles: "chest", role: "accessory" };
  const logs = [log("2026-06-01", "Push-Up", 20, 0, 8), log("2026-06-03", "Push-Up", 20, 0, 8)];
  const r = computePlanProgression(plan(ex), logs, []);
  assert.deepEqual(r.maxedBodyweight, ["Push-Up"]);
  assert.equal(r.changes.length, 0);
});

test("computePlanProgression: syncs plan weight UP to what the athlete actually lifts", () => {
  // Plan says 65 but the athlete works at 77 (below top of range → no double-progression bump);
  // the plan must still reflect the real 77, not stay stuck at 65.
  const ex: PlanExercise = { name: "Leg Extension", sets: "4 × 10-12", startWeight: "65 kg", technique: "", muscles: "quads", role: "accessory" };
  const logs = [log("2026-06-22", "Leg Extension", 10, 77, 8), log("2026-06-29", "Leg Extension", 10, 77, 8)];
  const r = computePlanProgression(plan(ex), logs, []);
  assert.equal(r.changes.length, 1);
  assert.equal(r.changes[0].to, "77 kg");
});

test("computePlanProgression: walks an undemonstrated weight back DOWN to reality (anti-regression)", () => {
  // Plan jumped to 85 after one 80×8, then the athlete regressed to 80×6 — 85 was never lifted,
  // so the plan is corrected back to the demonstrated 80.
  const ex: PlanExercise = { name: "Bench Press", sets: "4 × 6-8", startWeight: "85 kg", technique: "", muscles: "chest", role: "primary", isKeyLift: true };
  const logs = [log("2026-07-03", "Bench Press", 6, 80, 9), log("2026-06-26", "Bench Press", 8, 80, 8)];
  const r = computePlanProgression(plan(ex), logs, []);
  assert.equal(r.changes.length, 1);
  assert.equal(r.changes[0].to, "80 kg");
});

test("computePlanProgression: a one-off deload day doesn't drag the plan weight down", () => {
  // Heaviest recent working weight wins, so a light high-rep pump session is ignored.
  const ex: PlanExercise = { name: "Leg Extension", sets: "4 × 10-12", startWeight: "77 kg", technique: "", muscles: "quads", role: "accessory" };
  const logs = [log("2026-07-06", "Leg Extension", 20, 50, 6), log("2026-06-29", "Leg Extension", 10, 77, 8)];
  const r = computePlanProgression(plan(ex), logs, []);
  assert.equal(r.changes.length, 0); // stays at the demonstrated 77
});

test("computePlanProgression: caps the increase at demonstrated + 2 steps (never overshoots reality)", () => {
  // Even topping the range on an easy week, the plan can't leap past demonstrated + one double step.
  const ex: PlanExercise = { name: "Row", sets: "3 × 8", startWeight: "60 kg", technique: "", muscles: "back", role: "primary" };
  const logs = [log("2026-06-01", "Row", 8, 60, 7), log("2026-06-03", "Row", 8, 60, 7)];
  const r = computePlanProgression(plan(ex), logs, []);
  assert.equal(r.changes[0].to, "65 kg"); // 60 + 2.5×2, not more
});
