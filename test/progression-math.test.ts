// The progression arithmetic: load step, working sets, lower-body detection, e1RM singles and
// the weekly plan progression reading them. Pure.
import { test } from "node:test";
import assert from "node:assert/strict";
import { computePlanProgression, isLowerBody, loadStep, workingSets } from "../src/domain/progression";
import { e1rm } from "../src/domain/records";
import type { PlanDoc, SetEntry, WorkoutLogDoc } from "../src/types";

test("loadStep: ~5% of the load, in real gym increments, capped at 2.5 upper / 5 lower", () => {
  assert.equal(loadStep("Dumbbell Lateral Raise", 6), 1); // was +2.5 (+40%)
  assert.equal(loadStep("Dumbbell Bench Press", 24), 2);
  assert.equal(loadStep("Bench Press", 60), 2.5);
  assert.equal(loadStep("Back Squat", 100), 5);
  assert.equal(loadStep("Back Squat", 40), 2.5);
  assert.equal(loadStep("Bench Press", 140), 2.5);
});

test("isLowerBody: lunges, hip thrusts and calves get the lower-body step", () => {
  for (const n of ["Walking Lunge", "Випади з гантелями", "Barbell Hip Thrust", "Standing Calf Raise", "Romanian Deadlift", "Leg Press"]) {
    assert.equal(isLowerBody(n), true, n);
  }
  for (const n of ["Bench Press", "Lat Pulldown", "Biceps Curl"]) assert.equal(isLowerBody(n), false, n);
});

test("e1rm: a single is the max; reps use Epley", () => {
  assert.equal(e1rm(100, 1), 100);
  assert.equal(Math.round(e1rm(100, 5)), 117);
});

const s = (weight: number, reps: number): SetEntry => ({ weight, reps });

test("workingSets: a heavy triple isn't the 8–12 working weight; reps is the worst working set", () => {
  assert.deepEqual(workingSets([s(80, 3), s(70, 10), s(70, 9)], 8), { weight: 70, reps: 9, count: 2 });
  assert.deepEqual(workingSets([s(20, 10), s(60, 12), s(60, 12), s(60, 12)], 8), { weight: 60, reps: 12, count: 3 });
});

function plan(sets: string, weight: string, name = "Bench Press"): PlanDoc {
  return {
    userId: 1, active: true, status: "active",
    split: [{ weekday: 1, muscleGroup: "Push", exercises: [{ name, sets, startWeight: weight, technique: "" }] }],
    nutrition: { calories: 2200, protein: 150, fats: 70, carbs: 250 },
    supplements: [], methodology: "", generatedAt: new Date("2026-01-01"), schemaVersion: 1,
  } as PlanDoc;
}
const log = (date: string, sets: SetEntry[], name = "Bench Press", rpe?: number): WorkoutLogDoc => ({
  userId: 1, date, weekday: 1, completed: true, createdAt: new Date(0),
  exercises: [{ name, setsDone: sets, skipped: false, ...(rpe ? { rpe } : {}) }],
});

test("weekly progression: only when EVERY working set topped the range", () => {
  const p = plan("3 × 8–12", "60 kg");
  const firstSetOnly = [log("2026-02-02", [s(60, 12), s(60, 9), s(60, 8)]), log("2026-02-04", [s(60, 12), s(60, 10), s(60, 8)])];
  assert.deepEqual(computePlanProgression(p, firstSetOnly, []).changes, []);
  const all = [log("2026-02-02", [s(60, 12), s(60, 12), s(60, 12)]), log("2026-02-04", [s(60, 12), s(60, 12), s(60, 12)])];
  assert.equal(computePlanProgression(p, all, []).changes[0]?.to, "62.5 kg");
});

test("weekly progression: a heavy single attempt doesn't drag the plan weight up", () => {
  const p = plan("3 × 8–12", "70 kg");
  const logs = [log("2026-02-02", [s(80, 3), s(70, 10), s(70, 10), s(70, 9)]), log("2026-02-04", [s(70, 10), s(70, 10), s(70, 9)])];
  assert.deepEqual(computePlanProgression(p, logs, []).changes, []);
});

test("weekly progression: a light dumbbell isolation moves by 1 kg, not 2.5", () => {
  const p = plan("3 × 12–15", "6 kg", "Dumbbell Lateral Raise");
  const logs = [0, 2].map((d) => log(`2026-02-0${d + 2}`, [s(6, 15), s(6, 15), s(6, 15)], "Dumbbell Lateral Raise", 8));
  assert.equal(computePlanProgression(p, logs, []).changes[0]?.to, "7 kg");
});

test("weekly progression: held on a deload week (its light logs are not the new normal)", () => {
  const p = plan("3 × 8–12", "60 kg");
  const light = [log("2026-02-02", [s(40, 10), s(40, 10)]), log("2026-02-04", [s(40, 10), s(40, 10)])];
  const r = computePlanProgression(p, light, [], { deloadHold: true });
  assert.deepEqual(r.changes, []);
  assert.equal(r.heldForDeload, true);
});
