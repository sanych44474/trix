// Owner roster data shapes: intake progress and the user-row type the report and the Mini App
// owner console share.
import type { UserProfile } from "../types";

// Intake essentials the interview must collect — used to show onboarding progress (X/N) in the
// owner report. Keep in sync with the "essentials" list in P.interviewSystem.
export const INTAKE_ESSENTIALS: (keyof UserProfile)[] = [
  "name", "weightKg", "heightCm", "age", "sex", "goal", "trainingHistory",
  "daysPerWeek", "trainingWeekdays", "equipment", "sleepSchedule", "lifestyle",
  "limitations", "dietPrefs", "favoriteExercises", "dislikedExercises", "timezone", "reminderHour",
];

// How many intake essentials are filled out of the total (waist counts as the measurements gate).
export function interviewProgress(profile: UserProfile): { filled: number; total: number } {
  let filled = 0;
  for (const k of INTAKE_ESSENTIALS) {
    const v = profile[k];
    if (Array.isArray(v) ? v.length > 0 : v !== undefined && v !== null && v !== "") filled++;
  }
  if (profile.measurements?.waist !== undefined) filled++;
  return { filled, total: INTAKE_ESSENTIALS.length + 1 };
}

// 👤 Users: full roster table (most-active first) + recent feedback.
// Structured user rows for the Mini App owner console — the same data as the text report, but
// as JSON so the app can render an interactive (sortable / groupable) table.
export interface OwnerUserRow {
  id: number; name: string; nick: string; trainer: string;
  status: "banned" | "blocked" | "onboarding" | "active" | "draft" | "none";
  onb: string; w: number; c: number; n: number; s: number; last: string; total: number;
  lastSeen?: string; // full ISO timestamp of the last interaction (absent = never seen)
}
