// Weekly calorie-target auto-adjustment ("mini MacroFactor") — pure, no DB.
// Compares the logged bodyweight trend against the rate implied by the user's goal and nudges
// the daily kcal target toward it. Conservative by design: requires consistent logging, moves
// in small steps, and never drops below a hard floor.
import { projectWeight } from "./analysis";

export const ADJUST_COOLDOWN_DAYS = 14;
const KCAL_PER_KG = 7700;
const MAX_STEP_KCAL = 150; // per adjustment, either direction
const MIN_STEP_KCAL = 50; // smaller corrections are noise — skip
const FLOOR_KCAL = 1200;
const CEIL_KCAL = 4500;
const ON_PACE_TOLERANCE = 0.15; // kg/week

export interface CalorieAdjustInput {
  currentCalories: number;
  goalWeight: number;
  /** Recent bodyweight logs, date ASC, within the lookback window. */
  weights: { date: string; weight: number }[];
  /** Distinct days with nutrition logs in the same window (adherence gate). */
  loggedNutritionDays: number;
  windowDays: number;
}

export interface CalorieAdjustment {
  newCalories: number;
  deltaKcal: number; // signed change applied
  slopePerWeek: number; // actual trend
  targetPerWeek: number; // desired trend for the goal
}

/** Desired weekly rate for the goal: cut at -0.4 kg/wk, gain at +0.25, maintain at 0. */
export function targetRatePerWeek(currentWeight: number, goalWeight: number): number {
  const diff = goalWeight - currentWeight;
  if (Math.abs(diff) < 1) return 0;
  return diff < 0 ? -0.4 : 0.25;
}

/**
 * Returns the adjustment to apply, or null when there is nothing (safe) to do:
 * too little data, poor logging adherence, already on pace, or a sub-step correction.
 */
export function calorieAdjustment(input: CalorieAdjustInput): CalorieAdjustment | null {
  const { currentCalories, goalWeight, weights, loggedNutritionDays, windowDays } = input;
  if (!(currentCalories > 0) || !(goalWeight > 0)) return null;
  const pts = weights.filter((w) => w.weight > 0);
  if (pts.length < 5) return null;
  const spanDays = (Date.parse(pts[pts.length - 1].date) - Date.parse(pts[0].date)) / 86_400_000;
  if (spanDays < 14) return null;
  // Without consistent food logging the kcal target isn't what drives the trend — don't touch it.
  if (loggedNutritionDays < Math.ceil(windowDays * 0.6)) return null;

  const proj = projectWeight(pts, goalWeight);
  if (!proj || proj.reached) return null;
  const target = targetRatePerWeek(proj.current, goalWeight);
  const gap = target - proj.slopePerWeek; // kg/week we are off by
  if (Math.abs(gap) <= ON_PACE_TOLERANCE) return null;

  // kcal/day correction that closes the gap, capped to a gentle step and rounded to 25.
  const raw = (gap * KCAL_PER_KG) / 7;
  const capped = Math.max(-MAX_STEP_KCAL, Math.min(MAX_STEP_KCAL, raw));
  const delta = Math.round(capped / 25) * 25;
  if (Math.abs(delta) < MIN_STEP_KCAL) return null;

  const newCalories = Math.max(FLOOR_KCAL, Math.min(CEIL_KCAL, currentCalories + delta));
  if (newCalories === currentCalories) return null;
  return {
    newCalories,
    deltaKcal: newCalories - currentCalories,
    slopePerWeek: proj.slopePerWeek,
    targetPerWeek: target,
  };
}
