// Geometry for the Progress weight chart: points placed on a real kg scale (min..max of the data,
// padded, at least 2 kg tall) instead of the old fixed ±5 kg window around the first weigh-in,
// plus the numbers the chart labels show. Pure; test/mini-app-weight-chart.test.ts.

export interface WeightPoint { date: string; kg: number }

export interface WeightChartModel {
  min: number;
  max: number;
  pts: Array<WeightPoint & { x: number; y: number }>; // x, y in 0..100 (y from the bottom)
  trend: Array<{ x: number; y: number; kg: number }>; // 7-day rolling average, one per weigh-in
  goalY?: number; // the goal line, when the goal sits inside the drawn range
  deltaKg: number; // change of the 7-day average, last − first (daily water swings cancel out)
  spanDays: number;
}

export function weightChartModel(points: WeightPoint[], goal?: number): WeightChartModel | null {
  const sorted = [...points].filter((p) => p.kg > 0).sort((a, b) => (a.date < b.date ? -1 : 1));
  if (sorted.length < 2) return null;
  const kgs = sorted.map((p) => p.kg);
  let lo = Math.min(...kgs), hi = Math.max(...kgs);
  // Pull a nearby goal into view (within 5 kg of the data) so the line can be drawn.
  if (goal && goal > 0 && goal >= lo - 5 && goal <= hi + 5) { lo = Math.min(lo, goal); hi = Math.max(hi, goal); }
  const pad = Math.max(0.5, (hi - lo) * 0.15);
  lo -= pad; hi += pad;
  if (hi - lo < 2) { const mid = (hi + lo) / 2; lo = mid - 1; hi = mid + 1; }
  const min = Math.floor(lo * 2) / 2, max = Math.ceil(hi * 2) / 2;
  const t0 = Date.parse(sorted[0]!.date), t1 = Date.parse(sorted[sorted.length - 1]!.date);
  const span = Math.max(1, t1 - t0);
  const y = (kg: number) => ((kg - min) / (max - min)) * 100;
  const avg = rollingAverage(sorted);
  return {
    min, max,
    pts: sorted.map((p) => ({ ...p, x: ((Date.parse(p.date) - t0) / span) * 100, y: y(p.kg) })),
    trend: sorted.map((p, i) => ({ x: ((Date.parse(p.date) - t0) / span) * 100, y: y(avg[i]!), kg: avg[i]! })),
    ...(goal && goal >= min && goal <= max ? { goalY: y(goal) } : {}),
    deltaKg: Math.round((avg[avg.length - 1]! - avg[0]!) * 10) / 10,
    spanDays: Math.round((t1 - t0) / 86_400_000),
  };
}

/** For each weigh-in, the mean of the weigh-ins in the 7 days ending on it — the number that
 *  answers "am I losing?", where single days swing 0.5–1.5 kg on water and salt. */
export function rollingAverage(sorted: WeightPoint[], days = 7): number[] {
  return sorted.map((p) => {
    const end = Date.parse(p.date), start = end - (days - 1) * 86_400_000;
    const win = sorted.filter((q) => { const t = Date.parse(q.date); return t >= start && t <= end; });
    return Math.round((win.reduce((a, q) => a + q.kg, 0) / win.length) * 100) / 100;
  });
}
