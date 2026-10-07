// The onboarding questionnaire as data: one question per screen. Which steps appear depends on
// the answers so far (current lifts only past beginner) and on the role (a trainer's client is
// also asked what the trainer may see). Pure, so the order, validation and request are tested
// without rendering.
import type { Key } from "../i18n";

export type Sex = "male" | "female";
export type Level = "beginner" | "intermediate" | "advanced";
export type ShareChoice = "both" | "body" | "health" | "none";

export interface Answers {
  sex?: Sex;
  age?: number;
  heightCm?: number;
  weightKg?: number;
  goal?: string;
  level?: Level;
  lifts?: { bench?: number; squat?: number; deadlift?: number };
  trainingWeekdays?: number[];
  sessionMinutes?: 30 | 45 | 60 | 90;
  equipment?: string;
  lifestyle?: "sedentary" | "moderate" | "active";
  sleepSchedule?: "morning" | "evening";
  dietPrefs?: string;
  limitations?: string;
  share?: ShareChoice;
}

export type StepId =
  | "sex" | "age" | "height" | "weight" | "goal" | "level" | "lifts" | "days" | "duration"
  | "equipment" | "lifestyle" | "sleep" | "diet" | "limits" | "share";

export type Option = { value: string; label: Key };

export interface Step {
  id: StepId;
  q: Key;
  hint?: Key;
  kind: "choice" | "number" | "lifts" | "days" | "text";
  options?: Option[];
  number?: { min: number; max: number; step?: number; unit: Key; placeholder: string };
}

const STEPS: Record<StepId, Step> = {
  sex: { id: "sex", q: "obq_sex", kind: "choice", options: [{ value: "male", label: "sex_male" }, { value: "female", label: "sex_female" }] },
  age: { id: "age", q: "obq_age", kind: "number", number: { min: 13, max: 100, unit: "obu_years", placeholder: "30" } },
  height: { id: "height", q: "obq_height", kind: "number", number: { min: 100, max: 250, unit: "obu_cm", placeholder: "175" } },
  weight: { id: "weight", q: "obq_weight", kind: "number", number: { min: 30, max: 300, step: 0.1, unit: "obu_kg", placeholder: "75" } },
  goal: {
    id: "goal", q: "obq_goal", kind: "choice",
    options: [
      { value: "fat loss", label: "goal_fat_loss" }, { value: "muscle gain", label: "goal_muscle_gain" },
      { value: "recomposition", label: "goal_recomposition" }, { value: "strength", label: "goal_strength" },
      { value: "endurance", label: "goal_endurance" },
    ],
  },
  level: {
    id: "level", q: "obq_level", hint: "obh_level", kind: "choice",
    options: [{ value: "beginner", label: "level_beginner" }, { value: "intermediate", label: "level_intermediate" }, { value: "advanced", label: "level_advanced" }],
  },
  lifts: { id: "lifts", q: "obq_lifts", hint: "ob_lifts_hint", kind: "lifts" },
  days: { id: "days", q: "obq_days", hint: "obh_days", kind: "days" },
  duration: {
    id: "duration", q: "obq_duration", kind: "choice",
    options: [{ value: "30", label: "obo_min_30" }, { value: "45", label: "obo_min_45" }, { value: "60", label: "obo_min_60" }, { value: "90", label: "obo_min_90" }],
  },
  equipment: {
    id: "equipment", q: "obq_equipment", kind: "choice",
    options: [
      { value: "full gym", label: "equip_full_gym" }, { value: "home basics (dumbbells, bands)", label: "equip_home_basics" },
      { value: "dumbbells only", label: "equip_dumbbells_only" }, { value: "bodyweight only", label: "equip_bodyweight_only" },
    ],
  },
  lifestyle: {
    id: "lifestyle", q: "obq_lifestyle", kind: "choice",
    options: [{ value: "sedentary", label: "obo_life_sedentary" }, { value: "moderate", label: "obo_life_moderate" }, { value: "active", label: "obo_life_active" }],
  },
  sleep: { id: "sleep", q: "obq_sleep", kind: "choice", options: [{ value: "morning", label: "obo_sleep_morning" }, { value: "evening", label: "obo_sleep_evening" }] },
  diet: {
    id: "diet", q: "obq_diet", kind: "choice",
    options: [{ value: "none", label: "diet_everything" }, { value: "vegetarian", label: "diet_vegetarian" }, { value: "vegan", label: "diet_vegan" }],
  },
  limits: { id: "limits", q: "obq_limits", hint: "obh_limits", kind: "text" },
  share: {
    id: "share", q: "obq_share", hint: "obh_share", kind: "choice",
    options: [{ value: "both", label: "obo_share_both" }, { value: "body", label: "obo_share_body" }, { value: "health", label: "obo_share_health" }, { value: "none", label: "obo_share_none" }],
  },
};

