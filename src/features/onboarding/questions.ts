// The onboarding questions as data -- steps, their buttons, and progress derived from the
// profile. Shared by the bot's chat wizard (bot/onboarding.ts), the Mini App's nudge and the owner
// tools, so it lives outside bot/ (docs/adr/0010-layering.md). Moved from bot/onboarding.ts.
import { InlineKeyboard } from "grammy";
import { t } from "../../locales/i18n";
import type { TKey } from "../../adapters/telegram/context";
import type { Lang, UserProfile, Weekday } from "../../types";
import {
  DIETS, EQUIPMENT, GOALS, LEVELS, LIFESTYLES, SEXES, SESSION_MINUTES, SLEEP_SCHEDULES,
  type Diet, type Equipment, type Goal, type Level, type Lifestyle, type Sex, type SleepSchedule,
} from "../../domain/onboardingQuestions";

export interface ObStep {
  field: "sex" | "age" | "hw" | "goal" | "level" | "baselineLifts" | "daysPerWeek" | "trainingWeekdays" | "sessionMinutes" | "equipment" | "lifestyle" | "sleepSchedule" | "dietPrefs" | "limitations";
  q: TKey; // i18n question key
  buttons?: { label: string; value: string }[];
  input?: "number" | "number2" | "text";
  acceptsText?: boolean; // a button step that also accepts a typed free-text answer
  multiselect?: boolean; // weekday picker
  noneKey?: TKey; // optional "skip/none" button (i18n key) for text steps
}

// Bot button labels per option value. The values, their order and the ranges come from
// domain/onboardingQuestions.ts; the record types make a missing label a compile error.
export const OB_OPTION_LABELS: {
  sex: Record<Sex, TKey>; goal: Record<Goal, TKey>; level: Record<Level, TKey>; sessionMinutes: Record<string, TKey>;
  equipment: Record<Equipment, TKey>; lifestyle: Record<Lifestyle, TKey>; sleepSchedule: Record<SleepSchedule, TKey>; dietPrefs: Record<Diet, TKey>;
} = {
  sex: { male: "ob_sex_male", female: "ob_sex_female" },
  goal: { "fat loss": "ob_goal_fatloss", "muscle gain": "ob_goal_muscle", recomposition: "ob_goal_recomp", strength: "ob_goal_strength", endurance: "ob_goal_endurance" },
  level: { beginner: "ob_level_beginner", intermediate: "ob_level_intermediate", advanced: "ob_level_advanced" },
  sessionMinutes: { "30": "ob_dur_30", "45": "ob_dur_45", "60": "ob_dur_60", "90": "ob_dur_90" },
  equipment: { "full gym": "ob_eq_gym", "home basics (dumbbells, bands)": "ob_eq_home", "dumbbells only": "ob_eq_dumbbells", "bodyweight only": "ob_eq_bodyweight" },
  lifestyle: { sedentary: "ob_life_sedentary", moderate: "ob_life_moderate", active: "ob_life_active" },
  sleepSchedule: { morning: "ob_sleep_morning", evening: "ob_sleep_evening" },
  dietPrefs: { none: "ob_diet_none", vegetarian: "ob_diet_vegetarian", vegan: "ob_diet_vegan" },
};

const buttons = <V extends string>(lang: Lang, values: readonly V[], keys: Record<V, TKey>) => values.map((value) => ({ label: t(lang, keys[value]), value }));

