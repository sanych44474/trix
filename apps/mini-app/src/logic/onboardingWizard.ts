// The onboarding questionnaire flow: one question per screen. The questions (ids, options, ranges,
// which ones show) come from GET /api/v2/onboarding/questions; this module decides the order for
// this person, validates answers against the server's ranges and builds the request. Pure, so the
// order, validation and request are tested without rendering.
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

/** One question as the server sends it (labels are catalog keys). */
export interface ServerQuestion {
  id: StepId;
  kind: "choice" | "number" | "lifts" | "days" | "text";
  q: string;
  hint?: string;
  options?: { value: string; label: string }[];
  number?: { min: number; max: number; step: number; unit: string; placeholder: string };
  showWhen: "always" | "nonBeginner" | "trainerClient";
  basics?: boolean;
}

export type Option = { value: string; label: Key };

export interface Step {
  id: StepId;
  q: Key;
  hint?: Key;
  kind: "choice" | "number" | "lifts" | "days" | "text";
  options?: Option[];
  number?: { min: number; max: number; step: number; unit: Key; placeholder: string };
  showWhen: ServerQuestion["showWhen"];
  basics: boolean;
}

/**
 * Turns the server's question set into steps. The label keys are the Mini App catalog's; a test
 * (test/mini-app-onboarding-wizard.test.ts) checks that every one of them exists, so the cast is safe.
 */
export function stepsFrom(questions: ServerQuestion[]): Step[] {
  return questions.map((s) => ({
    id: s.id,
    q: s.q as Key,
    hint: s.hint as Key | undefined,
    kind: s.kind,
    options: s.options?.map((o) => ({ value: o.value, label: o.label as Key })),
    number: s.number && { ...s.number, unit: s.number.unit as Key },
    showWhen: s.showWhen,
    basics: s.basics === true,
  }));
}

/** The steps for this person, in order. Lifts appear only past beginner; sharing only for a client. */
export function stepsFor(all: Step[], answers: Answers, isClient: boolean): Step[] {
  return all.filter((s) => {
    if (s.showWhen === "nonBeginner") return answers.level !== undefined && answers.level !== "beginner";
    if (s.showWhen === "trainerClient") return isClient;
    return true;
  });
}

/** The body-data questions asked before a ready program is applied (the no-questionnaire entry):
 *  the program's start weights and calorie targets need them. */
export function basicSteps(all: Step[]): Step[] {
  return all.filter((s) => s.basics);
}

/** The profile patch for the basics (POST /api/v2/profile); null while one is missing. */
export function basicsRequest(all: Step[], a: Answers) {
  if (!basicSteps(all).every((s) => isAnswered(s, a))) return null;
  return { sex: a.sex!, age: Math.round(a.age!), heightCm: Math.round(a.heightCm!), weightKg: Math.round(a.weightKg! * 10) / 10 };
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
export function firstOpenStep(all: Step[], a: Answers, isClient: boolean): number {
  const steps = stepsFor(all, a, isClient);
  const i = steps.findIndex((s) => !isAnswered(s, a));
  return i === -1 ? steps.length - 1 : i;
}

const liftsText = (l: Answers["lifts"]) =>
  ([["bench", l?.bench], ["squat", l?.squat], ["deadlift", l?.deadlift]] as const)
    .filter(([, v]) => v !== undefined && v > 0)
    .map(([k, v]) => `${k} ${v}kg`)
    .join(", ") || "none";

/** The /api/v2/onboarding body; null while a required answer is missing. */
export function toRequest(all: Step[], a: Answers, isClient: boolean, timezone?: string) {
  const steps = stepsFor(all, a, isClient);
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
