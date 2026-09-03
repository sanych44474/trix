// At-risk client detection — pure, no DB. Flags a client who missed two consecutive planned
// training days, or lapsed on food logging after being regular. The scheduler feeds raw dates in.

const DAY = 86_400_000;

function isoWeekday(dateStr: string): number {
  const d = new Date(`${dateStr}T00:00:00Z`);
  return ((d.getUTCDay() + 6) % 7) + 1; // 1 = Mon … 7 = Sun
}
function minusDays(dateStr: string, days: number): string {
  return new Date(Date.parse(dateStr) - days * DAY).toISOString().slice(0, 10);
}

/**
 * The last `n` planned training dates strictly before `today`, newest first. `notBefore` (YYYY-MM-DD)
 * excludes dates earlier than a floor — e.g. before the plan started or the client joined — so a
 * brand-new client isn't credited with "missing" sessions that predate them.
 */
export function lastPlannedDates(planWeekdays: number[], today: string, n: number, notBefore?: string): string[] {
  if (!planWeekdays.length || n <= 0) return [];
  const set = new Set(planWeekdays);
  const out: string[] = [];
  for (let i = 1; i <= 60 && out.length < n; i++) {
    const d = minusDays(today, i);
    if (notBefore && d < notBefore) break; // dates decrease as i grows → nothing older will qualify
    if (set.has(isoWeekday(d))) out.push(d);
  }
  return out;
}

/**
 * The two most recent planned dates before today; if BOTH are missing from `completed`, returns
 * `[older, newer]` (the miss to report). Null when fewer than two planned dates or either was done.
 * `notBefore` floors the window (plan start / join date) so new clients aren't false-flagged.
 */
export function missedConsecutiveWorkouts(
  planWeekdays: number[],
  completed: Iterable<string>,
  today: string,
  notBefore?: string,
): [string, string] | null {
  const last2 = lastPlannedDates(planWeekdays, today, 2, notBefore);
  if (last2.length < 2) return null;
  const done = completed instanceof Set ? completed : new Set(completed);
  const [newer, older] = last2; // newest first
  if (!done.has(newer) && !done.has(older)) return [older, newer];
  return null;
}

export interface NutritionLapse {
  lastLogged: string;
  gapDays: number;
}

/**
 * A food-logging lapse: the client was regular (≥`regularMin` distinct days in the 14-day window
 * ending at their last log) but hasn't logged for ≥`gapThreshold` days. Never/sporadic loggers
 * don't trigger. Null otherwise.
 */
export function nutritionLapse(
  logDates: string[],
  today: string,
  opts: { gapThreshold?: number; regularMin?: number } = {},
): NutritionLapse | null {
  const gapThreshold = opts.gapThreshold ?? 3;
  const regularMin = opts.regularMin ?? 7;
  const dates = [...new Set(logDates)].sort();
  const lastLogged = dates[dates.length - 1];
  if (!lastLogged) return null;
  const gapDays = Math.round((Date.parse(today) - Date.parse(lastLogged)) / DAY);
  if (gapDays < gapThreshold) return null;
  const windowStart = minusDays(lastLogged, 13); // 14-day inclusive window ending at lastLogged
  const regularDays = dates.filter((d) => d >= windowStart && d <= lastLogged).length;
  if (regularDays < regularMin) return null;
  return { lastLogged, gapDays };
}
