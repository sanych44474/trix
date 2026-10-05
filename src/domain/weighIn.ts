// Morning weigh-in nudge. The weight chart's 7-day average (and the adaptive calorie target) only
// work with 3–4 weigh-ins a week, but asking people who never weigh themselves is just noise. So:
// only someone who tracks weight (a goal weight, or 2+ weigh-ins in the last 30 days), only after
// 3+ days without one, only in the morning (when a weigh-in is comparable day to day), and at most
// every 3 days. Pure; test/weigh-in.test.ts.

export const WEIGH_IN_GAP_DAYS = 3;

export interface WeighInInput {
  today: string; // YYYY-MM-DD local
  hour: number; // local hour
  weightDates: string[]; // dates with a logged weight, any order
  hasGoalWeight: boolean;
  lastSent?: string; // last time this nudge went out
}

const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

/** Days since the last weigh-in when the nudge is due, else null. */
export function weighInDue(i: WeighInInput): number | null {
  if (i.hour < 7 || i.hour > 10) return null;
  const sorted = [...new Set(i.weightDates)].filter((d) => d <= i.today).sort();
  const recent = sorted.filter((d) => days(d, i.today) <= 30);
  if (!i.hasGoalWeight && recent.length < 2) return null;
  const last = sorted.at(-1);
  if (!last) return i.hasGoalWeight && (!i.lastSent || days(i.lastSent, i.today) >= WEIGH_IN_GAP_DAYS) ? 0 : null;
  const gap = days(last, i.today);
  if (gap < WEIGH_IN_GAP_DAYS) return null;
  if (gap > 45) return null; // stopped tracking long ago — the Sunday measure reminder covers them
  if (i.lastSent && days(i.lastSent, i.today) < WEIGH_IN_GAP_DAYS) return null;
  return gap;
}
