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

/** Days between two ISO dates, or Infinity when `fromIso` is unset (never sent → always due). */
export function daysBetween(fromIso: string | undefined, toIso: string): number {
  if (!fromIso) return Infinity;
  return (Date.parse(toIso) - Date.parse(fromIso)) / 86_400_000;
}

// ---- Night guard and daily cap for proactive reminders (scheduler.ts processUser) ----

/** At most this many proactive reminders per local day (opt-in water nudges excluded). */
export const DAILY_NUDGE_CAP = 3;

/**
 * Quiet hours for someone who never set their own: 22:00–07:00, shifted so it never swallows the
 * person's own reminder hour (a 22:00 reminder moves the start to 23:00) or the readiness check
 * an hour before an early one (a 06:00 reminder ends the night at 05:00).
 */
export function defaultQuietHours(reminderHour: number): { from: number; to: number } {
  const from = reminderHour >= 22 ? reminderHour + 1 : 22; // 24 means "no evening quiet"
  const to = Math.min(7, Math.max(0, reminderHour - 1));
  return { from, to };
}

/** True when `hour` is inside quiet hours: the person's own when set, otherwise the default. */
export function isQuietHour(hour: number, reminderHour: number, quietFrom?: number, quietTo?: number): boolean {
  if (quietFrom !== undefined && quietTo !== undefined && quietFrom !== quietTo) {
    return quietFrom < quietTo ? hour >= quietFrom && hour < quietTo : hour >= quietFrom || hour < quietTo;
  }
  const d = defaultQuietHours(reminderHour);
  return hour >= d.from || hour < d.to;
}

/** Reminders already sent today, from the stored "<date>:<n>" counter (another day reads as 0). */
export function nudgesSentToday(stored: string | undefined, date: string): number {
  if (!stored) return 0;
  const [d, n] = stored.split(":");
  return d === date ? Number(n) || 0 : 0;
}
