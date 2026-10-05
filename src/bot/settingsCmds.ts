// Settings commands: reminders, training days, language, goal weight, body edits, reminder hour,
// timezone and measurements. Split out of bot.ts (god-file split); bot.ts re-exports everything here.
import { InlineKeyboard } from "grammy";
import type { Lang, UserDoc, Weekday } from "../types";
import { upsertBodyLog } from "../adapters/d1/v2Tracking";
import { updateUser } from "../adapters/d1/v2Users";
import { LANG_NAME, t } from "../locales/i18n";
import { computeTargets } from "../domain/mealplan";
import { localParts, parseMeasurements, parseHeightWeight } from "../domain/progression";
import { weekdayName } from "../render";
import { cmdReplan } from "./exportData";
import { menuBtn, langMenu, hourMenu, tzMenu, settingsMenu } from "./keyboards";
import { showInjuryMenu } from "./injury";
import { reply, setMode, type MyContext, type TKey } from "../adapters/telegram/context";

export async function cmdMeasure(ctx: MyContext) {
  await setMode(ctx, "measure");
  await reply(ctx, t(ctx.user.lang, "measure_prompt"));
}

// Reminder types the user can switch on/off (the daily/weekly nudges).
export const REMINDER_TYPES = ["workout", "nutrition", "steps", "water", "checkin", "wellbeing", "tomorrow", "measure", "digest", "plateau", "session"] as const;

export const REMINDER_LABEL: Record<string, TKey> = {
  workout: "rem_workout", nutrition: "rem_nutrition", steps: "rem_steps", water: "rem_water", checkin: "rem_checkin",
  wellbeing: "rem_wellbeing", tomorrow: "rem_tomorrow", measure: "rem_measure", digest: "rem_digest", plateau: "rem_plateau",
  session: "rem_session",
};

export async function showReminderSettings(ctx: MyContext) {
  const lang = ctx.user.lang;
  const off = new Set(ctx.user.profile.remindersOff ?? []);
  const kb = new InlineKeyboard();
  REMINDER_TYPES.forEach((key, i) => {
    const on = !off.has(key);
    kb.text(`${on ? "🔔" : "🔕"} ${t(lang, REMINDER_LABEL[key])}`, `remtog:${key}`);
    if ((i + 1) % 2 === 0) kb.row();
  });
  kb.row().text(t(lang, "back"), "menu:settings");
  await reply(ctx, t(lang, "rem_settings_title"), kb);
}

export async function onReminderToggle(ctx: MyContext, key: string) {
  if (!REMINDER_TYPES.includes(key as (typeof REMINDER_TYPES)[number])) return;
  const off = new Set(ctx.user.profile.remindersOff ?? []);
  off.has(key) ? off.delete(key) : off.add(key);
  ctx.user.profile = { ...ctx.user.profile, remindersOff: [...off] };
  await updateUser(ctx.db, ctx.user._id, { profile: ctx.user.profile });
  await showReminderSettings(ctx);
}

// ===================== Vacation / pause mode =====================
// Moved to bot/vacation.ts (god-file split), including the comeback interview; re-exported
// below so existing `from "./bot"` imports (router.ts) keep working.

// ===================== Owner-confirmed cleanup (NEVER auto) =====================
// Moved to bot/cleanup.ts (god-file split); re-exported below so existing `from "./bot"`
// imports (router.ts) keep working.

export function daysMenu(lang: Lang, selected: Weekday[]): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (let w = 1 as Weekday; w <= 7; w++) {
    const on = selected.includes(w as Weekday);
    kb.text(`${on ? "✅ " : ""}${weekdayName(lang, w as Weekday)}`, `day:${w}`);
    if (w === 4) kb.row();
  }
  kb.row().text(t(lang, "set_days_done"), "day:done");
  return kb;
}

export async function cmdSettings(ctx: MyContext) {
  const lang = ctx.user.lang;
  const p = ctx.user.profile;
  const days = (p.trainingWeekdays ?? [])
    .map((w) => weekdayName(lang, w as Weekday))
    .join(", ") || "—";
  await reply(
    ctx,
    `${t(lang, "settings_header", {
      lang: LANG_NAME[lang],
      days,
      hour: p.reminderHour ?? 18,
      tz: p.timezone ?? "UTC",
    })}\n\n${t(lang, "settings_edit_hint")}`,
    settingsMenu(lang, !!ctx.user.competeOptIn, ctx.user.profile.sex, ctx.user.role === "client"),
  );
}

