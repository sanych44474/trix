// AI food logging: text/photo estimation, USDA/OFF/user-correction verification against the
// AI's guess, the meal-confirmation card (photo logging only — text logs straight through) and
// its per-item edit/portion-scale sub-flows. Part of the nutrition feature slice (roadmap item
// 1); bot.ts's barrel seam still applies: `export * from "./features/nutrition/nutritionLog"`.
import { InlineKeyboard } from "grammy";
import { logInfo } from "../../log";
import type { Weekday } from "../../types";
import { type InlineImage, aiJSON, aiVisionJSON } from "../../ai";
import * as P from "../../ai/prompts";
import { getActivePlan } from "../../adapters/d1/v2Plans";
import { updateUser } from "../../adapters/d1/v2Users";
import { appendMeals } from "../../adapters/d1/v2Nutrition";
import { scaleMealEntry } from "../../domain/mealplan";
import { localParts } from "../../domain/localTime";
import { escapeHtml, t } from "../../locales/i18n";
import { deferAi, maybeCelebrateLevel } from "../../bot/aiDefer";
import { showEveningSurvey } from "../../bot/survey";
import { reactToUser, type MyContext, reply, setMode } from "../../adapters/telegram/context";
import { cleanFoodName } from "../../bot/nutritionCmds";
import { menuBtn } from "../../bot/keyboards";

import { num, verifyItems } from "./verifyItems";

export { num, verifyItems };

export async function logMeal(ctx: MyContext, items: P.NutritionItem[], method: "text" | "photo") {
  const lang = ctx.user.lang;
  const { final, verified, source } = await verifyItems(ctx.db, ctx.env, ctx.user._id, items);
  const sum = final.reduce(
    (a, i) => ({ kcal: a.kcal + i.kcal, p: a.p + i.protein, f: a.f + i.fats, c: a.c + i.carbs }),
    { kcal: 0, p: 0, f: 0, c: 0 },
  );
  // Nothing recognized (empty or all-zero) → ask to rephrase, don't log junk.
  if (!final.length || sum.kcal <= 0) {
    await reply(ctx, t(lang, "nutrition_unreadable"));
    return;
  }
  await reactToUser(ctx, "✍"); // the meal they sent (text or photo) is logged

  const { date } = localParts(ctx.user.profile.timezone);
  // Append meals and get the full day's meals back to compute totals.
  // Coerce stored values too — older rows may predate the validation fix.
  const dayMeals = await appendMeals(ctx.db, ctx.user._id, date, final);
  logInfo("nutrition_logged", { method });
  const tot = dayMeals.reduce(
    (a, m) => ({
      kcal: a.kcal + num(m.kcal),
      p: a.p + num(m.protein),
      f: a.f + num(m.fats),
      c: a.c + num(m.carbs),
    }),
    { kcal: 0, p: 0, f: 0, c: 0 },
  );

  // KBJU split: on a rest day use the plan's rest-day macros if present, else training-day.
  const { weekday } = localParts(ctx.user.profile.timezone);
  const plan = await getActivePlan(ctx.db, ctx.user._id);
  const trainingDays = ctx.user.profile.trainingWeekdays ?? plan?.split.map((d) => d.weekday) ?? [];
  const isTrainingDay = trainingDays.includes(weekday as Weekday);
  const targets = (!isTrainingDay && plan?.restDayNutrition) || ctx.user.nutrition;
  if (!targets) {
    await reply(ctx, t(lang, "nutrition_no_targets"));
    return;
  }
  const dayTag = plan?.restDayNutrition
    ? t(lang, isTrainingDay ? "kbju_training_day" : "kbju_rest_day") + " "
    : "";
  const remaining = targets.calories - tot.kcal;
  let advice =
    dayTag +
    (remaining > 0
      ? lang === "uk"
        ? `Залишилось ${remaining} ккал на сьогодні.`
        : `${remaining} kcal left for today.`
      : lang === "uk"
        ? `Ліміт калорій вичерпано (${-remaining} ккал понад ціль).`
        : `Calorie target reached (${-remaining} kcal over).`);
  if (verified > 0) advice += t(lang, "verified_suffix", { n: verified, total: final.length, src: source });

  // List every recognised item so the user sees all foods (USDA-verified or AI-estimated).
  const macros = (p: number, f: number, c: number) => (lang === "uk" ? `Б${p}/Ж${f}/В${c}` : `P${p}/F${f}/C${c}`);
  const itemsStr = final
    .map((i) => `• ${escapeHtml(i.desc)} — ${i.kcal} ${t(lang, "unit_kcal")} (${macros(i.protein, i.fats, i.carbs)})`)
    .join("\n");

  await reply(
    ctx,
    itemsStr +
      "\n\n" +
      t(lang, "nutrition_logged", {
        kcal: sum.kcal, p: sum.p, f: sum.f, c: sum.c,
        tkcal: tot.kcal, goalkcal: targets.calories,
        tp: tot.p, goalp: targets.protein,
        tf: tot.f, goalf: targets.fats,
        tc: tot.c, goalc: targets.carbs,
        advice,
      }),
    new InlineKeyboard().text(t(lang, "foodlog_view_btn"), "menu:nutrition").row().text(t(lang, "menu_open"), "menu:open"),
  );
  await maybeCelebrateLevel(ctx);
  if (ctx.user.session.survey) await showEveningSurvey(ctx);
}

