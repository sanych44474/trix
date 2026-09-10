// First-14-days activation arc — pure, no DB. The single strongest churn predictor in fitness
// apps is how many sessions land in the first two weeks: fewer than three and the user is several
// times more likely to be gone by day 30. Every other nudge in the scheduler is steady-state and
// treats a two-day-old account exactly like a six-month-old one, so a new user's decisive first
// fortnight had no deliberate arc at all. This module decides which beat of that arc is due.

const DAY = 86_400_000;

export type ActivationStep = "act_first" | "act_win" | "act_week" | "act_locked";

export interface ActivationNudge {
  step: ActivationStep;
  onTrack: boolean;
  workouts: number;
  dayIndex: number;
}

/** Completed sessions inside the window that separate "stuck" from "started". */
export const ACTIVATION_TARGET = 3;
/** Day of the arc's last beat; the arc itself is over after ACTIVATION_LAST_DAY. */
export const ACTIVATION_FINAL_DAY = 14;
// A beat is still worth sending a little late (a blocked bot, a quiet-hours streak, a user who
// only opens Telegram on weekends), but not weeks later — past this the arc is simply over and
// the steady-state reminders own the relationship.
export const ACTIVATION_LAST_DAY = 21;

/** 1-based day of the arc: the join date itself is day 1. Negative/NaN inputs give 0. */
export function activationDay(joinedDate: string, today: string): number {
  const a = Date.parse(`${joinedDate}T00:00:00Z`);
  const b = Date.parse(`${today}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return 0;
  return Math.floor((b - a) / DAY) + 1;
}

/**
 * The beat of the activation arc due today, or null. One beat per call, each sent at most once
 * ever (the caller passes what it has already delivered). Ordered so the earliest unsent beat
 * that still applies wins — a user who goes quiet for a week gets the missed beat first, then
 * catches up on later ticks, rather than being handed the whole arc at once.
 */
export function nextActivationStep(args: {
  joinedDate: string;
  today: string;
  workouts: number; // completed sessions since joining
  sentSteps: readonly string[];
}): ActivationNudge | null {
  const dayIndex = activationDay(args.joinedDate, args.today);
  if (dayIndex < 2 || dayIndex > ACTIVATION_LAST_DAY) return null;
  const workouts = Math.max(0, args.workouts);
  const sent = new Set(args.sentSteps);
  const due = (step: ActivationStep, onTrack: boolean): ActivationNudge => ({ step, onTrack, workouts, dayIndex });

  // Day 2+, still nothing logged: the plan is sitting there unused. This is the single highest-
  // value moment in the whole lifecycle, and it gets the lowest-barrier ask.
  if (!sent.has("act_first") && workouts === 0) return due("act_first", false);
  // First session in the bag — say what it unlocked, while it still feels like a decision.
  if (!sent.has("act_win") && workouts >= 1) return due("act_win", true);
  // Week one done. Two sessions is on pace for the target; below that the fix is a smaller
  // commitment, not more nagging.
  if (!sent.has("act_week") && dayIndex >= 8) return due("act_week", workouts >= 2);
  // The line itself.
  if (!sent.has("act_locked") && dayIndex >= ACTIVATION_FINAL_DAY) {
    return due("act_locked", workouts >= ACTIVATION_TARGET);
  }
  return null;
}
