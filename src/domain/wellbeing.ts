// Wellbeing check-in averages and trend (energy / sleep / stress, 1-5). Pure: the bot's /well
// screen and the Mini App / native wellbeing route both read the same numbers from here.
import type { DailyCheckinDoc } from "../types";

export type WellbeingMetric = "energy" | "sleep" | "stress";

type Averages = Record<WellbeingMetric, number>;

function meansOf(checkins: DailyCheckinDoc[]): Averages {
  const avg = (sel: (c: DailyCheckinDoc) => number) => checkins.reduce((s, c) => s + sel(c), 0) / checkins.length;
  return { energy: avg((c) => c.energy), sleep: avg((c) => c.sleep), stress: avg((c) => c.stress) };
}

/** Averages over the given check-ins (unrounded), or null when there are fewer than two. */
export function wellbeingAverages(checkins: DailyCheckinDoc[]): Averages | null {
  return checkins.length < 2 ? null : meansOf(checkins);
}

/**
 * Change per metric between the first and second half of the window (check-ins are date-ordered),
 * unrounded: positive means the metric rose. Null when there are fewer than two check-ins.
 */
export function wellbeingTrend(checkins: DailyCheckinDoc[]): Averages | null {
  if (checkins.length < 2) return null;
  const mid = Math.floor(checkins.length / 2);
  const first = meansOf(checkins.slice(0, mid));
  const second = meansOf(checkins.slice(mid));
  return { energy: second.energy - first.energy, sleep: second.sleep - first.sleep, stress: second.stress - first.stress };
}
