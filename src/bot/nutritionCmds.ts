// Food, steps and water commands: the food log and its edits, recent foods, steps and the water
// tracker. Split out of bot.ts (god-file split); bot.ts re-exports everything here.
import { InlineKeyboard } from "grammy";
import { logInfo } from "../log";
import type { Weekday } from "../types";
import { getActivePlan } from "../adapters/d1/v2Plans";
import { addWater, getStepLog, getWater, setWater, upsertStepLog } from "../adapters/d1/v2Tracking";
import { updateUser } from "../adapters/d1/v2Users";
import { appendMeals, getDayMeals, setDayMeals, getRecentFoods, deleteMealItem } from "../adapters/d1/v2Nutrition";
import { escapeHtml, t } from "../locales/i18n";
import { aiJSON } from "../ai";
import * as P from "../ai/prompts";
import { localParts } from "../domain/localTime";
import { parseSteps } from "../domain/workoutText";
import { num, verifyItems } from "../features/nutrition/nutritionLog";
import { isoDateMinus } from "../features/gamification/boards";
import { showEveningSurvey } from "./survey";
import { menuBtn } from "./keyboards";
import { deferAi } from "./aiDefer";
import { progressBar, resolveWaterGoal } from "../domain/challenges";
import { clearEditOwner, reply, setMode, type MyContext } from "../adapters/telegram/context";

export async function cmdNutrition(ctx: MyContext) {
  await setMode(ctx, "nutrition");
  await showFoodLog(ctx);
}

// Today's logged food with per-item KБЖУ + delete buttons, day totals vs target, and the add hint.
// Editing = delete the wrong item (🗑) and re-send it. The mode stays "nutrition" so any text/photo adds.
export async function showFoodLog(ctx: MyContext) {
  const lang = ctx.user.lang;
  const { date, weekday } = localParts(ctx.user.profile.timezone);
  const meals = await getDayMeals(ctx.db, ctx.user._id, date);
  if (!meals.length) {
    await reply(ctx, t(lang, "nutrition_prompt"), new InlineKeyboard().text(t(lang, "food_recent_btn"), "food:recent"));
    return;
  }
  const tot = meals.reduce(
    (a, m) => ({ kcal: a.kcal + num(m.kcal), p: a.p + num(m.protein), f: a.f + num(m.fats), c: a.c + num(m.carbs) }),
    { kcal: 0, p: 0, f: 0, c: 0 },
  );
  const plan = await getActivePlan(ctx.db, ctx.user._id);
  const trainingDays = ctx.user.profile.trainingWeekdays ?? plan?.split.map((d) => d.weekday) ?? [];
  const isTraining = trainingDays.includes(weekday as Weekday);
  const targets = (!isTraining && plan?.restDayNutrition) || ctx.user.nutrition;
  const lines = meals
    .map((m, i) => {
      const g = num(m.grams);
      const wt = g ? ` · ${g} ${t(lang, "unit_g")}` : "";
      const alc = alcoholKcalOf(m);
      const alcTag = alc > 0 ? ` · 🍷 ${alc} ${t(lang, "unit_kcal")}` : "";
      return `${i + 1}. ${escapeHtml(cleanFoodName(m.desc))}${wt} — ${num(m.kcal)} ${t(lang, "unit_kcal")} (Б${num(m.protein)}/Ж${num(m.fats)}/В${num(m.carbs)})${alcTag}`;
    })
    .join("\n");
  const totAlc = meals.reduce((s, m) => s + alcoholKcalOf(m), 0);
  const totals = targets
    ? t(lang, "foodlog_totals", { tkcal: tot.kcal, goalkcal: targets.calories, tp: tot.p, goalp: targets.protein, tf: tot.f, goalf: targets.fats, tc: tot.c, goalc: targets.carbs })
    : t(lang, "foodlog_totals_notarget", { tkcal: tot.kcal, tp: tot.p, tf: tot.f, tc: tot.c });
  // "Of which alcohol" is a widely-used field on wrappers; showing it separately keeps macro
  // percentages honest (ethanol has kcal but is neither P/F/C).
  const alcLine = totAlc > 0 ? `\n${t(lang, "foodlog_alcohol_line", { kcal: totAlc })}` : "";
  const kb = new InlineKeyboard();
  meals.forEach((m, i) => kb.text(`${i + 1}. ${cleanFoodName(m.desc)}`.slice(0, 50), `food:item:${i}`).row());
  kb.text(t(lang, "food_recent_btn"), "food:recent");
  if (targets) kb.text(t(lang, "macros_suggest_btn"), "food:suggest");
  await reply(ctx, `${t(lang, "foodlog_title", { date })}\n${lines}\n\n${totals}${alcLine}\n\n${t(lang, "foodlog_hint")}`, kb);
}