/** The steps for this person, in order. Lifts appear only past beginner; sharing only for a client. */
export function stepsFor(answers: Answers, isClient: boolean): Step[] {
  const ids: StepId[] = ["sex", "age", "height", "weight", "goal", "level"];
  if (answers.level && answers.level !== "beginner") ids.push("lifts");
  ids.push("days", "duration", "equipment", "lifestyle", "sleep", "diet", "limits");
  if (isClient) ids.push("share");
  return ids.map((id) => STEPS[id]);
}

/** Whether the step has a valid answer (the Next button and the final submit both use this). */
export function isAnswered(step: Step, a: Answers): boolean {
  const inRange = (v: number | undefined) => v !== undefined && Number.isFinite(v) && v >= (step.number?.min ?? -Infinity) && v <= (step.number?.max ?? Infinity);
  switch (step.id) {
    case "sex": return !!a.sex;
    case "age": return inRange(a.age);
    case "height": return inRange(a.heightCm);
    case "weight": return inRange(a.weightKg);
    case "goal": return !!a.goal;
    case "level": return !!a.level;
    case "lifts": return true; // optional: an empty answer means "start from technique weights"
    case "days": return (a.trainingWeekdays ?? []).length > 0;
    case "duration": return a.sessionMinutes !== undefined;
    case "equipment": return !!a.equipment;
    case "lifestyle": return !!a.lifestyle;
    case "sleep": return !!a.sleepSchedule;
    case "diet": return !!a.dietPrefs;
    case "limits": return a.limitations !== undefined;
    case "share": return !!a.share;
  }
}

/** Apply a choice-step answer. */
export function choose(step: Step, a: Answers, value: string): Answers {
  switch (step.id) {
    case "sex": return { ...a, sex: value as Sex };
    case "goal": return { ...a, goal: value };
    case "level": return { ...a, level: value as Level, lifts: value === "beginner" ? undefined : a.lifts };
    case "duration": return { ...a, sessionMinutes: Number(value) as Answers["sessionMinutes"] };
    case "equipment": return { ...a, equipment: value };
    case "lifestyle": return { ...a, lifestyle: value as Answers["lifestyle"] };
    case "sleep": return { ...a, sleepSchedule: value as Answers["sleepSchedule"] };
    case "diet": return { ...a, dietPrefs: value };
    case "share": return { ...a, share: value as ShareChoice };
    default: return a;
  }
}

/** The currently chosen value of a choice step (to highlight it when coming back). */
export function chosen(step: Step, a: Answers): string | undefined {
  switch (step.id) {
    case "sex": return a.sex;
    case "goal": return a.goal;
    case "level": return a.level;
    case "duration": return a.sessionMinutes !== undefined ? String(a.sessionMinutes) : undefined;
    case "equipment": return a.equipment;
    case "lifestyle": return a.lifestyle;
    case "sleep": return a.sleepSchedule;
    case "diet": return a.dietPrefs;
    case "share": return a.share;
    default: return undefined;
  }
}

/** Index of the first unanswered step (where a restored draft resumes). */
export function firstOpenStep(a: Answers, isClient: boolean): number {
  const steps = stepsFor(a, isClient);
  const i = steps.findIndex((s) => !isAnswered(s, a));
  return i === -1 ? steps.length - 1 : i;
}

const liftsText = (l: Answers["lifts"]) =>
  ([["bench", l?.bench], ["squat", l?.squat], ["deadlift", l?.deadlift]] as const)
    .filter(([, v]) => v !== undefined && v > 0)
    .map(([k, v]) => `${k} ${v}kg`)
    .join(", ") || "none";

/** The /api/v2/onboarding body; null while a required answer is missing. */
export function toRequest(a: Answers, isClient: boolean, timezone?: string) {
  const steps = stepsFor(a, isClient);
  if (!steps.every((s) => isAnswered(s, a))) return null;
  return {
    sex: a.sex!,
    age: Math.round(a.age!),
    heightCm: Math.round(a.heightCm!),
    weightKg: Math.round(a.weightKg! * 10) / 10,
    goal: a.goal!,
    level: a.level!,
    equipment: a.equipment!,
    dietPrefs: a.dietPrefs!,
    trainingWeekdays: [...a.trainingWeekdays!].sort((x, y) => x - y),
    limitations: a.limitations!.trim() || "none",
    baselineLifts: a.level === "beginner" ? "none" : liftsText(a.lifts),
    sessionMinutes: a.sessionMinutes!,
    lifestyle: a.lifestyle!,
    sleepSchedule: a.sleepSchedule!,
    ...(timezone ? { timezone } : {}),
    ...(isClient ? { share: { body: a.share === "both" || a.share === "body", health: a.share === "both" || a.share === "health" } } : {}),
  };
}

export const DRAFT_KEY = "trix:onboarding:draft";

/** Restore a saved draft; anything malformed is dropped rather than trusted. */
export function parseDraft(raw: string | null): Answers {
  if (!raw) return {};
  try {
    const d = JSON.parse(raw) as unknown;
    return d && typeof d === "object" && !Array.isArray(d) ? (d as Answers) : {};
  } catch { return {}; }
}
