// Generating one day of the meal plan, for the bot's /mealplan and the Mini App's meal plan screen. Moved from bot/mealPlanCmds.ts.
import { aiJSON } from "../../ai";
import { type Per100g, lookupPer100gCached } from "../../ai/nutritionDb";
import * as P from "../../ai/prompts";
import { getFoodTranslations, upsertFoodTranslations } from "../../adapters/d1/v2Nutrition";
import { buildTemplateMealDay, dishName, expandExclusions } from "../../domain/mealTemplate";
import { isPlausiblePer100g, solvePortions, splitMeals, sumItems } from "../../domain/mealplan";
import { goalBucket } from "../../domain/planBank";
import { cleanAi } from "../../locales/i18n";
import { type Env, type Lang, type Meal, type NutritionTargets, type UserProfile } from "../../types";

// One realistic day's meals, solved to macro-accurate gram amounts and localized for display.
// `seedOffset` shifts the template's rotation (buildTemplateMealDay's seed is userId-based) so
// callers generating several days at once (deliverWeeklyMealPlan) get genuinely distinct days
// instead of the same menu repeated. Template = deterministic human composition (zero AI); AI = Gemini.
// Exported (env/db/profile passed explicitly, no MyContext) so the Mini App's webapp route can
// call the exact same generation logic as the bot's /mealplan regenerate flow, instead of
// reimplementing it.
export async function generateMealDayFor(
  env: Env,
  db: D1Database,
  lang: Lang,
  profile: UserProfile,
  userId: number,
  targets: NutritionTargets,
  mealsPerDay: number,
  excluded: string,
  likes: string,
  useAi: boolean,
  seedOffset: number,
): Promise<Meal[]> {
  const p = profile;
  const mealSplit = splitMeals(targets, mealsPerDay);
  // Turn a raw day (AI- or template-produced) into solved, macro-accurate meals.
  const solveDay = async (rawMeals: { name: string; items: { food_name: string; grams: number }[] }[]): Promise<Meal[]> => {
    // Batch all per-100g lookups for the whole day in parallel (deduped) instead of one-by-one.
    const names = [...new Set((rawMeals ?? []).flatMap((m) => (m.items ?? []).map((it) => it.food_name)))];
    const refs = new Map<string, Per100g | null>(
      await Promise.all(names.map(async (n) => [n, await lookupPer100gCached(db, env, n)] as const)),
    );
    const meals: Meal[] = [];
    for (let i = 0; i < (rawMeals ?? []).length; i++) {
      const m = rawMeals[i];
      const target = mealSplit[i] ?? mealSplit[mealSplit.length - 1];
      const cands: { food: string; grams: number; per100g: { kcal: number; protein: number; fats: number; carbs: number } }[] = [];
      for (const it of m.items ?? []) {
        const ref = refs.get(it.food_name) ?? null;
        if (ref && isPlausiblePer100g(ref)) cands.push({ food: it.food_name.trim(), grams: it.grams, per100g: ref });
      }
      if (!cands.length) continue;
      const solved = solvePortions(cands, target);
      const trimmed = solved.filter((it) => it.grams > 5);
      const items = trimmed.length ? trimmed : solved;
      meals.push({ name: m.name.trim(), items, ...sumItems(items) });
    }
    return meals;
  };

  const rawDay = useAi
    ? (await aiJSON<P.MealDayResult>(env, {
        system: P.mealDaySystem({ mealsPerDay, daily: targets, mealSplit, excluded, likes }),
        user: "Generate the day's meals now as JSON.",
        schema: P.MEAL_DAY_SCHEMA,
        kind: "meal_plan",
        groqModel: "openai/gpt-oss-120b",
        temperature: 0.5,
        db,
        userId,
      })).meals
    : buildTemplateMealDay(mealsPerDay, { goal: goalBucket(p.goal), excluded: expandExclusions(excluded), seed: userId + seedOffset }).meals;
  const meals = await solveDay(rawDay);
  if (!meals.length) return [];
  const localized = await localizeMealNames(env, db, lang, userId, meals);
  // Override the plain translation with a human dish name (porridge / boiled rice / cooked
  // lentils…) for known foods — keyed by the original English food so the lookup stayed exact.
  return localized.map((m, mi) => ({
    ...m,
    items: m.items.map((item, ii) => {
      const dish = dishName(meals[mi].items[ii]?.food ?? "", lang);
      return dish ? { ...item, food: dish } : item;
    }),
  }));
}

// Translate the day's English food + meal names to the user's language in one batched
// translate call (Gemini-first chain, deduped names). Best-effort: any failure leaves the
// English names so the menu still renders.
export async function localizeMealNames(env: Env, db: D1Database, lang: Lang, userId: number, meals: Meal[]): Promise<Meal[]> {
  if (lang === "en") return meals;
  const names = [...new Set([...meals.map((m) => m.name), ...meals.flatMap((m) => m.items.map((it) => it.food))])].filter(Boolean);
  if (!names.length) return meals;
  // Prefer the seeded/cached translations (consistent names, no AI call); only translate the
  // misses, then cache them so the same foods never hit the AI again.
  const cached = await getFoodTranslations(db, names, lang).catch(() => new Map<string, string>());
  const map = new Map<string, string>();
  for (const n of names) {
    const hit = cached.get(n.toLowerCase().trim());
    if (hit) map.set(n, hit);
  }
  const missing = names.filter((n) => !map.has(n));
  if (missing.length) {
    try {
      const result = await aiJSON<P.TranslateFoodsResult>(env, {
        system: P.translateFoodsSystem(lang),
        user: P.translateFoodsUser(missing),
        schema: P.TRANSLATE_FOODS_SCHEMA,
        temperature: 0.2,
        kind: "translate",
        db,
        userId,
      });
      const fresh: { en: string; name: string }[] = [];
      for (const it of result.items ?? []) {
        const local = cleanAi(it.local ?? "");
        if (it.en && local) { map.set(it.en, local); fresh.push({ en: it.en, name: local }); }
      }
      if (fresh.length) await upsertFoodTranslations(db, lang, fresh).catch(() => {});
    } catch {
      /* leave misses in English */
    }
  }
  return meals.map((m) => ({
    ...m,
    name: map.get(m.name) ?? m.name,
    items: m.items.map((it) => ({ ...it, food: map.get(it.food) ?? it.food })),
  }));
}
