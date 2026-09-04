// Solo self-correct: a solo athlete rewrites a past workout or nutrition day themselves,
// mirroring the trainer's client-log-edit flow but scoped to ctx.user._id — no waiting for a
// coach to fix a wrong weight or meal logged yesterday. Both surfaces list the same 30-day
// window; picking a day shows a summary + a "Rewrite" button that re-parses the whole day in
// one message. Extracted from bot.ts (god-file split; same barrel seam via bot.ts's
// `export * from "./bot/logSelfEdit"`).
import { InlineKeyboard } from "grammy";
import type { MealEntry, SetEntry } from "../types";
import * as P from "../ai/prompts";
import { aiJSON } from "../ai";
import { getActivePlan, getDayMeals, getWorkoutLog, listStrength, nutritionLogsSince, putUserFoodCorrection, setDayMeals, updateUser, upsertStrengthRecord, upsertWorkoutLog, workoutLogsSince } from "../db/repos";
import { per100gCorrectionFrom } from "../domain/mealplan";
import { bestSetForMetric, getPlanDay, metricOfSets, normalizeExercise, parseWorkoutText, formatSetEntry } from "../domain/progression";
import { escapeHtml, t } from "../locales/i18n";
import { num } from "./nutritionLog";
import { weekdayOf } from "./calendar";
import { localCutoff } from "./report";
import { type MyContext, alcoholKcalOf, cleanFoodName, reply, setMode } from "../bot";

export async function showMyLogHub(ctx: MyContext, tab: "workout" | "nutrition" = "workout") {
  const lang = ctx.user.lang;
  const tz = ctx.user.profile.timezone;
  const cutoff = localCutoff(tz, 30);
  const kb = new InlineKeyboard()
    .text(tab === "workout" ? `• ${t(lang, "mylog_tab_workout")} •` : t(lang, "mylog_tab_workout"), "mylog:tab:w")
    .text(tab === "nutrition" ? `• ${t(lang, "mylog_tab_nutrition")} •` : t(lang, "mylog_tab_nutrition"), "mylog:tab:n")
    .row();
  if (tab === "workout") {
    const logs = await workoutLogsSince(ctx.db, ctx.user._id, cutoff);
    const recent = [...logs].reverse().slice(0, 12);
    if (!recent.length) {
      kb.text(t(lang, "back"), "menu:progress");
      await reply(ctx, t(lang, "mylog_none"), kb);
      return;
    }
    for (const w of recent) {
      const n = w.exercises.filter((e) => !e.skipped).length;
      kb.text(`${w.completed ? "✅" : "✖️"} ${w.date} · ${t(lang, "clog_n_ex", { n })}`.slice(0, 60), `mylog:w:${w.date}`).row();
    }
  } else {
    const logs = await nutritionLogsSince(ctx.db, ctx.user._id, cutoff);
    const recent = [...logs].reverse().slice(0, 12);
    if (!recent.length) {
      kb.text(t(lang, "back"), "menu:progress");
      await reply(ctx, t(lang, "mylog_none"), kb);
      return;
    }
    for (const nlog of recent) {
      const kcal = (nlog.meals ?? []).reduce((s, m) => s + num(m.kcal), 0);
      const items = (nlog.meals ?? []).length;
      kb.text(`🍽 ${nlog.date} · ${items} · ${kcal} ${t(lang, "unit_kcal")}`.slice(0, 60), `mylog:n:${nlog.date}`).row();
    }
  }
  kb.text(t(lang, "back"), "menu:progress");
  await reply(ctx, t(lang, "mylog_pick"), kb);
}

export async function showMyLogWorkoutDay(ctx: MyContext, date: string) {
  const lang = ctx.user.lang;
  const log = await getWorkoutLog(ctx.db, ctx.user._id, date);
  const done = (log?.exercises ?? []).filter((e) => !e.skipped);
  let body = t(lang, "mylog_workout_day", { date });
  body += done.length
    ? "\n" + done.map((e) => `• ${escapeHtml(e.name)}: ${e.setsDone.map(formatSetEntry).join(", ") || "—"}`).join("\n")
    : "\n" + t(lang, "mylog_day_empty");
  const plan = await getActivePlan(ctx.db, ctx.user._id);
  const planDay = plan ? getPlanDay(plan, weekdayOf(date)) : undefined;
  if (planDay) body += "\n\n" + t(lang, "mylog_planned", { n: planDay.exercises.length, list: planDay.exercises.map((e) => e.name).join(", ") });
  const kb = new InlineKeyboard()
    .text(t(lang, "mylog_rewrite_workout_btn"), `mylogedit:w:${date}`)
    .row()
    .text(t(lang, "back"), "mylog:tab:w");
  await reply(ctx, body, kb);
}

