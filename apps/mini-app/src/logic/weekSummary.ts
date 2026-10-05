// The last full week (Mon–Sun) in one card on Today, built from what the dashboard already
// carries — no extra request: workouts done vs planned, the change in average weight against the
// week before, days with food logged, new strength records (e1RM above every earlier point), and
// one focus for the week ahead picked by a fixed rule. Pure; test/mini-app-week-summary.test.ts.

export interface WeekSummaryInput {
  today: string;
  days: Array<{ date: string; s: "done" | "missed" | "rest" }>;
  plannedWeekdays: number[];
  weights: Array<{ date: string; kg: number }>;
  foodDays: Array<{ date: string; kcal: number }>;
  exercises: Array<{ name: string; points: Array<{ date: string; e1rm: number }> }>;
}

export type WeekFocus = "workouts" | "weigh" | "food" | "keep";

export interface WeekSummary {
  start: string; end: string;
  workouts: number; planned: number;
  weightDelta?: number; // kg, this week's average minus the week before's
  foodDays: number;
  records: string[];
  focus: WeekFocus;
}

const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const DAY = 86_400_000;

export function lastWeekSummary(i: WeekSummaryInput): WeekSummary {
  const t = Date.parse(`${i.today}T00:00:00Z`);
  const dow = (new Date(t).getUTCDay() + 6) % 7; // Mon = 0
  const start = iso(t - (dow + 7) * DAY), end = iso(t - (dow + 1) * DAY);
  const prevStart = iso(Date.parse(`${start}T00:00:00Z`) - 7 * DAY);
  const inWeek = (d: string) => d >= start && d <= end;
  const workouts = i.days.filter((d) => inWeek(d.date) && d.s === "done").length;
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined);
  const wNow = mean(i.weights.filter((w) => inWeek(w.date)).map((w) => w.kg));
  const wPrev = mean(i.weights.filter((w) => w.date >= prevStart && w.date < start).map((w) => w.kg));
  const weightDelta = wNow !== undefined && wPrev !== undefined ? Math.round((wNow - wPrev) * 10) / 10 : undefined;
  const foodDays = new Set(i.foodDays.filter((d) => inWeek(d.date) && d.kcal > 0).map((d) => d.date)).size;
  const records = i.exercises.filter((e) => {
    const before = e.points.filter((p) => p.date < start).map((p) => p.e1rm);
    const during = e.points.filter((p) => inWeek(p.date)).map((p) => p.e1rm);
    return before.length > 0 && during.length > 0 && Math.max(...during) > Math.max(...before) + 1e-9;
  }).map((e) => e.name);
  const planned = i.plannedWeekdays.length;
  const weighIns = i.weights.filter((w) => inWeek(w.date)).length;
  const focus: WeekFocus = planned > 0 && workouts < planned ? "workouts" : weighIns < 3 ? "weigh" : foodDays < 5 ? "food" : "keep";
  return { start, end, workouts, planned, ...(weightDelta !== undefined ? { weightDelta } : {}), foodDays, records, focus };
}
