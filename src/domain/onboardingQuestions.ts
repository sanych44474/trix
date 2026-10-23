// The onboarding questionnaire as data. Option values and numeric ranges are defined here once and
// served to the Mini App and the native app (GET /api/v2/onboarding/questions); the bot's button
// wizard and the profile API validate against the same lists. Labels are keys of the Mini App
// catalog: clients translate them, the server does not. Pure: no i18n lookups.

export const SEXES = ["male", "female"] as const;
export const GOALS = ["fat loss", "muscle gain", "recomposition", "strength", "endurance"] as const;
export const LEVELS = ["beginner", "intermediate", "advanced"] as const;
export const EQUIPMENT = ["full gym", "home basics (dumbbells, bands)", "dumbbells only", "bodyweight only"] as const;
export const DIETS = ["none", "vegetarian", "vegan"] as const;
export const LIFESTYLES = ["sedentary", "moderate", "active"] as const;
export const SLEEP_SCHEDULES = ["morning", "evening"] as const;
export const SESSION_MINUTES = [30, 45, 60, 90] as const;

export type Sex = (typeof SEXES)[number];
export type Goal = (typeof GOALS)[number];
export type Level = (typeof LEVELS)[number];
export type Equipment = (typeof EQUIPMENT)[number];
export type Diet = (typeof DIETS)[number];
export type Lifestyle = (typeof LIFESTYLES)[number];
export type SleepSchedule = (typeof SLEEP_SCHEDULES)[number];

/** Inclusive numeric bounds, one per field, shared by the questions and the profile API. */
export const AGE_RANGE = { min: 13, max: 100 } as const;
export const HEIGHT_CM_RANGE = { min: 100, max: 250 } as const;
export const WEIGHT_KG_RANGE = { min: 30, max: 300 } as const;

export type QuestionId =
  | "sex" | "age" | "height" | "weight" | "goal" | "level" | "lifts" | "days" | "duration"
  | "equipment" | "lifestyle" | "sleep" | "diet" | "limits" | "share";

/** lifts: only past beginner; share: only for a trainer's client; always otherwise. */
export type ShowWhen = "always" | "nonBeginner" | "trainerClient";

export interface QuestionOption { value: string; label: string }

export interface QuestionNumber { min: number; max: number; step: number; unit: string; placeholder: string }

export interface Question {
  id: QuestionId;
  kind: "choice" | "number" | "lifts" | "days" | "text";
  q: string;
  hint?: string;
  options?: QuestionOption[];
  number?: QuestionNumber;
  showWhen: ShowWhen;
  /** The four body-data questions asked before a ready program is applied. */
  basics?: boolean;
}

const opts = (pairs: [string, string][]): QuestionOption[] => pairs.map(([value, label]) => ({ value, label }));

export const QUESTIONS: readonly Question[] = [
  { id: "sex", kind: "choice", q: "obq_sex", showWhen: "always", basics: true, options: opts([["male", "sex_male"], ["female", "sex_female"]]) },
  { id: "age", kind: "number", q: "obq_age", showWhen: "always", basics: true, number: { ...AGE_RANGE, step: 1, unit: "obu_years", placeholder: "30" } },
  { id: "height", kind: "number", q: "obq_height", showWhen: "always", basics: true, number: { ...HEIGHT_CM_RANGE, step: 1, unit: "obu_cm", placeholder: "175" } },
  { id: "weight", kind: "number", q: "obq_weight", showWhen: "always", basics: true, number: { ...WEIGHT_KG_RANGE, step: 0.1, unit: "obu_kg", placeholder: "75" } },
  {
    id: "goal", kind: "choice", q: "obq_goal", showWhen: "always",
    options: opts([["fat loss", "goal_fat_loss"], ["muscle gain", "goal_muscle_gain"], ["recomposition", "goal_recomposition"], ["strength", "goal_strength"], ["endurance", "goal_endurance"]]),
  },
  {
    id: "level", kind: "choice", q: "obq_level", hint: "obh_level", showWhen: "always",
    options: opts([["beginner", "level_beginner"], ["intermediate", "level_intermediate"], ["advanced", "level_advanced"]]),
  },
  { id: "lifts", kind: "lifts", q: "obq_lifts", hint: "ob_lifts_hint", showWhen: "nonBeginner" },
  { id: "days", kind: "days", q: "obq_days", hint: "obh_days", showWhen: "always" },
  {
    id: "duration", kind: "choice", q: "obq_duration", showWhen: "always",
    options: SESSION_MINUTES.map((m) => ({ value: String(m), label: `obo_min_${m}` })),
  },
  {
    id: "equipment", kind: "choice", q: "obq_equipment", showWhen: "always",
    options: opts([["full gym", "equip_full_gym"], ["home basics (dumbbells, bands)", "equip_home_basics"], ["dumbbells only", "equip_dumbbells_only"], ["bodyweight only", "equip_bodyweight_only"]]),
  },
  {
    id: "lifestyle", kind: "choice", q: "obq_lifestyle", showWhen: "always",
    options: opts([["sedentary", "obo_life_sedentary"], ["moderate", "obo_life_moderate"], ["active", "obo_life_active"]]),
  },
  { id: "sleep", kind: "choice", q: "obq_sleep", showWhen: "always", options: opts([["morning", "obo_sleep_morning"], ["evening", "obo_sleep_evening"]]) },
  {
    id: "diet", kind: "choice", q: "obq_diet", showWhen: "always",
    options: opts([["none", "diet_everything"], ["vegetarian", "diet_vegetarian"], ["vegan", "diet_vegan"]]),
  },
  { id: "limits", kind: "text", q: "obq_limits", hint: "obh_limits", showWhen: "always" },
  {
    id: "share", kind: "choice", q: "obq_share", hint: "obh_share", showWhen: "trainerClient",
    options: opts([["both", "obo_share_both"], ["body", "obo_share_body"], ["health", "obo_share_health"], ["none", "obo_share_none"]]),
  },
];

/** The questions this person is asked, in order. */
export function visibleQuestions(answers: { level?: string }, isClient: boolean): Question[] {
  return QUESTIONS.filter((q) => {
    if (q.showWhen === "nonBeginner") return answers.level !== undefined && answers.level !== "beginner";
    if (q.showWhen === "trainerClient") return isClient;
    return true;
  });
}

/** The ready-program entry asks only these (the start weights and calorie targets need them). */
export function basicQuestions(): Question[] {
  return QUESTIONS.filter((q) => q.basics === true);
}