export async function showMyLogNutritionDay(ctx: MyContext, date: string) {
  const lang = ctx.user.lang;
  const meals = await getDayMeals(ctx.db, ctx.user._id, date);
  const tot = meals.reduce(
    (a, m) => ({ kcal: a.kcal + num(m.kcal), p: a.p + num(m.protein), f: a.f + num(m.fats), c: a.c + num(m.carbs) }),
    { kcal: 0, p: 0, f: 0, c: 0 },
  );
  let body = t(lang, "mylog_nutrition_day", { date });
  const kb = new InlineKeyboard();
  if (meals.length) {
    body += "\n" + meals
      .map((m, i) => {
        const g = num(m.grams);
        const wt = g ? ` · ${g} ${t(lang, "unit_g")}` : "";
        const alc = alcoholKcalOf(m);
        const alcTag = alc > 0 ? ` · 🍷 ${alc} ${t(lang, "unit_kcal")}` : "";
        return `${i + 1}. ${escapeHtml(cleanFoodName(m.desc))}${wt} — ${num(m.kcal)} ${t(lang, "unit_kcal")} (Б${num(m.protein)}/Ж${num(m.fats)}/В${num(m.carbs)})${alcTag}`;
      })
      .join("\n");
    body += `\n\n<b>Σ</b> ${tot.kcal} ${t(lang, "unit_kcal")} (Б${tot.p}/Ж${tot.f}/В${tot.c})`;
    const dayAlc = meals.reduce((s, m) => s + alcoholKcalOf(m), 0);
    if (dayAlc > 0) body += `\n${t(lang, "foodlog_alcohol_line", { kcal: dayAlc })}`;
    // One ✏️ button per item so user can correct macros inline.
    const editBtn = t(lang, "meal_macros_edit_btn");
    meals.forEach((_, i) => {
      kb.text(`${editBtn} ${i + 1}`, `nlog:medit:${date}:${i}`);
      if (i % 3 === 2) kb.row(); // up to 3 buttons per row
    });
    kb.row();
  } else {
    body += "\n" + t(lang, "mylog_day_empty");
  }
  kb.text(t(lang, "mylog_rewrite_nutrition_btn"), `mylogedit:n:${date}`)
    .row()
    .text(t(lang, "back"), "mylog:tab:n");
  await reply(ctx, body, kb);
}

export async function startMyLogWorkoutEdit(ctx: MyContext, date: string) {
  const lang = ctx.user.lang;
  ctx.user.session = { mode: "edit_own_log", awaitText: date };
  await updateUser(ctx.db, ctx.user._id, { session: ctx.user.session });
  await reply(ctx, t(lang, "mylog_rewrite_workout_prompt", { date }));
}

export async function handleMyLogWorkoutEdit(ctx: MyContext, text: string) {
  const lang = ctx.user.lang;
  const date = ctx.user.session.awaitText;
  if (!date) { await setMode(ctx, "idle"); return; }
  const sets = parseWorkoutText(text);
  if (!sets.length) { await reply(ctx, t(lang, "log_unreadable")); return; } // stay in mode, let them retry
  await setMode(ctx, "idle");
  const wd = weekdayOf(date);
  const plan = await getActivePlan(ctx.db, ctx.user._id);
  const existing = await listStrength(ctx.db, ctx.user._id);
  const candidates = [
    ...(plan?.split.flatMap((d) => d.exercises.map((e) => e.name)) ?? []),
    ...(plan?.split.flatMap((d) => d.exercises.map((e) => e.canonicalName).filter((n): n is string => !!n)) ?? []),
    ...existing.map((r) => r.exercise),
  ];
  const byExercise = new Map<string, SetEntry[]>();
  const rpeByExercise = new Map<string, number>();
  for (const s of sets) {
    const name = normalizeExercise(s.exercise, candidates);
    const arr = byExercise.get(name) ?? [];
    arr.push({
      reps: s.reps, weight: s.weight,
      ...(typeof s.seconds === "number" ? { seconds: s.seconds } : {}),
      ...(typeof s.meters === "number" ? { meters: s.meters } : {}),
      ...(typeof s.rpe === "number" ? { rpe: s.rpe } : {}),
    });
    byExercise.set(name, arr);
    if (typeof s.rpe === "number") rpeByExercise.set(name, Math.max(rpeByExercise.get(name) ?? 0, s.rpe));
  }
  const exercises = [...byExercise.entries()].map(([name, setsDone]) => ({ name, setsDone, skipped: false, ...(rpeByExercise.has(name) ? { rpe: rpeByExercise.get(name)! } : {}) }));
  await upsertWorkoutLog(ctx.db, ctx.user._id, date, wd, exercises, true, text);
  // Keep strength records in sync with the corrected log — same rule as the trainer flow.
  for (const [name, setsDone] of byExercise) {
    const metric = metricOfSets(setsDone);
    const best = bestSetForMetric(setsDone, metric);
    if (best) await upsertStrengthRecord(ctx.db, ctx.user._id, name, { metric, weight: best.weight, reps: best.reps, seconds: best.seconds, meters: best.meters }, date, rpeByExercise.get(name)).catch(() => {});
  }
  await reply(ctx, t(lang, "mylog_workout_saved", { n: exercises.length }));
  await showMyLogWorkoutDay(ctx, date);
}