// ---------- bot records (leaderboards + badges) ----------
// Board assembly + badge rendering live in ./features/gamification/boards (also used by the
// scheduler cache and the Mini App); bot.ts keeps only the chat command/render layer.

export async function cmdLang(ctx: MyContext) {
  // Three languages now → show the picker instead of a two-way toggle.
  await reply(ctx, t(ctx.user.lang, "choose_language"), langMenu());
}

export async function updateProfile(ctx: MyContext, patch: Partial<UserDoc["profile"]>) {
  const profile = { ...ctx.user.profile, ...patch };
  await updateUser(ctx.db, ctx.user._id, { profile });
  ctx.user.profile = profile;
}

export async function openSetting(ctx: MyContext, which: string) {
  const lang = ctx.user.lang;
  if (which === "hour") await reply(ctx, t(lang, "set_hour_prompt"), hourMenu());
  else if (which === "days")
    await reply(ctx, t(lang, "set_days_prompt"), daysMenu(lang, ctx.user.profile.trainingWeekdays ?? []));
  else if (which === "tz") await reply(ctx, t(lang, "set_tz_prompt"), tzMenu());
  else if (which === "lang") await reply(ctx, t(lang, "choose_language"), langMenu());
  else if (which === "body") {
    await setMode(ctx, "body_edit");
    const p = ctx.user.profile;
    const cur = p.heightCm && p.weightKg ? `${p.heightCm} ${p.weightKg}` : "180 80";
    await reply(ctx, t(lang, "set_body_prompt", { cur }));
  }
  else if (which === "goalweight") {
    await setMode(ctx, "goal_weight");
    const cur = ctx.user.profile.goalWeight ?? ctx.user.profile.weightKg ?? 75;
    await reply(ctx, t(lang, "set_goalweight_prompt", { cur }));
  }
  else if (which === "injury") await showInjuryMenu(ctx);
  else if (which === "replan") await cmdReplan(ctx);
}

// Set the target bodyweight (drives the projection on the progress screen).
export async function handleGoalWeight(ctx: MyContext, text: string) {
  const lang = ctx.user.lang;
  const w = parseFloat(text.replace(",", ".").replace(/[^\d.]/g, ""));
  if (!Number.isFinite(w) || w < 30 || w > 300) { await reply(ctx, t(lang, "set_goalweight_invalid")); return; }
  await updateProfile(ctx, { goalWeight: Math.round(w * 10) / 10 });
  await setMode(ctx, "idle");
  await reply(ctx, t(lang, "set_goalweight_saved", { w: Math.round(w * 10) / 10 }), menuBtn(lang));
}

// ===================== Injury / pain tracking =====================
// Moved to bot/injury.ts (god-file split); re-exported below so existing `from "./bot"`
// imports (router.ts) keep working.

// ============ Menstrual-cycle tracking (opt-in, female profiles) ============
// Moved to bot/cycle.ts (god-file split); re-exported below so existing `from "./bot"` imports
// (router.ts) keep working.

// ============ Sharing with trainer (client-owned consent toggles) ============
// Moved to bot/shareConsent.ts (god-file split); re-exported below.

// ===================== Calendar & session booking =====================
// Moved to bot/calendar.ts (god-file split); re-exported below so existing `from "./bot"`
// imports (router.ts, features/trainer/trainer.ts) keep working.

// Edit body height+weight from settings. Reuses the onboarding realism check + auto-swap.
export async function handleBodyEdit(ctx: MyContext, text: string) {
  const lang = ctx.user.lang;
  const hw = parseHeightWeight(text);
  if (!hw) {
    await reply(ctx, t(lang, "ob_hw_unrealistic"));
    return;
  }
  await updateProfile(ctx, { heightCm: hw.heightCm, weightKg: hw.weightKg });
  await setMode(ctx, "idle");
  // Recalculate nutrition targets whenever weight/height change — macros (protein, fats) are
  // expressed per-kg, so stale targets quickly diverge from reality. We pass undefined for
  // planNutrition to force a formula-based recalculation (Mifflin-St-Jeor + activity + goal)
  // rather than just returning the unchanged plan values.
  const freshNutrition = computeTargets(ctx.user.profile, undefined);
  // Preserve the text notes from the AI-authored plan (e.g. "calculated for recomposition…").
  const existingNotes = ctx.user.nutrition?.notes;
  await updateUser(ctx.db, ctx.user._id, {
    nutrition: { ...freshNutrition, ...(existingNotes ? { notes: existingNotes } : {}) },
  });
  await reply(ctx, t(lang, "body_saved", { h: String(hw.heightCm), w: String(hw.weightKg) }));
  await cmdSettings(ctx);
}

