import type { WorkoutLogDoc } from "../types";

export interface WeekStats {
  done: number;
  skipped: number;
  totalSets: number;
  volumeKg: number;
}

/** Aggregate a week of workout logs into the shareable-card numbers.
 * Volume counts weighted sets only (weight × reps); bodyweight/timed sets add to set count. */
export function weekStats(logs: WorkoutLogDoc[]): WeekStats {
  let done = 0;
  let skipped = 0;
  let totalSets = 0;
  let volumeKg = 0;
  for (const l of logs) {
    if (!l.completed) {
      skipped++;
      continue;
    }
    done++;
    for (const e of l.exercises) {
      if (e.skipped) continue;
      for (const s of e.setsDone) {
        totalSets++;
        volumeKg += (s.weight || 0) * (s.reps || 0);
      }
    }
  }
  return { done, skipped, totalSets, volumeKg: Math.round(volumeKg) };
}