export async function startMyLogNutritionEdit(ctx: MyContext, date: string) {
  const lang = ctx.user.lang;
  ctx.user.session = { mode: "edit_own_nutrition", awaitText: date };
  await updateUser(ctx.db, ctx.user._id, { session: ctx.user.session });
  await reply(ctx, t(lang, "mylog_rewrite_nutrition_prompt", { date }));
}

export async function handleMyLogNutritionEdit(ctx: MyContext, text: string) {
  const lang = ctx.user.lang;
  const date = ctx.user.session.awaitText;
  if (!date) { await setMode(ctx, "idle"); return; }
  await ctx.replyWithChatAction("typing").catch(() => {});
  let est: P.NutritionEstimate;
  try {
    est = await aiJSON<P.NutritionEstimate>(ctx.env, {
      system: P.nutritionSystem(lang),
      user: text,
      schema: P.NUTRITION_SCHEMA,
      temperature: 0.3,
      kind: "nutrition",
      db: ctx.db,
      userId: ctx.user._id,
    });
  } catch (err) {
    console.error("mylog nutrition parse failed", ctx.user._id, err);
    await reply(ctx, t(lang, "mylog_nutrition_unreadable"));
    return; // stay in mode so they can retry with a clearer list
  }
  const items = (est.items ?? []).filter((i) => i.kcal > 0);
  if (!items.length) { await reply(ctx, t(lang, "mylog_nutrition_unreadable")); return; }
  await setMode(ctx, "idle");
  const meals: MealEntry[] = items.map((i) => ({
    desc: i.desc, kcal: i.kcal, protein: i.protein, fats: i.fats, carbs: i.carbs,
    ...(typeof i.grams === "number" ? { grams: i.grams } : {}),
  }));
  await setDayMeals(ctx.db, ctx.user._id, date, meals);
  const totKcal = meals.reduce((s, m) => s + num(m.kcal), 0);
  await reply(ctx, t(lang, "mylog_nutrition_saved", { date, n: meals.length, kcal: totKcal }));
  await showMyLogNutritionDay(ctx, date);
}

// ---- per-item macro editor (correct one already-saved meal's macros) ----

/** Callback: nlog:medit:<date>:<idx> — prompt user to send corrected macros for one item. */
export async function startMealMacroEdit(ctx: MyContext, date: string, idx: number) {
  const lang = ctx.user.lang;
  const meals = await getDayMeals(ctx.db, ctx.user._id, date);
  const item = meals[idx];
  if (!item) { await reply(ctx, t(lang, "back")); return; }
  ctx.user.session = { mode: "meal_edit_macros", awaitText: `${date}:${idx}` };
  await updateUser(ctx.db, ctx.user._id, { session: ctx.user.session });
  await reply(ctx, t(lang, "meal_macros_edit_prompt", { desc: cleanFoodName(item.desc) }));
}

/** Text handler for meal_edit_macros mode: parse "kcal p f c", update log + cache. */
export async function handleMealMacroEdit(ctx: MyContext, text: string) {
  const lang = ctx.user.lang;
  const raw = ctx.user.session.awaitText ?? "";
  const colonIdx = raw.lastIndexOf(":");
  const date = raw.slice(0, colonIdx);
  const idx = Number(raw.slice(colonIdx + 1));
  if (!date || !Number.isFinite(idx)) { await setMode(ctx, "idle"); return; }

  // Parse 4 non-negative integers from the message (order: kcal protein fats carbs).
  const nums = [...text.matchAll(/\d+/g)].map((m) => Number(m[0]));
  if (nums.length < 4) {
    await reply(ctx, t(lang, "meal_macros_invalid"));
    return; // stay in mode so user can retry
  }
  const [kcal, protein, fats, carbs] = nums;

  const meals = await getDayMeals(ctx.db, ctx.user._id, date);
  if (!meals[idx]) { await setMode(ctx, "idle"); return; }

  const item = meals[idx];
  meals[idx] = { ...item, kcal, protein, fats, carbs };
  await setDayMeals(ctx.db, ctx.user._id, date, meals);
  await setMode(ctx, "idle");

  // Cache per-100g correction when we know the portion weight and the canonical query key.
  let cached = false;
  const grams = num(item.grams);
  const query = item.query;
  if (query && grams > 0) {
    await putUserFoodCorrection(ctx.db, ctx.user._id, query, per100gCorrectionFrom(kcal, protein, fats, carbs, grams)).catch(() => {});
    cached = true;
  }

  const suffix = cached ? t(lang, "meal_macros_cached") : "";
  await reply(ctx, t(lang, "meal_macros_saved", { kcal, protein, fats, carbs }) + suffix);
  await showMyLogNutritionDay(ctx, date);
}
