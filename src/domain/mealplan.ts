import type { MealItem, NutritionTargets, UserProfile } from "../types";

// Per-100g macros from USDA/OFF (the source of truth — the LLM never invents these).
export interface Per100g {
  kcal: number;
  protein: number;
  fats: number;
  carbs: number;
}

/** Daily targets for the nutritionist. Prefer the training plan's macros (already tailored by
 * the plan AI); otherwise derive deterministically (Mifflin-St-Jeor + activity + goal). */
export function computeTargets(profile: UserProfile, planNutrition?: NutritionTargets): NutritionTargets {
  if (planNutrition && planNutrition.calories > 0) return planNutrition;

  const kg = profile.weightKg ?? 75;
  const cm = profile.heightCm ?? 175;
  const age = profile.age ?? 30;
  const bmr = 10 * kg + 6.25 * cm - 5 * age + (profile.sex === "female" ? -161 : 5);

  const base = profile.lifestyle === "active" ? 1.6 : profile.lifestyle === "moderate" ? 1.45 : 1.3;
  const factor = base + Math.min(profile.daysPerWeek ?? 0, 5) * 0.03;
  let calories = bmr * factor;

  const goal = (profile.goal ?? "").toLowerCase();
  if (/(fat|схуд|похуд|loss|cut)/.test(goal)) calories *= 0.8;
  else if (/(gain|муск|маса|bulk|сил)/.test(goal)) calories *= 1.1;

  calories = Math.round(calories / 10) * 10;
  const protein = Math.round(2 * kg); // 2 g/kg
  const fats = Math.round(0.9 * kg); // 0.9 g/kg
  const carbs = Math.max(0, Math.round((calories - protein * 4 - fats * 9) / 4));
  return { calories, protein, fats, carbs };
}

const MEAL_WEIGHTS: Record<number, number[]> = {
  3: [0.3, 0.4, 0.3],
  4: [0.25, 0.32, 0.3, 0.13],
  5: [0.2, 0.1, 0.32, 0.25, 0.13],
};

/** Split daily targets across N meals by fixed weights (equal split if N is unusual). */
export function splitMeals(targets: NutritionTargets, mealsPerDay: number): NutritionTargets[] {
  const weights = MEAL_WEIGHTS[mealsPerDay] ?? Array.from({ length: mealsPerDay }, () => 1 / mealsPerDay);
  return weights.map((w) => ({
    calories: Math.round(targets.calories * w),
    protein: Math.round(targets.protein * w),
    fats: Math.round(targets.fats * w),
    carbs: Math.round(targets.carbs * w),
  }));
}

/** Reject implausible per-100g macros before they poison a meal. USDA is reliable, but the
 * Open Food Facts fallback returns random branded products with zero/garbage macros — those
 * later get scaled to fill the calorie target and produce impossible meals (e.g. 72 g fat,
 * 3 g protein). A food is plausible only if its reported kcal roughly matches its Atwater
 * macro energy and the macros don't exceed ~100 g per 100 g. */
export function isPlausiblePer100g(p: Per100g): boolean {
  if (!(p.kcal > 0)) return false;
  if (p.protein < 0 || p.fats < 0 || p.carbs < 0) return false;
  if (p.protein + p.fats + p.carbs > 105) return false; // can't weigh >100 g per 100 g
  const macroKcal = p.protein * 4 + p.fats * 9 + p.carbs * 4;
  if (macroKcal <= 0) return false;
  const ratio = macroKcal / p.kcal;
  return ratio > 0.6 && ratio < 1.6; // reported kcal must track the macros
}

// Condiments/seasonings are flavor, not macro fillers. The least-squares solver is blind to
// food type, so without a ceiling it will happily scale "soy sauce" to 135 g to close a macro
// gap. Cap such foods at a realistic seasoning amount; whole foods stay uncapped (Infinity).
const CONDIMENT_CAP_G = 30;
const CONDIMENT_HINTS = [
  "soy sauce", "fish sauce", "oyster sauce", "hot sauce", "worcestershire", "teriyaki",
  "ketchup", "mustard", "mayo", "mayonnaise", "vinegar", "dressing", "syrup", "honey",
  "olive oil", "vegetable oil", "sesame oil", "coconut oil", "oil", "butter", "salt",
  "pepper", "spice", "seasoning", "pesto",
];
export function portionCapGrams(food: string): number {
  const f = food.toLowerCase();
  return CONDIMENT_HINTS.some((h) => f.includes(h)) ? CONDIMENT_CAP_G : Infinity;
}

/** Solve candidate-food grams so the meal approximates ALL of its macro targets (kcal,
 * protein, fats, carbs) — not just calories. Calorie-only scaling left protein wildly off
 * (one meal 105 g, the next 3 g). The objective is a weighted relative least-squares
 * E = Σ Wₘ·((totalₘ − targetₘ)/targetₘ)²  with calories & protein weighted highest; it is
 * quadratic in the grams, so steepest descent with an exact (closed-form) line-search step
 * converges in a handful of iterations with no tuning. Grams are clamped to ≥5 g and rounded
 * to 5 g; macros are recomputed from the real per-100g data. */
