// How long a plan day takes, from the plan itself: every set is ~40 s of work followed by the
// rest written for that exercise (90 s when none is), minus the rest after an exercise's last set
// (a cardio entry like "20-25 min" counts its own duration),
// plus a minute to change stations between exercises and a 5-minute warm-up. Rounded to 5 min.

import { DURATION_ONLY, planSetCount } from "./muscleLoad";
import { parseRestSec } from "./restTime";

const WORK_SEC = 40;
const DEFAULT_REST_SEC = 90;
const CHANGEOVER_SEC = 60;
const WARMUP_SEC = 5 * 60;

export function estimateSessionMinutes(exercises: { sets?: string; rest?: string }[]): number {
  if (exercises.length === 0) return 0;
  let sec = WARMUP_SEC + CHANGEOVER_SEC * (exercises.length - 1);
  for (const ex of exercises) {
    const minutes = durationMinutes(ex.sets);
    if (minutes !== null) { sec += minutes * 60; continue; } // "20-25 min" of cardio
    const sets = planSetCount(ex.sets);
    sec += sets * WORK_SEC + (sets - 1) * (parseRestSec(ex.rest) ?? DEFAULT_REST_SEC);
  }
  return Math.max(5, Math.round(sec / 300) * 5);
}

/** "20-25 min" / "20–30 хв" → 22.5; null for anything that isn't a plain duration. */
function durationMinutes(sets: string | undefined): number | null {
  if (!DURATION_ONLY.test(sets ?? "")) return null;
  const m = /(\d+(?:[.,]\d+)?)(?:\s*[-–]\s*(\d+(?:[.,]\d+)?))?\s*(min|хв|мин)(?!\p{L})/iu.exec(sets ?? "");
  if (!m) return null;
  const lo = Number(m[1]!.replace(",", "."));
  const hi = m[2] ? Number(m[2].replace(",", ".")) : lo;
  return (lo + hi) / 2;
}
