// Validation of the questionnaire answers shared by the profile PATCH and the onboarding submit.
// Both read the same option lists and ranges from onboardingQuestions.ts. Each field is either
// absent (no error), valid (copied to the patch) or present-but-invalid (an error code). The
// profile PATCH is a partial update and ignores errors; onboarding rejects when any are present.
import type { UserProfile, Weekday } from "../types";
import { AGE_RANGE, DIETS, EQUIPMENT, GOALS, HEIGHT_CM_RANGE, LEVELS, LIFESTYLES, SESSION_MINUTES, SEXES, SLEEP_SCHEDULES, WEIGHT_KG_RANGE } from "./onboardingQuestions";

export type AnswerMode = "patch" | "onboarding";
export type AnswerField =
  | "sex" | "age" | "heightCm" | "weightKg" | "goal" | "level" | "equipment" | "dietPrefs" | "lifestyle"
  | "sessionMinutes" | "sleepSchedule" | "timezone";
export type AnswerError = "out_of_range" | "invalid";

export interface AnswerResult {
  patch: Partial<UserProfile>;
  errors: Partial<Record<AnswerField, AnswerError>>;
}

export interface AnswerContext {
  mode: AnswerMode;
  isClient: boolean;
  /** The profile's timezone; onboarding keeps it and ignores the device's. */
  currentTimezone?: string;
}

const isSet = (v: unknown) => v !== undefined && v !== null;
const inRange = (v: unknown, r: { min: number; max: number }) => typeof v === "number" && Number.isFinite(v) && v >= r.min && v <= r.max;
const oneOf = <T extends string | number>(list: readonly T[]) => (v: unknown): T | undefined => (list as readonly unknown[]).includes(v) ? (v as T) : undefined;

function validTimeZone(tz: string): boolean {
  try { new Intl.DateTimeFormat("en", { timeZone: tz }); return true; } catch { return false; }
}

/**
 * Reads the answer fields from a request body. Absent or null fields are skipped. Out-of-range
 * numbers are rounded the same way the profile has always stored them (age and height to whole
 * numbers, weight to 0.1 kg).
 */
export function validateAnswers(body: Record<string, unknown>, ctx: AnswerContext): AnswerResult {
  const patch: Partial<UserProfile> = {};
  const errors: AnswerResult["errors"] = {};
  const onboarding = ctx.mode === "onboarding";

  // Reads one field: skipped when absent, recorded as an error when present but not accepted.
  const read = <T>(field: AnswerField, value: unknown, accept: (v: unknown) => T | undefined, code: AnswerError = "invalid"): T | undefined => {
    if (!isSet(value)) return undefined;
    const ok = accept(value);
    if (ok === undefined) errors[field] = code;
    return ok;
  };
  const number = (range: { min: number; max: number }, round: (n: number) => number) => (v: unknown) => (inRange(v, range) ? round(v as number) : undefined);
  const whole = (n: number) => Math.round(n);

  const sex = read("sex", body.sex, oneOf(SEXES));
  if (sex) patch.sex = sex;
  const age = read("age", body.age, number(AGE_RANGE, whole), "out_of_range");
  if (age !== undefined) patch.age = age;
  const heightCm = read("heightCm", body.heightCm, number(HEIGHT_CM_RANGE, whole), "out_of_range");
  if (heightCm !== undefined) patch.heightCm = heightCm;
  const weightKg = read("weightKg", body.weightKg, number(WEIGHT_KG_RANGE, (n) => Math.round(n * 10) / 10), "out_of_range");
  if (weightKg !== undefined) patch.weightKg = weightKg;
  const goal = read("goal", body.goal, oneOf(GOALS));
  if (goal) patch.goal = goal;
  const level = read("level", body.level, oneOf(LEVELS));
  if (level) patch.level = level;
  const equipment = read("equipment", body.equipment, oneOf(EQUIPMENT));
  if (equipment) patch.equipment = equipment;
  const dietPrefs = read("dietPrefs", body.dietPrefs, oneOf(DIETS));
  if (dietPrefs) patch.dietPrefs = dietPrefs;
  const lifestyle = read("lifestyle", body.lifestyle, oneOf(LIFESTYLES));
  if (lifestyle) patch.lifestyle = lifestyle;
  const sessionMinutes = read("sessionMinutes", body.sessionMinutes, oneOf(SESSION_MINUTES));
  if (sessionMinutes) patch.sessionMinutes = sessionMinutes;

  if (typeof body.limitations === "string") {
    const text = body.limitations.trim().slice(0, 500);
    patch.limitations = onboarding ? text || "none" : text;
  }

  if (Array.isArray(body.trainingWeekdays)) {
    const days = [...new Set(body.trainingWeekdays.map(Number).filter((n) => n >= 1 && n <= 7))].sort((a, b) => a - b) as Weekday[];
    if (days.length) { patch.trainingWeekdays = days; patch.daysPerWeek = days.length; }
  }

  // A trainer's client's consent to share body data and health data with the trainer.
  if (ctx.isClient && body.share && typeof body.share === "object") {
    const s = body.share as { body?: unknown; health?: unknown };
    patch.shareWithTrainer = { body: s.body === true, health: s.health === true };
  }

  if (onboarding) {
    const sleep = read("sleepSchedule", body.sleepSchedule, oneOf(SLEEP_SCHEDULES));
    if (sleep) patch.sleepSchedule = sleep;
    // Current lifts (non-beginners): starting weights are calibrated from them (domain/startWeights.ts).
    if (typeof body.baselineLifts === "string") patch.baselineLifts = body.baselineLifts.trim().slice(0, 200) || "none";
    else if (patch.level === "beginner") patch.baselineLifts = "none";
    // The phone's IANA zone, saved only when the profile has none yet.
    if (!ctx.currentTimezone && typeof body.timezone === "string" && body.timezone.length <= 64) {
      if (validTimeZone(body.timezone)) patch.timezone = body.timezone;
      else errors.timezone = "invalid";
    }
  }

  return { patch, errors };
}

/** Required for the plan generator; onboarding is refused while any is missing. */
export function missingCoreFields(profile: Partial<UserProfile>): string[] {
  const missing: string[] = [];
  if (!profile.sex) missing.push("sex");
  if (!profile.age) missing.push("age");
  if (!profile.goal) missing.push("goal");
  if (!profile.level) missing.push("level");
  if (!(profile.trainingWeekdays ?? []).length) missing.push("trainingWeekdays");
  if (!profile.equipment) missing.push("equipment");
  return missing;
}
