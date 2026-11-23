// Which day a workout may be saved for, and whether a save was made against an outdated copy of
// that day. Shared by the athlete's own save and the trainer's save for a client (ADR-0018), so
// both follow one rule. Pure; test/edit-window.test.ts.

/** How far back a logged day can still be added or corrected. */
export const EDIT_WINDOW_DAYS = 14;

/** A real calendar date as YYYY-MM-DD. V8 reads "2026-02-30" as 2 March, so parse and round-trip. */
export function isCalendarDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const ms = Date.parse(`${date}T00:00:00Z`);
  return !Number.isNaN(ms) && new Date(ms).toISOString().slice(0, 10) === date;
}

/** Null when `date` may be edited given the person's local `today`, else the reason. */
export function editDateError(date: string, today: string, days = EDIT_WINDOW_DAYS): string | null {
  if (!isCalendarDate(date)) return "bad date";
  if (date > today) return "future date";
  const floor = new Date(Date.parse(`${today}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10);
  if (date < floor) return "too old";
  return null;
}

/** A trainer's form is based on the day as it was when they opened it (`baseSavedAt`, null for a
 * day with nothing logged). If the day has been saved since, a blind save would wipe what the
 * client logged in the meantime, so it is refused and the form reloaded. */
export function isStaleBase(baseSavedAt: string | null, currentSavedAt: string | null): boolean {
  return (baseSavedAt ?? null) !== (currentSavedAt ?? null);
}
