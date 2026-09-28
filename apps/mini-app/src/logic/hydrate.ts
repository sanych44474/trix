import type { WorkoutToday } from "../types";

type LoggerExercise = WorkoutToday["exercises"][number] & { planName?: string };
type SavedEntry = NonNullable<WorkoutToday["saved"]>[number];

// Logs don't store the metric, so infer it from what was recorded (same rule as the server's
// loggedMetric in src/webapp/workout.ts).
function savedMetric(entry: SavedEntry): LoggerExercise["metric"] {
  if (entry.sets.some((set) => set.sec > 0)) return "time";
  if (entry.sets.some((set) => set.m > 0)) return "distance";
  return "reps";
}

function savedSets(entry: SavedEntry): NonNullable<LoggerExercise["setsDone"]> {
  return entry.sets.map((set) => ({ weight: set.w, reps: set.r, seconds: set.sec || undefined, meters: set.m || undefined, rpe: entry.rpe }));
}

/**
 * Rebuilds the logger from what the server already has saved for this date.
 *
 * The saved log is the source of truth, in the order it was logged. Every saved entry is kept --
 * merged with its plan exercise when the names match (so rest/technique/video survive), standalone
 * otherwise. Plan exercises that weren't logged yet follow, so a mid-session save can still be
 * continued, except the ones that were swapped out.
 *
 * Which plan exercise a swap replaced is saved with the log (`planName`), so it is known exactly.
 * Logs saved before that existed don't carry it; for those, each entry that matched no plan name
 * is taken to have replaced the earliest unlogged plan exercise (the swap button replaces a slot
 * in place, so that is usually right).
 */
export function hydrateSaved(data: WorkoutToday): WorkoutToday & { exercises: LoggerExercise[] } {
  if (!data.saved?.length) return data;
  const plan = data.exercises;
  const used = new Set<number>();
  const claim = (name: string): number => {
    const at = plan.findIndex((exercise, i) => !used.has(i) && exercise.name === name);
    if (at >= 0) used.add(at);
    return at;
  };
  let guesses = 0;
  const merged: LoggerExercise[] = data.saved.map((entry) => {
    const setsDone = savedSets(entry);
    const rpe = entry.rpe !== undefined ? { rpe: entry.rpe } : {};
    const at = claim(entry.name);
    if (at >= 0) return { ...plan[at], setsDone, ...rpe };
    // A swap: inherit the replaced slot's plan metadata only where it still fits (rest time); the
    // name, metric and sets are what was actually done.
    const slot = entry.planName ? claim(entry.planName) : -1;
    if (!entry.planName) guesses += 1;
    return {
      index: 0,
      name: entry.name,
      metric: savedMetric(entry),
      sets: setsDone.length || 1,
      setsDone,
      ...rpe,
      ...(slot >= 0 && plan[slot].restSec !== undefined ? { restSec: plan[slot].restSec } : {}),
      ...(entry.planName ? { planName: entry.planName } : {}),
    };
  });
  const remaining = plan.filter((_, i) => {
    if (used.has(i)) return false;
    if (guesses > 0) { guesses -= 1; return false; }
    return true;
  });
  return { ...data, exercises: [...merged, ...remaining].map((exercise, index) => ({ ...exercise, index })) };
}
