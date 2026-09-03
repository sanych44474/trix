// Smart reminder timing — pure. Learns when the user actually logs workouts (local hour of
// each log) and proposes moving the static reminder hour to ~1h before that habitual time.
const MIN_SAMPLES = 5;
const CONSISTENCY_WINDOW_H = 1.5; // samples within ±this of the median count as "consistent"
const MIN_CONSISTENT_SHARE = 0.6;
const MIN_SHIFT_H = 2; // don't bother the user over a <2h difference
const EARLIEST = 6;
const LATEST = 22;

/**
 * Returns the hour to suggest, or null when the pattern is too thin/noisy or already close
 * to the current setting. Suggestion = median logging hour minus 1 (clamped to 6..22).
 */
export function suggestReminderHour(logLocalHours: number[], currentHour: number): number | null {
  if (logLocalHours.length < MIN_SAMPLES) return null;
  const sorted = [...logLocalHours].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const near = sorted.filter((h) => Math.abs(h - median) <= CONSISTENCY_WINDOW_H).length;
  if (near / sorted.length < MIN_CONSISTENT_SHARE) return null;
  const suggested = Math.min(LATEST, Math.max(EARLIEST, median - 1));
  if (Math.abs(suggested - currentHour) < MIN_SHIFT_H) return null;
  return suggested;
}
