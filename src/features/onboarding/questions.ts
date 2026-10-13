// The onboarding questions as data -- steps, their buttons, and progress derived from the
// profile. Shared by the bot's chat wizard (bot/onboarding.ts), the Mini App's nudge and the owner
// tools, so it lives outside bot/ (docs/adr/0010-layering.md). Moved from bot/onboarding.ts.
import { InlineKeyboard } from "grammy";
import { t } from "../../locales/i18n";
import type { TKey } from "../../adapters/telegram/context";
import type { Lang, UserProfile, Weekday } from "../../types";

export interface ObStep {
  field: "sex" | "age" | "hw" | "goal" | "level" | "baselineLifts" | "daysPerWeek" | "trainingWeekdays" | "sessionMinutes" | "equipment" | "lifestyle" | "sleepSchedule" | "dietPrefs" | "limitations";
  q: TKey; // i18n question key
  buttons?: { label: string; value: string }[];
  input?: "number" | "number2" | "text";
  acceptsText?: boolean; // a button step that also accepts a typed free-text answer
  multiselect?: boolean; // weekday picker
  noneKey?: TKey; // optional "skip/none" button (i18n key) for text steps
}

export function obSteps(lang: Lang): ObStep[] {
  const b = (label: TKey, value: string) => ({ label: t(lang, label), value });
  return [
    { field: "sex", q: "ob_q_sex", buttons: [b("ob_sex_male", "male"), b("ob_sex_female", "female")] },
    { field: "age", q: "ob_q_age", input: "number" },
    { field: "hw", q: "ob_q_hw", input: "number2" },
    { field: "goal", q: "ob_q_goal", buttons: [b("ob_goal_fatloss", "fat loss"), b("ob_goal_muscle", "muscle gain"), b("ob_goal_recomp", "recomposition"), b("ob_goal_strength", "strength"), b("ob_goal_endurance", "endurance")] },
    { field: "level", q: "ob_q_level", buttons: [b("ob_level_beginner", "beginner"), b("ob_level_intermediate", "intermediate"), b("ob_level_advanced", "advanced")] },
    { field: "baselineLifts", q: "ob_q_baseline", input: "text", noneKey: "ob_baseline_none" },
    // Single source of truth for training frequency: the day picker. daysPerWeek is derived
    // from the count (no separate "how many days" question → no contradictions).
    { field: "trainingWeekdays", q: "ob_q_weekdays", multiselect: true },
    { field: "sessionMinutes", q: "ob_q_duration", buttons: [b("ob_dur_30", "30"), b("ob_dur_45", "45"), b("ob_dur_60", "60"), b("ob_dur_90", "90")] },
    { field: "equipment", q: "ob_q_equipment", buttons: [b("ob_eq_gym", "full gym"), b("ob_eq_home", "home basics (dumbbells, bands)"), b("ob_eq_dumbbells", "dumbbells only"), b("ob_eq_bodyweight", "bodyweight only")] },
    { field: "lifestyle", q: "ob_q_lifestyle", buttons: [b("ob_life_sedentary", "sedentary"), b("ob_life_moderate", "moderate"), b("ob_life_active", "active")] },
    { field: "sleepSchedule", q: "ob_q_sleep", buttons: [b("ob_sleep_morning", "morning"), b("ob_sleep_evening", "evening")] },
    { field: "dietPrefs", q: "ob_q_diet", acceptsText: true, buttons: [b("ob_diet_none", "none"), b("ob_diet_vegetarian", "vegetarian"), b("ob_diet_vegan", "vegan")] },
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