export async function handleNutrition(ctx: MyContext, text: string) {
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
    await logMeal(ctx, est.items, "text");
  });
}

export async function handlePhotoMeal(ctx: MyContext, images: InlineImage[]) {
  const lang = ctx.user.lang;
  if (!ctx.user.onboarded) {
    await reply(ctx, t(lang, "not_onboarded"));
    return;
  }
  await ctx.replyWithChatAction("typing").catch(() => {});
  deferAi(ctx, "nutrition", async () => {
    const est = await aiVisionJSON<P.NutritionEstimate>(ctx.env, {
      system: P.nutritionVisionSystem(lang),
      user: ctx.message?.caption?.trim() || "Estimate the calories and macros of this meal.",
      images,
      schema: P.NUTRITION_SCHEMA,
      temperature: 0.3,
      kind: "nutrition_photo",
      db: ctx.db,
      userId: ctx.user._id,
    });
    // Photos are guesses (which grain? what portion?) — confirm with the user before logging.
    await showMealConfirm(ctx, est.items);
  });
}

// Show what was recognised from a photo and ask the user to confirm / fix the weight & product
// before it's logged. Typing a correction (or tapping ✏️) re-estimates and re-confirms.
export async function showMealConfirm(ctx: MyContext, items: P.NutritionItem[]) {
  const lang = ctx.user.lang;
  const clean = (items ?? []).filter((i) => i.kcal > 0);
  if (!clean.length) {
    await setMode(ctx, "idle");
    await reply(ctx, t(lang, "nutrition_unreadable"));
    return;
  }
  ctx.user.session = { mode: "meal_confirm", pendingMeal: clean };
  await updateUser(ctx.db, ctx.user._id, { session: ctx.user.session });
  const list = clean.map((i) => `• ${escapeHtml(i.desc)} — ~${i.grams} ${t(lang, "unit_g")} · ${i.kcal} ${t(lang, "unit_kcal")}`).join("\n");
  const total = clean.reduce((s, i) => s + i.kcal, 0);
  const kb = new InlineKeyboard()
    .text(t(lang, "meal_confirm_ok"), "meal:ok")
    .row()
    // One-tap portion correction — scale the whole estimate (the bot guessed the grams).
    .text(t(lang, "meal_portion_half"), "meal:x:0.5")
    .text(t(lang, "meal_portion_15"), "meal:x:1.5")
    .text(t(lang, "meal_portion_2"), "meal:x:2")
    .row();
  // Per-item editing (remove/replace a single analyzed item) — only worth a button with >1 item,
  // but allow it for one too (e.g. to fix a single misread item like "пінопласт").
  kb.text(t(lang, "meal_edit_btn"), "meal:edit").row();
  kb.text(t(lang, "meal_confirm_fix"), "meal:fix").text(t(lang, "meal_confirm_cancel"), "meal:cancel");
  await reply(ctx, t(lang, "meal_confirm_q", { list, total }), kb);
}

// Per-item editor for an analyzed meal: list each item; tap one to remove or replace it.
export async function showMealItemEditor(ctx: MyContext) {
  const lang = ctx.user.lang;
  const items = ctx.user.session.pendingMeal ?? [];
  if (!items.length) { await onMealConfirm(ctx, "cancel"); return; }
  const kb = new InlineKeyboard();
  items.forEach((m, i) => kb.text(`${i + 1}. ${cleanFoodName(m.desc)}`.slice(0, 50), `mealitem:${i}`).row());
  kb.text(t(lang, "meal_back"), "meal:back");
  await reply(ctx, t(lang, "meal_items_title"), kb);
}

