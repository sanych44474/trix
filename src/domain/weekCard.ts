import { setVolumeKg } from "./sessionLoad";
import type { WorkoutLogDoc } from "../types";

interface WeekStats {
  done: number;
  skipped: number;
  totalSets: number;
  volumeKg: number;
}

/** Aggregate a week of workout logs into the shareable-card numbers.
 * Volume is the same as the workout summary's (domain/sessionLoad.ts): weight × reps, bodyweight
 * moves counted by the share of body weight they lift when it is known; timed sets add to set count. */
export function weekStats(logs: WorkoutLogDoc[], bodyweightKg?: number): WeekStats {
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
        volumeKg += setVolumeKg(e.name, s, bodyweightKg);
      }
    }
  }
  return { done, skipped, totalSets, volumeKg: Math.round(volumeKg) };
}
