// Meal plans in the chat: the allergen intake, day and week plans (AI or template), grocery list
// and localized meal names. Split out of router.ts; router.ts re-exports everything here.
import { InlineKeyboard } from "grammy";
import { RateLimitError, aiJSON } from "../ai";
import { type Per100g, lookupPer100gCached } from "../ai/nutritionDb";
import * as P from "../ai/prompts";
import { mealActionsKb, menuBtn } from "./keyboards";
import { recordPlanSource } from "../adapters/d1/v2Admin";
import { getActivePlan } from "../adapters/d1/v2Plans";
import { updateUser } from "../adapters/d1/v2Users";
import { getFoodTranslations, getMealPlan, saveMealPlan, upsertFoodTranslations } from "../adapters/d1/v2Nutrition";
import { buildTemplateMealDay, dishName, expandExclusions } from "../domain/mealTemplate";
import { computeTargets, isPlausiblePer100g, solvePortions, splitMeals, sumItems } from "../domain/mealplan";
import { goalBucket } from "../domain/planBank";
import { localParts } from "../domain/localTime";
import { cleanAi, t } from "../locales/i18n";
import { renderGroceryList, renderMealPlan } from "../render";
import { groceryList } from "../domain/groceryList";
import { type Env, type Lang, type Meal, type MealPlanDoc, type NutritionTargets, type UserProfile } from "../types";
import { MyContext, TKey, reply } from "../adapters/telegram/context";

// Quick nutrition intake (checkin-style buttons): allergens → likes → dislikes, then generate.
export const MP_ALLERGENS = ["lactose", "gluten", "nuts", "eggs", "seafood", "soy"] as const;

export const MP_ALLERGEN_KEY: Record<string, TKey> = {
  lactose: "mp_al_lactose", gluten: "mp_al_gluten", nuts: "mp_al_nuts",
  eggs: "mp_al_eggs", seafood: "mp_al_seafood", soy: "mp_al_soy",
};

export function mpAllergenKb(lang: Lang, selected: string[]): InlineKeyboard {
  const sel = new Set(selected);
  const kb = new InlineKeyboard();
  MP_ALLERGENS.forEach((a, idx) => {
    kb.text(`${sel.has(a) ? "✅ " : ""}${t(lang, MP_ALLERGEN_KEY[a])}`, `mpa:${a}`);
    if ((idx + 1) % 2 === 0) kb.row();
  });
  return kb.row().text(t(lang, "mp_al_none"), "mpa:none").text(t(lang, "ob_done"), "mpa:done");
}

export const mpSkipKb = (lang: Lang) => new InlineKeyboard().text(t(lang, "mp_skip"), "mp:skip");

export async function cmdMealPlan(ctx: MyContext) {
  const lang = ctx.user.lang;
  const plan = await getActivePlan(ctx.db, ctx.user._id);
  if (!computeTargets(ctx.user.profile, plan?.nutrition).calories) {
    await reply(ctx, t(lang, "mealplan_no_targets"), menuBtn(lang));
    return;
  }
  // Show the last-built menu first (with regenerate + menu controls below it) instead of
  // jumping straight into the intake flow. Only start intake when nothing has been built yet.
  const existing = await getMealPlan(ctx.db, ctx.user._id);
  if (existing?.days?.length) {
    const kb = new InlineKeyboard()
      .text(t(lang, "mp_regenerate"), "mp:regen")
      .text(t(lang, "grocery_btn"), "gro:open")
      .row()
      .text(t(lang, "mp_weekly"), "mp:week")
      .text(t(lang, "menu_open"), "menu:open");
    await reply(ctx, renderMealPlan(lang, existing), kb);
    return;
  }
  await startMealPlanIntake(ctx);
}

// Shopping list from the current menu. The meal plan holds ONE day, so the user picks how many
// days to shop for and that day is multiplied out — which is also how anyone meal-prepping
// actually shops. Read-only: it never touches the stored menu.
export async function cmdGrocery(ctx: MyContext) {
  const lang = ctx.user.lang;
  const menu = await getMealPlan(ctx.db, ctx.user._id);
  if (!menu?.days?.length) {
    await reply(ctx, t(lang, "grocery_no_menu"), menuBtn(lang));
    return;
  }
  if (menu.days.length > 1) {
    // A weekly plan already specifies every day for real -- sum it as-is (repeat=1), no
    // day-picker: multiplying it further would double-count the 7 distinct days it already has.
    const lines = groceryList(menu.days, 1);
    if (!lines.length) {
      await reply(ctx, t(lang, "grocery_no_menu"), menuBtn(lang));
      return;
    }
    await reply(ctx, renderGroceryList(lang, lines, menu.days.length), menuBtn(lang));
    return;
  }
  const kb = new InlineKeyboard();
  for (const n of [3, 5, 7]) kb.text(t(lang, "grocery_days_btn", { n }), `gro:n:${n}`);
  await reply(ctx, t(lang, "grocery_pick_days"), kb);
}