export async function onMealItemMenu(ctx: MyContext, i: number) {
  const lang = ctx.user.lang;
  const m = (ctx.user.session.pendingMeal ?? [])[i];
  if (!m) { await showMealItemEditor(ctx); return; }
  const kb = new InlineKeyboard()
    .text(t(lang, "meal_item_repl"), `mealrepl:${i}`)
    .text(t(lang, "meal_item_del"), `mealdel:${i}`)
    .row()
    .text(t(lang, "meal_back"), "meal:edit");
  const info = `${escapeHtml(cleanFoodName(m.desc))} — ~${num(m.grams)} ${t(lang, "unit_g")} · ${num(m.kcal)} ${t(lang, "unit_kcal")}`;
  await reply(ctx, info, kb);
}

export async function onMealItemDelete(ctx: MyContext, i: number) {
  const items = (ctx.user.session.pendingMeal ?? []).slice();
  if (i < 0 || i >= items.length) { await showMealItemEditor(ctx); return; }
  items.splice(i, 1);
  if (!items.length) {
    await setMode(ctx, "idle");
    await reply(ctx, t(ctx.user.lang, "meal_all_removed"), menuBtn(ctx.user.lang));
    return;
  }
  await showMealConfirm(ctx, items); // re-render the confirm card with the item gone
}

export async function onMealItemReplace(ctx: MyContext, i: number) {
  const lang = ctx.user.lang;
  const items = ctx.user.session.pendingMeal ?? [];
  if (!items[i]) { await showMealItemEditor(ctx); return; }
  ctx.user.session = { mode: "meal_item", pendingMeal: items, awaitText: String(i) };
  await updateUser(ctx.db, ctx.user._id, { session: ctx.user.session });
  await reply(ctx, t(lang, "meal_item_fix_prompt", { name: escapeHtml(cleanFoodName(items[i].desc)) }));
}

// User typed the correction for ONE analyzed item → re-estimate just that item and splice it in.
export async function handleMealItemFix(ctx: MyContext, text: string) {
  const i = Number(ctx.user.session.awaitText);
  const items = (ctx.user.session.pendingMeal ?? []).slice();
  if (!Number.isInteger(i) || !items[i]) { await showMealConfirm(ctx, items); return; }
  await ctx.replyWithChatAction("typing").catch(() => {});
  const est = await aiJSON<P.NutritionEstimate>(ctx.env, {
    system: P.nutritionSystem(ctx.user.lang),
    user: text,
    schema: P.NUTRITION_SCHEMA,
    temperature: 0.3,
    kind: "nutrition",
    db: ctx.db,
    userId: ctx.user._id,
  });
  const repl = (est.items ?? []).filter((x) => x.kcal > 0);
  if (repl.length) items.splice(i, 1, ...repl);
  await showMealConfirm(ctx, items);
}

// Scale the pending photo-meal by a factor (portion buttons) and re-show the confirmation card.
// Factors compound on the current estimate, so ½ then 2× returns to the original.
export async function onMealPortion(ctx: MyContext, factor: number) {
  const items = ctx.user.session.pendingMeal;
  if (!items?.length || !(factor > 0)) return;
  const scaled = items.map((i) => scaleMealEntry(i, factor));
  await showMealConfirm(ctx, scaled);
}

// User typed a correction while confirming a meal — re-estimate from their text and re-confirm.
export async function handleMealClarify(ctx: MyContext, text: string) {
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
    await showMealConfirm(ctx, est.items);
  });
}

export async function onMealConfirm(ctx: MyContext, action: "ok" | "fix" | "cancel") {
  const lang = ctx.user.lang;
  if (action === "fix") {
    await reply(ctx, t(lang, "meal_fix_prompt"));
    return; // stay in meal_confirm; their next message goes through handleMealClarify
  }
  const items = ctx.user.session.pendingMeal;
  await setMode(ctx, "idle");
  if (action === "cancel") {
    await reply(ctx, t(lang, "meal_cancelled"), menuBtn(lang));
    return;
  }
  if (items?.length) await logMeal(ctx, items, "photo");
  else await reply(ctx, t(lang, "nutrition_unreadable"));
}