// One-tap re-log of recent foods (last 21 days, deduped). Stored in session for index → item.
export async function showRecentFoods(ctx: MyContext) {
  const lang = ctx.user.lang;
  const { date } = localParts(ctx.user.profile.timezone);
  const foods = await getRecentFoods(ctx.db, ctx.user._id, isoDateMinus(date, 21), 12);
  if (!foods.length) { await reply(ctx, t(lang, "food_recent_none")); return; }
  ctx.user.session = { ...ctx.user.session, recentFoods: foods };
  await updateUser(ctx.db, ctx.user._id, { session: ctx.user.session });
  const kb = new InlineKeyboard();
  foods.forEach((m, i) => kb.text(`➕ ${cleanFoodName(m.desc)} · ${num(m.kcal)}`.slice(0, 48), `relog:${i}`).row());
  kb.text(t(lang, "back"), "menu:nutrition");
  await reply(ctx, t(lang, "food_recent_title"), kb);
}

export async function onReLog(ctx: MyContext, index: number) {
  const item = (ctx.user.session.recentFoods ?? [])[index];
  if (!item) { await showFoodLog(ctx); return; }
  const { date } = localParts(ctx.user.profile.timezone);
  await appendMeals(ctx.db, ctx.user._id, date, [item]);
  logInfo("nutrition_logged", { method: "recent" });
  await showFoodLog(ctx);
}

// Per-item edit submenu: change weight, change the product itself, or delete.
export async function showFoodItem(ctx: MyContext, index: number) {
  const lang = ctx.user.lang;
  const { date } = localParts(ctx.user.profile.timezone);
  const m = (await getDayMeals(ctx.db, ctx.user._id, date))[index];
  if (!m) { await showFoodLog(ctx); return; }
  const g = num(m.grams);
  const info = `${escapeHtml(cleanFoodName(m.desc))}${g ? ` · ${g} ${t(lang, "unit_g")}` : ""} — ${num(m.kcal)} ${t(lang, "unit_kcal")} (Б${num(m.protein)}/Ж${num(m.fats)}/В${num(m.carbs)})`;
  const kb = new InlineKeyboard()
    .text(t(lang, "food_edit_weight"), `food:wt:${index}`)
    .text(t(lang, "food_edit_product"), `food:prod:${index}`)
    .row()
    .text(t(lang, "food_delete"), `food:del:${index}`)
    .text(t(lang, "back"), "menu:nutrition");
  await reply(ctx, info, kb);
}

// Strip a trailing weight token ("~250 г" / "(250 g)") from a food desc so the grams shown stay in sync.
export function cleanFoodName(desc: string): string {
  return desc.replace(/[~(]?\s*\d+[.,]?\d*\s*(г|g|грам\w*|gram\w*)\.?\)?\s*$/iu, "").trim() || desc;
}

// Ethanol energy in a meal item, inferred from the kcal surplus over 4P + 9F + 4C. Rounded to
// the nearest 5 kcal and clamped ≥ 0. The AI prompt is instructed to include ethanol kcal in
// `kcal` while keeping protein/fats/carbs to non-alcohol parts, so this simple derivation gives
// a stable "🍷 alcohol kcal" line without a new DB column. Small residuals (< 15 kcal) are
// treated as macro-rounding noise, not alcohol — otherwise every meal would show a spurious tag.
export function alcoholKcalOf(m: { kcal?: number | string; protein?: number | string; fats?: number | string; carbs?: number | string }): number {
  const kcal = num(m.kcal);
  const p = num(m.protein);
  const f = num(m.fats);
  const c = num(m.carbs);
  const macroKcal = p * 4 + f * 9 + c * 4;
  const surplus = kcal - macroKcal;
  if (surplus < 15) return 0;
  return Math.round(surplus / 5) * 5;
}

