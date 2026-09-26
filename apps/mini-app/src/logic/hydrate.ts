import type { WorkoutToday } from "../types";

type LoggerExercise = WorkoutToday["exercises"][number];
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
 * The saved log is the source of truth, in the order it was logged. Matching it back onto the plan
 * by name alone (the old behaviour) silently dropped every swapped or custom exercise: re-opening
 * the app after saving showed the plan's original exercises, empty, as if the session never
 * happened. Now every saved entry is kept -- merged with its plan exercise when the names match
 * (so rest/technique/video survive), standalone otherwise. Plan exercises that weren't logged yet
 * follow, so a mid-session save can still be continued -- except ones that were swapped out: a
 * swap keeps the plan slot, so each saved entry that matched nothing is taken to have replaced
 * the earliest unlogged plan exercise. (Same-device re-entry doesn't rely on this guess at all:
 * the local draft is kept after a save and restores the exact list.)
 */
export function hydrateSaved(data: WorkoutToday): WorkoutToday {
  if (!data.saved?.length) return data;
  const plan = data.exercises;
  const used = new Set<number>();
  const merged: LoggerExercise[] = data.saved.map((entry) => {
    const at = plan.findIndex((exercise, i) => !used.has(i) && exercise.name === entry.name);
    const setsDone = savedSets(entry);
    const rpe = entry.rpe !== undefined ? { rpe: entry.rpe } : {};
    if (at >= 0) {
      used.add(at);
      return { ...plan[at], setsDone, ...rpe };
    }
    return { index: 0, name: entry.name, metric: savedMetric(entry), sets: setsDone.length || 1, setsDone, ...rpe };
  });
  // Swapped-out plan exercises: one per saved entry that matched no plan name. The swap button
  // replaces a slot in place, so the saved entry is taken to stand for the earliest unlogged one.
  let toDrop = merged.filter((exercise) => !plan.some((p) => p.name === exercise.name)).length;
  const remaining = plan.filter((_, i) => {
    if (used.has(i)) return false;
    if (toDrop > 0) { toDrop -= 1; return false; }
    return true;
  });
  return { ...data, exercises: [...merged, ...remaining].map((exercise, index) => ({ ...exercise, index })) };
}