export async function showGroceryList(ctx: MyContext, days: number) {
  const lang = ctx.user.lang;
  const n = Number.isFinite(days) && days > 0 ? Math.min(14, Math.round(days)) : 1;
  const menu = await getMealPlan(ctx.db, ctx.user._id);
  const lines = menu?.days?.length ? groceryList(menu.days, n) : [];
  if (!lines.length) {
    await reply(ctx, t(lang, "grocery_no_menu"), menuBtn(lang));
    return;
  }
  await reply(ctx, renderGroceryList(lang, lines, n), menuBtn(lang));
}

// Begin the allergens → likes → dislikes intake that feeds meal-plan generation.
// When preferences were already collected once, offer to reuse them instead of re-asking
// the full questionnaire on every regenerate.
export async function startMealPlanIntake(ctx: MyContext) {
  const lang = ctx.user.lang;
  const p = ctx.user.profile;
  if (p.allergies !== undefined || p.foodLikes !== undefined || p.foodDislikes !== undefined) {
    const none = t(lang, "mp_prev_none");
    const kb = new InlineKeyboard()
      .text(t(lang, "mp_prev_keep"), "mp:useprev")
      .text(t(lang, "mp_prev_change"), "mp:redo");
    await reply(
      ctx,
      t(lang, "mp_prev_summary", {
        allergens: p.allergies || none,
        likes: p.foodLikes || none,
        dislikes: p.foodDislikes || none,
      }),
      kb,
    );
    return;
  }
  await beginMealPlanIntake(ctx);
}

export async function beginMealPlanIntake(ctx: MyContext) {
  const lang = ctx.user.lang;
  ctx.user.session = { ...ctx.user.session, mode: "mp_allergens", mpAllergens: [] };
  await updateUser(ctx.db, ctx.user._id, { session: ctx.user.session });
  await reply(ctx, t(lang, "mp_q_allergens"), mpAllergenKb(lang, []));
}

// Allergen multi-select buttons: mpa:<key> toggles; mpa:none / mpa:done advance to likes.
export async function mealAllergenButton(ctx: MyContext, payload: string) {
  const lang = ctx.user.lang;
  if (ctx.user.session.mode !== "mp_allergens") return;
  if (payload === "none" || payload === "done") {
    const sel = payload === "none" ? [] : (ctx.user.session.mpAllergens ?? []);
    ctx.user.profile = { ...ctx.user.profile, allergies: sel.length ? sel.join(", ") : "none" };
    ctx.user.session = { ...ctx.user.session, mode: "mp_likes", mpAllergens: undefined };
    await updateUser(ctx.db, ctx.user._id, { profile: ctx.user.profile, session: ctx.user.session });
    await reply(ctx, t(lang, "mp_q_likes"), mpSkipKb(lang));
    return;
  }
  const cur = new Set(ctx.user.session.mpAllergens ?? []);
  cur.has(payload) ? cur.delete(payload) : cur.add(payload);
  ctx.user.session = { ...ctx.user.session, mpAllergens: [...cur] };
  await updateUser(ctx.db, ctx.user._id, { session: ctx.user.session });
  await ctx.editMessageReplyMarkup({ reply_markup: mpAllergenKb(lang, [...cur]) }).catch(() => {});
}

// Free-text intake answers (likes/dislikes).
export async function mealIntakeText(ctx: MyContext, text: string) {
  const lang = ctx.user.lang;
  if (ctx.user.session.mode === "mp_likes") {
    ctx.user.profile = { ...ctx.user.profile, foodLikes: text };
    ctx.user.session = { ...ctx.user.session, mode: "mp_dislikes" };
    await updateUser(ctx.db, ctx.user._id, { profile: ctx.user.profile, session: ctx.user.session });
    await reply(ctx, t(lang, "mp_q_dislikes"), mpSkipKb(lang));
  } else if (ctx.user.session.mode === "mp_dislikes") {
    ctx.user.profile = { ...ctx.user.profile, foodDislikes: text };
    await startMealGeneration(ctx);
  }
}

export async function mealSkip(ctx: MyContext) {
  const lang = ctx.user.lang;
  if (ctx.user.session.mode === "mp_likes") {
    ctx.user.session = { ...ctx.user.session, mode: "mp_dislikes" };
    await updateUser(ctx.db, ctx.user._id, { session: ctx.user.session });
    await reply(ctx, t(lang, "mp_q_dislikes"), mpSkipKb(lang));
  } else if (ctx.user.session.mode === "mp_dislikes") {
    await startMealGeneration(ctx);
  }
}

export async function startMealGeneration(ctx: MyContext) {
  const lang = ctx.user.lang;
  const plan = await getActivePlan(ctx.db, ctx.user._id);
  const targets = computeTargets(ctx.user.profile, plan?.nutrition);
  ctx.user.session = { ...ctx.user.session, mode: "idle" };
  await updateUser(ctx.db, ctx.user._id, { profile: ctx.user.profile, session: ctx.user.session });
  await reply(ctx, t(lang, "mealplan_generating"));
  // Heavy (1 LLM call + cached USDA lookups) → defer past the webhook response.
  ctx.waitUntil(deliverMealPlan(ctx, targets));
}

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