export async function onFoodDelete(ctx: MyContext, index: number) {
  const { date } = localParts(ctx.user.profile.timezone);
  await deleteMealItem(ctx.db, ctx.user._id, date, index);
  await showFoodLog(ctx);
}

export async function onFoodEditWeight(ctx: MyContext, index: number) {
  const lang = ctx.user.lang;
  const { date } = localParts(ctx.user.profile.timezone);
  const item = (await getDayMeals(ctx.db, ctx.user._id, date))[index];
  if (!item) { await showFoodLog(ctx); return; }
  if (!num(item.grams)) { await reply(ctx, t(lang, "food_wt_legacy")); return; } // legacy row: no grams to scale from
  ctx.user.session = { mode: "food_wt", awaitText: String(index) };
  await updateUser(ctx.db, ctx.user._id, { session: ctx.user.session });
  await reply(ctx, t(lang, "food_wt_prompt", { name: escapeHtml(cleanFoodName(item.desc)), g: num(item.grams) }));
}

// User typed a new weight (g) for the item being edited → scale КБЖУ proportionally and re-show.
export async function handleFoodWeight(ctx: MyContext, text: string) {
  const lang = ctx.user.lang;
  const { date } = localParts(ctx.user.profile.timezone);
  const idx = Number(ctx.user.session.awaitText);
  const n = parseInt(text.replace(/[^\d]/g, ""), 10);
  if (!Number.isFinite(n) || n <= 0 || n > 5000) { await reply(ctx, t(lang, "food_wt_invalid")); return; }
  const meals = await getDayMeals(ctx.db, ctx.user._id, date);
  const item = meals[idx];
  if (!item || !num(item.grams)) { await setMode(ctx, "nutrition"); await showFoodLog(ctx); return; }
  const f = n / num(item.grams);
  meals[idx] = {
    ...item,
    grams: n,
    desc: cleanFoodName(item.desc),
    kcal: Math.round(num(item.kcal) * f),
    protein: Math.round(num(item.protein) * f),
    fats: Math.round(num(item.fats) * f),
    carbs: Math.round(num(item.carbs) * f),
  };
  await setDayMeals(ctx.db, ctx.user._id, date, meals);
  await setMode(ctx, "nutrition");
  await showFoodLog(ctx);
}

export async function onFoodEditProduct(ctx: MyContext, index: number) {
  const lang = ctx.user.lang;
  const { date } = localParts(ctx.user.profile.timezone);
  if (!(await getDayMeals(ctx.db, ctx.user._id, date))[index]) { await showFoodLog(ctx); return; }
  ctx.user.session = { mode: "food_prod", awaitText: String(index) };
  await updateUser(ctx.db, ctx.user._id, { session: ctx.user.session });
  await reply(ctx, t(lang, "food_prod_prompt"));
}

// User typed a replacement product (and weight) → re-estimate and swap it in for that position.
export async function handleFoodProduct(ctx: MyContext, text: string) {
  const { date } = localParts(ctx.user.profile.timezone);
  const idx = Number(ctx.user.session.awaitText);
  // Leave food_prod BEFORE deferring — a second message during the ~26 s AI run must route
  // as a normal nutrition entry, not re-enter this handler with the same idx (racing splices).
  await setMode(ctx, "nutrition");
  await ctx.replyWithChatAction("typing").catch(() => {});
  deferAi(ctx, "nutrition", async () => {
    const est = await aiJSON<P.NutritionEstimate>(ctx.env, {
      system: P.nutritionSystem(ctx.user.lang),
      user: text,
      schema: P.NUTRITION_SCHEMA,
      temperature: 0.3,
      kind: "nutrition",
      db: ctx.db,
      userId: ctx.user._id,
    });
    const { final } = await verifyItems(ctx, est.items);
    const meals = await getDayMeals(ctx.db, ctx.user._id, date);
    if (final.length && meals[idx]) {
      meals.splice(idx, 1, ...final); // replace that position with the re-estimated item(s)
      await setDayMeals(ctx.db, ctx.user._id, date, meals);
    }
    await showFoodLog(ctx);
  });
}

