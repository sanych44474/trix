import { test } from "node:test";
import assert from "node:assert/strict";
import { calorieAdjustment, targetRatePerWeek } from "../src/domain/adaptiveCalories";

// 21 days of weights moving at `slopePerWeek`, one point every 3 days (8 points, span 21d).
const trend = (startKg: number, slopePerWeek: number): { date: string; weight: number }[] =>
  Array.from({ length: 8 }, (_, i) => ({
    date: new Date(Date.UTC(2026, 5, 1 + i * 3)).toISOString().slice(0, 10),
    weight: Math.round((startKg + (slopePerWeek * i * 3) / 7) * 100) / 100,
  }));

const base = { currentCalories: 2200, windowDays: 21, loggedNutritionDays: 18 };

test("targetRatePerWeek: cut / gain / maintain", () => {
  assert.equal(targetRatePerWeek(90, 80), -0.4);
  assert.equal(targetRatePerWeek(70, 78), 0.25);
  assert.equal(targetRatePerWeek(80, 80.5), 0);
});

test("stalled cut → calories go down", () => {
  const adj = calorieAdjustment({ ...base, goalWeight: 78, weights: trend(88, 0) });
  assert.ok(adj);
  assert.ok(adj!.deltaKcal < 0);
  assert.equal(adj!.newCalories, 2200 + adj!.deltaKcal);
  assert.equal(Math.abs(adj!.deltaKcal % 25), 0);
});

test("cutting too fast → calories go up", () => {
  const adj = calorieAdjustment({ ...base, goalWeight: 78, weights: trend(88, -1.2) });
  assert.ok(adj);
  assert.ok(adj!.deltaKcal > 0);
});

test("on pace → no change", () => {
  assert.equal(calorieAdjustment({ ...base, goalWeight: 78, weights: trend(88, -0.4) }), null);
});

test("step is capped at ±150 kcal", () => {
  const adj = calorieAdjustment({ ...base, goalWeight: 78, weights: trend(88, 1.5) }); // gaining on a cut
  assert.ok(adj);
  assert.equal(adj!.deltaKcal, -150);
});

test("gates: few points, short span, poor logging, goal reached → null", () => {
  const w = trend(88, 0);
  assert.equal(calorieAdjustment({ ...base, goalWeight: 78, weights: w.slice(0, 3) }), null);
  assert.equal(calorieAdjustment({ ...base, goalWeight: 78, weights: w.slice(0, 5).map((p, i) => ({ ...p, date: `2026-06-0${i + 1}` })) }), null);
  assert.equal(calorieAdjustment({ ...base, loggedNutritionDays: 5, goalWeight: 78, weights: w }), null);
  assert.equal(calorieAdjustment({ ...base, goalWeight: 88.1, weights: w }), null); // reached
});

test("never drops below the 1200 kcal floor", () => {
  const adj = calorieAdjustment({ ...base, currentCalories: 1250, goalWeight: 78, weights: trend(88, 0.6) });
  if (adj) assert.ok(adj.newCalories >= 1200);
});