export async function generateMealDay(
  ctx: MyContext,
  targets: NutritionTargets,
  mealsPerDay: number,
  excluded: string,
  likes: string,
  useAi: boolean,
  seedOffset: number,
): Promise<Meal[]> {
  return generateMealDayFor(ctx.env, ctx.db, ctx.user.lang, ctx.user.profile, ctx.user._id, targets, mealsPerDay, excluded, likes, useAi, seedOffset);
}

export function mealPlanSharedInputs(ctx: MyContext) {
  const p = ctx.user.profile;
  const excluded = [p.allergies, p.dietPrefs, p.foodDislikes]
    .filter((x) => x && x.toLowerCase() !== "none")
    .join("; ");
  return { p, excluded, likes: p.foodLikes ?? "" };
}

export async function deliverMealPlan(ctx: MyContext, targets: NutritionTargets, useAi = false) {
  const lang = ctx.user.lang;
  try {
    await ctx.replyWithChatAction("typing").catch(() => {});
    const mealsPerDay = 4;
    const { excluded, likes } = mealPlanSharedInputs(ctx);
    const { date } = localParts(ctx.user.profile.timezone);
    const display = await generateMealDay(ctx, targets, mealsPerDay, excluded, likes, useAi, 0);
    if (!display.length) throw new Error("no foods matched USDA/OFF");
    const doc: MealPlanDoc = { userId: ctx.user._id, week: 0, days: [{ label: date, meals: display }], targets, generatedAt: new Date() };
    await saveMealPlan(ctx.db, doc);
    await recordPlanSource(ctx.db, ctx.user._id, "meal", useAi ? "ai" : "template").catch(() => {});
    // A template menu is instant; offer a one-tap AI version. An AI menu just used Gemini.
    const kb = useAi ? menuBtn(lang) : mealActionsKb(lang);
    await reply(ctx, renderMealPlan(lang, doc), kb);
  } catch (err) {
    console.error("deliverMealPlan failed", ctx.user._id, err);
    // A rate-limited chain is "try later", not "generation failed" — align with onError's UX.
    const key = err instanceof RateLimitError ? "limit_hit" : "mealplan_failed";
    await reply(ctx, t(lang, key), menuBtn(lang)).catch(() => {});
  }
}

// A full week: rotate a handful of genuinely distinct template days across 7 calendar dates
// (round-robin) instead of the single day the default flow builds. Template-only (free, instant)
// -- generating 7 independent AI days would be 7x the cost for a feature whose whole point is
// reusing the SAME ingredients across days, which the rotation already gives for free.
export const WEEKLY_TEMPLATE_COUNT = 3;

export const WEEKLY_DAYS = 7;

export async function deliverWeeklyMealPlan(ctx: MyContext, targets: NutritionTargets) {
  const lang = ctx.user.lang;
  try {
    await ctx.replyWithChatAction("typing").catch(() => {});
    const mealsPerDay = 4;
    const { excluded, likes } = mealPlanSharedInputs(ctx);
    const templates = await Promise.all(
      Array.from({ length: WEEKLY_TEMPLATE_COUNT }, (_, i) => generateMealDay(ctx, targets, mealsPerDay, excluded, likes, false, i)),
    );
    const days: MealPlanDoc["days"] = [];
    for (let i = 0; i < WEEKLY_DAYS; i++) {
      const meals = templates[i % WEEKLY_TEMPLATE_COUNT];
      if (!meals.length) continue;
      const { date } = localParts(ctx.user.profile.timezone, new Date(Date.now() + i * 86400000));
      days.push({ label: date, meals });
    }
    if (!days.length) throw new Error("no foods matched USDA/OFF");
    const doc: MealPlanDoc = { userId: ctx.user._id, week: 0, days, targets, generatedAt: new Date() };
    await saveMealPlan(ctx.db, doc);
    await recordPlanSource(ctx.db, ctx.user._id, "meal", "template").catch(() => {});
    await reply(ctx, renderMealPlan(lang, doc), mealActionsKb(lang));
  } catch (err) {
    console.error("deliverWeeklyMealPlan failed", ctx.user._id, err);
    const key = err instanceof RateLimitError ? "limit_hit" : "mealplan_failed";
    await reply(ctx, t(lang, key), menuBtn(lang)).catch(() => {});
  }
}

export async function onMealWeekly(ctx: MyContext) {
  const lang = ctx.user.lang;
  await ctx.answerCallbackQuery().catch(() => {});
  const plan = await getActivePlan(ctx.db, ctx.user._id);
  const targets = computeTargets(ctx.user.profile, plan?.nutrition);
  await reply(ctx, t(lang, "mealplan_generating"));
  ctx.waitUntil(deliverWeeklyMealPlan(ctx, targets));
}

// "Generate with AI" button under a template meal plan → rebuild the menu via Gemini.
export async function onMealRegenAi(ctx: MyContext) {
  const lang = ctx.user.lang;
  await ctx.answerCallbackQuery().catch(() => {});
  const plan = await getActivePlan(ctx.db, ctx.user._id);
  const targets = computeTargets(ctx.user.profile, plan?.nutrition);
  await reply(ctx, t(lang, "mealplan_generating"));
  ctx.waitUntil(deliverMealPlan(ctx, targets, true));
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
