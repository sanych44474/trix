// Weekly calorie-target auto-adjustment ("mini MacroFactor") — pure, no DB.
// Compares the logged bodyweight trend against the rate implied by the user's goal and nudges
// the daily kcal target toward it. Conservative by design: requires consistent logging, moves
// in small steps, and never drops below a hard floor.
import { projectWeight } from "./analysis";

export const ADJUST_COOLDOWN_DAYS = 14;
const KCAL_PER_KG = 7700;
const MAX_STEP_KCAL = 150; // per adjustment, either direction
const MIN_STEP_KCAL = 50; // smaller corrections are noise — skip
const FLOOR_KCAL = { female: 1200, male: 1500 } as const;
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
  sex?: "male" | "female"; // the floor: 1500 kcal for men, 1200 for women (and when unknown)
}

export interface CalorieAdjustment {
  newCalories: number;
  deltaKcal: number; // signed change applied
  slopePerWeek: number; // actual trend
  targetPerWeek: number; // desired trend for the goal
}

/** Desired weekly rate for the goal, as a share of bodyweight (a flat -0.4 kg/wk was 0.8% for
 *  50 kg but 0.3% for 130 kg): cut ~0.6%/wk (0.25–1.0 kg), lean gain ~0.25%/wk (0.1–0.35 kg),
 *  maintain at 0. */
export function targetRatePerWeek(currentWeight: number, goalWeight: number): number {
  const diff = goalWeight - currentWeight;
  if (Math.abs(diff) < 1) return 0;
  const r = (x: number) => Math.round(x * 100) / 100;
  return diff < 0
    ? -r(Math.min(1, Math.max(0.25, currentWeight * 0.006)))
    : r(Math.min(0.35, Math.max(0.1, currentWeight * 0.0025)));
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

  const floor = input.sex === "male" ? FLOOR_KCAL.male : FLOOR_KCAL.female;
  const newCalories = Math.max(floor, Math.min(CEIL_KCAL, currentCalories + delta));
  if (newCalories === currentCalories) return null;
  return {
    newCalories,
    deltaKcal: newCalories - currentCalories,
    slopePerWeek: proj.slopePerWeek,
    targetPerWeek: target,
  };
}