export async function onSetHour(ctx: MyContext, hour: number) {
  if (Number.isFinite(hour)) await updateProfile(ctx, { reminderHour: hour });
  await reply(ctx, t(ctx.user.lang, "settings_saved"));
  await cmdSettings(ctx);
}

// Reply to the scheduler's smart reminder-timing offer: "yes:<h>" applies the hour, "no" keeps it.
export async function onSmartHour(ctx: MyContext, action: string) {
  const lang = ctx.user.lang;
  const [verb, hStr] = action.split(":");
  const h = Number(hStr);
  if (verb === "yes" && Number.isInteger(h) && h >= 0 && h <= 23) {
    await updateProfile(ctx, { reminderHour: h });
    await reply(ctx, t(lang, "smart_hour_set", { h }), menuBtn(lang));
  } else {
    await reply(ctx, t(lang, "smart_hour_kept"), menuBtn(lang));
  }
}

export async function onSetTz(ctx: MyContext, tz: string) {
  if (tz) await updateProfile(ctx, { timezone: tz });
  await reply(ctx, t(ctx.user.lang, "settings_saved"));
  await cmdSettings(ctx);
}

export async function onToggleDay(ctx: MyContext, arg: string) {
  const lang = ctx.user.lang;
  if (arg === "done") {
    await reply(ctx, t(lang, "settings_saved"));
    await cmdSettings(ctx);
    return;
  }
  const w = Number(arg) as Weekday;
  const cur = new Set(ctx.user.profile.trainingWeekdays ?? []);
  if (cur.has(w)) cur.delete(w);
  else cur.add(w);
  const arr = [...cur].sort((a, b) => a - b) as Weekday[];
  await updateProfile(ctx, { trainingWeekdays: arr });
  await ctx.editMessageReplyMarkup({ reply_markup: daysMenu(lang, arr) }).catch(() => {});
}

// ---------------- onboarding & plan generation ----------------

// TKey moved to adapters/telegram/context.ts (re-exported near the top of this file) along with
// the rest of the core plumbing.




















// onLevelUp, onGoalMaintain, resumePendingPlan, saveBaselineBody moved to bot/planGen.ts
// (god-file split); re-exported below so existing `from "./bot"` imports keep working.

// ---------------- nutrition ----------------
// Moved to features/nutrition/nutritionLog.ts; re-exported above so existing `from "./bot"`
// imports (router.ts) keep working.

// ---------------- coach / logging / measurements / feedback ----------------
// coach* moved to bot/coach.ts, workout-log/save moved to bot/workoutSave.ts, feedback moved
// to bot/feedbackIntake.ts (god-file split); re-exported below. handleMeasure (the only
// "measurements" function — too small on its own for a new file) stayed here.

export async function handleMeasure(ctx: MyContext, text: string) {
  const lang = ctx.user.lang;
  const { weight, measurements } = parseMeasurements(text);
  if (weight === undefined && Object.keys(measurements).length === 0) {
    await reply(ctx, t(lang, "measure_none"));
    return;
  }
  const { date } = localParts(ctx.user.profile.timezone);
  await upsertBodyLog(ctx.db, ctx.user._id, date, {
    ...(weight !== undefined ? { weight } : {}),
    ...(Object.keys(measurements).length ? { measurements } : {}),
  });
  await setMode(ctx, "idle");
  await reply(ctx, t(lang, "measure_saved"), menuBtn(lang));
}

// ---------------- user report ----------------
// Moved to bot/report.ts (god-file split); re-exported below so existing `from "./bot"`
// imports (router.ts, features/trainer/trainer.ts) keep working.

// ---------------- replan / delete / export ----------------
// Moved to bot/exportData.ts (god-file split); re-exported below so existing `from "./bot"`
// imports (router.ts, webapp/settingsApi.ts) keep working.


// ---------------- bot factory ----------------