export async function cmdSteps(ctx: MyContext) {
  await clearEditOwner(ctx);
  const lang = ctx.user.lang;
  await setMode(ctx, "steps_log");
  const { date } = localParts(ctx.user.profile.timezone);
  const logged = await getStepLog(ctx.db, ctx.user._id, date);
  const plan = await getActivePlan(ctx.db, ctx.user._id);
  const target = plan?.stepsTarget;
  const status = logged
    ? t(lang, "steps_today", { steps: logged }) + " "
    : "";
  const goal = target ? t(lang, "steps_goal", { steps: target }) + " " : "";
  await reply(ctx, status + goal + t(lang, "steps_prompt"));
}

export async function handleStepsLog(ctx: MyContext, text: string) {
  const lang = ctx.user.lang;
  const steps = parseSteps(text);
  if (steps === undefined) {
    await reply(ctx, t(lang, "steps_unreadable"));
    return;
  }
  const { date } = localParts(ctx.user.profile.timezone);
  await upsertStepLog(ctx.db, ctx.user._id, date, steps);
  await setMode(ctx, "idle");
  const plan = await getActivePlan(ctx.db, ctx.user._id);
  const target = plan?.stepsTarget;
  let line = t(lang, "steps_saved", { steps });
  if (target) {
    const left = target - steps;
    line +=
      left > 0
        ? " " + t(lang, "steps_left", { steps: left })
        : " " + t(lang, "steps_hit");
  }
  await reply(ctx, line, menuBtn(lang));
  if (ctx.user.session.survey) await showEveningSurvey(ctx);
}

// Daily water goal in ml: ~35 ml per kg of bodyweight, rounded to 100, floored at 1500; 2500 default.
// Water goal moved to domain/challenges (waterGoalMl) — shared with the Mini App; this thin
// wrapper keeps the many ctx-based call sites unchanged.
export function waterGoalFor(ctx: MyContext): number {
  return resolveWaterGoal(ctx.user.profile);
}

export async function cmdWater(ctx: MyContext) {
  await clearEditOwner(ctx);
  await showWater(ctx);
}

export async function showWater(ctx: MyContext) {
  const lang = ctx.user.lang;
  const { date } = localParts(ctx.user.profile.timezone);
  const ml = (await getWater(ctx.db, ctx.user._id, date)) ?? 0;
  const goal = waterGoalFor(ctx);
  const pct = Math.min(100, Math.round((ml / goal) * 100));
  const body =
    t(lang, "water_title", { ml, goal, pct }) +
    "\n" +
    progressBar(pct) +
    (ml >= goal ? `\n\n${t(lang, "water_hit")}` : "");
  const kb = new InlineKeyboard()
    .text(t(lang, "water_add_250"), "water:add:250")
    .text(t(lang, "water_add_500"), "water:add:500")
    .text(t(lang, "water_add_750"), "water:add:750")
    .row()
    .text(t(lang, "water_reset"), "water:reset")
    .text(t(lang, "menu_open"), "menu:open");
  await reply(ctx, body, kb);
}

export async function onWaterAction(ctx: MyContext, action: string) {
  const { date } = localParts(ctx.user.profile.timezone);
  if (action === "reset") {
    await setWater(ctx.db, ctx.user._id, date, 0);
  } else if (action.startsWith("add:")) {
    const ml = Number(action.slice("add:".length));
    if (Number.isFinite(ml) && ml > 0) await addWater(ctx.db, ctx.user._id, date, ml);
  }
  await showWater(ctx);
  if (ctx.user.session.survey) await showEveningSurvey(ctx);
}

// ===================== Challenges =====================
// challengeData/challengeTitle/cmdChallenges/showChallengePicker/onChallengeJoin moved to
// features/gamification/challenges.ts; re-exported above so existing `from "./bot"` imports
// (router.ts) keep working.