export function obSteps(lang: Lang): ObStep[] {
  return [
    { field: "sex", q: "ob_q_sex", buttons: buttons(lang, SEXES, OB_OPTION_LABELS.sex) },
    { field: "age", q: "ob_q_age", input: "number" },
    { field: "hw", q: "ob_q_hw", input: "number2" },
    { field: "goal", q: "ob_q_goal", buttons: buttons(lang, GOALS, OB_OPTION_LABELS.goal) },
    { field: "level", q: "ob_q_level", buttons: buttons(lang, LEVELS, OB_OPTION_LABELS.level) },
    { field: "baselineLifts", q: "ob_q_baseline", input: "text", noneKey: "ob_baseline_none" },
    // Single source of truth for training frequency: the day picker. daysPerWeek is derived
    // from the count (no separate "how many days" question → no contradictions).
    { field: "trainingWeekdays", q: "ob_q_weekdays", multiselect: true },
    { field: "sessionMinutes", q: "ob_q_duration", buttons: buttons(lang, SESSION_MINUTES.map(String), OB_OPTION_LABELS.sessionMinutes) },
    { field: "equipment", q: "ob_q_equipment", buttons: buttons(lang, EQUIPMENT, OB_OPTION_LABELS.equipment) },
    { field: "lifestyle", q: "ob_q_lifestyle", buttons: buttons(lang, LIFESTYLES, OB_OPTION_LABELS.lifestyle) },
    { field: "sleepSchedule", q: "ob_q_sleep", buttons: buttons(lang, SLEEP_SCHEDULES, OB_OPTION_LABELS.sleepSchedule) },
    { field: "dietPrefs", q: "ob_q_diet", acceptsText: true, buttons: buttons(lang, DIETS, OB_OPTION_LABELS.dietPrefs) },
    { field: "limitations", q: "ob_q_injuries", input: "text", noneKey: "ob_injuries_none" },
  ];
}

export const OB_WEEKDAY_KEYS: Record<number, TKey> = { 1: "wd_mon", 2: "wd_tue", 3: "wd_wed", 4: "wd_thu", 5: "wd_fri", 6: "wd_sat", 7: "wd_sun" };

// Build the inline keyboard for a step (shared by first render, in-place edits, and the
// cross-context push to a freshly-accepted client). Context-free so it can target any chat.
export function obKeyboard(lang: Lang, step: ObStep, selectedDays: number[] = [], canBack = false): InlineKeyboard | undefined {
  const kb = new InlineKeyboard();
  if (step.multiselect) {
    const sel = new Set(selectedDays);
    for (let d = 1; d <= 7; d++) {
      kb.text(`${sel.has(d as Weekday) ? "✅ " : ""}${t(lang, OB_WEEKDAY_KEYS[d])}`, `ob:wd:${d}`);
      if (d % 4 === 0) kb.row();
    }
    kb.row().text(t(lang, "ob_done"), "ob:wddone");
  } else if (step.buttons) {
    step.buttons.forEach((bt, idx) => {
      kb.text(bt.label, `ob:v:${idx}`);
      if ((idx + 1) % 2 === 0) kb.row();
    });
  } else if (step.noneKey) {
    kb.text(t(lang, step.noneKey), "ob:none");
  }
  // Back button to fix a previous answer without restarting (also gives typed steps a keyboard).
  if (canBack) kb.row().text(t(lang, "ob_back"), "ob:back");
  return kb.inline_keyboard.length ? kb : undefined;
}

// Render the question + keyboard for step i (also used to resume an in-progress wizard).

// Answered-question progress for the onboarding wizard, derived from the profile itself — works
// for both the button wizard and AI-interview users. `next` = first unanswered step (resume target).
// The checks mirror obSteps() order exactly.
export function obProgress(profile: UserProfile): { answered: number; total: number; next: number } {
  const checks: boolean[] = [
    !!profile.sex,
    profile.age !== undefined,
    profile.heightCm !== undefined && profile.weightKg !== undefined,
    !!profile.goal,
    !!profile.level,
    profile.baselineLifts !== undefined,
    (profile.trainingWeekdays ?? []).length > 0,
    profile.sessionMinutes !== undefined,
    !!profile.equipment,
    !!profile.lifestyle,
    !!profile.sleepSchedule,
    !!profile.dietPrefs,
    profile.limitations !== undefined,
  ];
  const next = checks.indexOf(false);
  return { answered: checks.filter(Boolean).length, total: checks.length, next: next === -1 ? checks.length - 1 : next };
}
