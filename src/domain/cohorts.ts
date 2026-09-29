// Retention by signup cohort for the owner console: of the people who joined in a given week,
// what share logged a completed workout in their 1st, 2nd, 4th and 8th week. The funnel and DAU
// show how many are active now; this shows *when* people drop off. A cohort only counts toward a
// week once all its members have lived through it, so young cohorts show "—", not a fake 0%.
// Pure; test/cohorts.test.ts.

export const RETENTION_WEEKS = [1, 2, 4, 8] as const;

export interface CohortMember {
  joined: string; // YYYY-MM-DD
  trainedWeeks: number[]; // week offsets since joining with a completed workout (0 = days 0–6)
}

export interface CohortRow {
  cohort: string; // Monday of the signup week, or "all"
  size: number;
  rates: Array<number | null>; // per RETENTION_WEEKS entry, 0–100; null = too young to tell
}

function mondayOf(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

function rates(members: CohortMember[], today: string): Array<number | null> {
  return RETENTION_WEEKS.map((week) => {
    // Eligible: the whole of week N has passed for this member.
    const eligible = members.filter((m) => daysBetween(m.joined, today) >= week * 7);
    if (!eligible.length) return null;
    const hit = eligible.filter((m) => m.trainedWeeks.includes(week - 1)).length;
    return Math.round((hit / eligible.length) * 100);
  });
}

/** Newest signup week first, at most `limit` cohorts, then an "all" row over every member. */
export function cohortRetention(members: CohortMember[], today: string, limit = 10): CohortRow[] {
  const byWeek = new Map<string, CohortMember[]>();
  for (const m of members) {
    const key = mondayOf(m.joined);
    byWeek.set(key, [...(byWeek.get(key) ?? []), m]);
  }
  const rows = [...byWeek.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .slice(0, limit)
    .map(([cohort, ms]) => ({ cohort, size: ms.length, rates: rates(ms, today) }));
  return members.length ? [...rows, { cohort: "all", size: members.length, rates: rates(members, today) }] : rows;
}

/** The steepest fall between consecutive retention weeks in the "all" row, if any. */
export function biggestDrop(all: CohortRow | undefined): { from: number; to: number; fromRate: number; toRate: number } | null {
  if (!all) return null;
  let best: { from: number; to: number; fromRate: number; toRate: number } | null = null;
  for (let i = 1; i < RETENTION_WEEKS.length; i++) {
    const a = all.rates[i - 1];
    const b = all.rates[i];
    if (a == null || b == null) continue;
    if (!best || a - b > best.fromRate - best.toRate) best = { from: RETENTION_WEEKS[i - 1]!, to: RETENTION_WEEKS[i]!, fromRate: a, toRate: b };
  }
  return best && best.fromRate > best.toRate ? best : null;
}
