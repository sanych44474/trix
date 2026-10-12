// The onboarding questionnaire as data: one question per screen. Only what the first plan needs
// is asked up front -- the training questions first (they feel like progress), body data last,
// height and weight skippable. Session length, daily activity, sleep and diet are NOT asked here:
// the plan has sensible defaults for them and the Today "fine-tune" card (FineTuneCard) asks once
// the person has a plan. Which steps appear depends on the answers so far (current lifts only past
// beginner) and on the role (a trainer's client is also asked what the trainer may see). Pure, so
// the order, validation and request are tested without rendering.
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
  /** Optional steps the person chose to skip (height, weight). */
  skipped?: StepId[];
}

export type StepId = "sex" | "age" | "height" | "weight" | "goal" | "level" | "lifts" | "days" | "equipment" | "limits" | "share";

/** Steps with a Skip button: the plan works without them (defaults), calories get better with them. */
export const SKIPPABLE: StepId[] = ["height", "weight"];

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
  equipment: {
    id: "equipment", q: "obq_equipment", kind: "choice",
    options: [
      { value: "full gym", label: "equip_full_gym" }, { value: "home basics (dumbbells, bands)", label: "equip_home_basics" },
      { value: "dumbbells only", label: "equip_dumbbells_only" }, { value: "bodyweight only", label: "equip_bodyweight_only" },
    ],
  },
  limits: { id: "limits", q: "obq_limits", hint: "obh_limits", kind: "text" },
  share: {
    id: "share", q: "obq_share", hint: "obh_share", kind: "choice",
    options: [{ value: "both", label: "obo_share_both" }, { value: "body", label: "obo_share_body" }, { value: "health", label: "obo_share_health" }, { value: "none", label: "obo_share_none" }],
  },
};

/** The steps for this person, in order. Lifts appear only past beginner; sharing only for a client. */
export function stepsFor(answers: Answers, isClient: boolean): Step[] {
  const ids: StepId[] = ["goal", "level"];
  if (answers.level && answers.level !== "beginner") ids.push("lifts");
  ids.push("equipment", "days", "sex", "age", "height", "weight", "limits");
  if (isClient) ids.push("share");
  return ids.map((id) => STEPS[id]);
}

/** Mark an optional step as skipped (its value is cleared). */
export function skip(step: Step, a: Answers): Answers {
  if (!SKIPPABLE.includes(step.id)) return a;
  const cleared = step.id === "height" ? { ...a, heightCm: undefined } : { ...a, weightKg: undefined };
  return { ...cleared, skipped: [...new Set([...(a.skipped ?? []), step.id])] };
}

/** Whether the step has a valid answer (the Next button and the final submit both use this). */
export function isAnswered(step: Step, a: Answers): boolean {
  const inRange = (v: number | undefined) => v !== undefined && Number.isFinite(v) && v >= (step.number?.min ?? -Infinity) && v <= (step.number?.max ?? Infinity);
  const skipped = (a.skipped ?? []).includes(step.id);
  switch (step.id) {
    case "sex": return !!a.sex;
    case "age": return inRange(a.age);
    case "height": return inRange(a.heightCm) || (skipped && a.heightCm === undefined);
    case "weight": return inRange(a.weightKg) || (skipped && a.weightKg === undefined);
    case "goal": return !!a.goal;
    case "level": return !!a.level;
    case "lifts": return true; // optional: an empty answer means "start from technique weights"
    case "days": return (a.trainingWeekdays ?? []).length > 0;
    case "equipment": return !!a.equipment;
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
    case "equipment": return { ...a, equipment: value };
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
    case "equipment": return a.equipment;
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

/** The /api/v2/onboarding body; null while a required answer is missing. Answers to questions
 *  the wizard no longer asks (an old draft) still go along. */
export function toRequest(a: Answers, isClient: boolean, timezone?: string) {
  const steps = stepsFor(a, isClient);
  if (!steps.every((s) => isAnswered(s, a))) return null;
  return {
    sex: a.sex!,
    age: Math.round(a.age!),
    ...(a.heightCm !== undefined ? { heightCm: Math.round(a.heightCm) } : {}),
    ...(a.weightKg !== undefined ? { weightKg: Math.round(a.weightKg * 10) / 10 } : {}),
    goal: a.goal!,
    level: a.level!,
    equipment: a.equipment!,
    trainingWeekdays: [...a.trainingWeekdays!].sort((x, y) => x - y),
    limitations: a.limitations!.trim() || "none",
    baselineLifts: a.level === "beginner" ? "none" : liftsText(a.lifts),
    ...(a.dietPrefs ? { dietPrefs: a.dietPrefs } : {}),
    ...(a.sessionMinutes ? { sessionMinutes: a.sessionMinutes } : {}),
    ...(a.lifestyle ? { lifestyle: a.lifestyle } : {}),
    ...(a.sleepSchedule ? { sleepSchedule: a.sleepSchedule } : {}),
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