export function solvePortions(
  candidates: { food: string; grams: number; per100g: Per100g }[],
  target: NutritionTargets,
): MealItem[] {
  const n = candidates.length;
  if (!n) return [];
  // bᵢ = per-100g macros / target  →  totalₘ/targetₘ = Σ bᵢₘ·gᵢ. A zero target drops out.
  const tgt = [target.calories, target.protein, target.fats, target.carbs];
  const imp = [4, 3, 0.6, 0.6]; // importance: calories ≈ protein ≫ fats ≈ carbs
  const w = tgt.map((tm, m) => (tm > 0 ? imp[m] : 0));
  const b = candidates.map((c) => {
    const v = [c.per100g.kcal, c.per100g.protein, c.per100g.fats, c.per100g.carbs];
    return v.map((vm, m) => (tgt[m] > 0 ? vm / 100 / tgt[m] : 0));
  });
  const cap = candidates.map((c) => portionCapGrams(c.food));
  let g = candidates.map((c, i) => Math.min(cap[i], Math.max(5, c.grams || 5)));
  for (let iter = 0; iter < 200; iter++) {
    // relative residual per macro: ρₘ = Σ bᵢₘ·gᵢ − 1
    const rho = w.map((_, m) => {
      let s = 0;
      for (let i = 0; i < n; i++) s += b[i][m] * g[i];
      return s - 1;
    });
    // gradient ∇ᵢ = Σ 2·wₘ·ρₘ·bᵢₘ
    const grad = new Array<number>(n).fill(0);
    for (let i = 0; i < n; i++) for (let m = 0; m < 4; m++) grad[i] += 2 * w[m] * rho[m] * b[i][m];
    let gg = 0;
    for (let i = 0; i < n; i++) gg += grad[i] * grad[i];
    if (gg < 1e-12) break;
    // exact step for the quadratic: α = (∇·∇)/(∇ᵀH∇), H = 2·Σₘ wₘ·bₘ⊗bₘ.
    const bgrad = w.map((_, m) => {
      let s = 0;
      for (let j = 0; j < n; j++) s += b[j][m] * grad[j];
      return s;
    });
    let gHg = 0;
    for (let i = 0; i < n; i++) {
      let hi = 0;
      for (let m = 0; m < 4; m++) hi += 2 * w[m] * b[i][m] * bgrad[m];
      gHg += grad[i] * hi;
    }
    if (gHg < 1e-12) break;
    const alpha = gg / gHg;
    for (let i = 0; i < n; i++) g[i] = Math.min(cap[i], Math.max(5, g[i] - alpha * grad[i]));
  }
  return candidates.map((c, i) => {
    const grams = Math.min(cap[i], Math.max(5, Math.round(g[i] / 5) * 5));
    const f = grams / 100;
    return {
      food: c.food,
      grams,
      kcal: Math.round(c.per100g.kcal * f),
      protein: Math.round(c.per100g.protein * f),
      fats: Math.round(c.per100g.fats * f),
      carbs: Math.round(c.per100g.carbs * f),
    };
  });
}

/** Sum a meal's items into meal-level macros. */
/** Per-100g macros implied by a corrected total for a known portion weight — the value cached
 * so later lookups of the same food use the correction automatically. Shared by the chat macro
 * editor and the Mini App's macro-edit action; previously reimplemented identically in both. */
export function per100gCorrectionFrom(kcal: number, protein: number, fats: number, carbs: number, grams: number): Per100g {
  return {
    kcal: Math.round((kcal / grams) * 100),
    protein: Math.round((protein / grams) * 100),
    fats: Math.round((fats / grams) * 100),
    carbs: Math.round((carbs / grams) * 100),
  };
}

export interface ScalableMeal {
  kcal: number;
  protein: number;
  fats: number;
  carbs: number;
  grams?: number;
}

/** Scale a logged meal entry's macros (and grams, if known) by a factor — portion buttons
 * (½ / 1.5× / 2×) and the grams-based re-weigh both reduce to "pick a factor, scale everything."
 * Grams floors at 1 rather than rounding to 0 on an aggressive down-scale. */
export function scaleMealEntry<T extends ScalableMeal>(entry: T, factor: number): T {
  return {
    ...entry,
    kcal: Math.round((entry.kcal || 0) * factor),
    protein: Math.round((entry.protein || 0) * factor),
    fats: Math.round((entry.fats || 0) * factor),
    carbs: Math.round((entry.carbs || 0) * factor),
    ...(entry.grams != null ? { grams: Math.max(1, Math.round(entry.grams * factor)) } : {}),
  };
}

export function sumItems(items: MealItem[]): { kcal: number; protein: number; fats: number; carbs: number } {
  return items.reduce(
    (a, it) => ({
      kcal: a.kcal + it.kcal,
      protein: a.protein + it.protein,
      fats: a.fats + it.fats,
      carbs: a.carbs + it.carbs,
    }),
    { kcal: 0, protein: 0, fats: 0, carbs: 0 },
  );
}
