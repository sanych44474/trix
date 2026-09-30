// User-activity metrics for the Grafana "trix — user activity" dashboard (GET /admin/metrics/activity,
// grafana/user-activity.json): daily active users and what they did, WAU/MAU and stickiness,
// feature adoption, top events and signup-cohort retention. The D1 adapter
// (adapters/d1/activityMetrics.ts) returns raw per-day aggregates; this assembles them into flat
// row arrays the Infinity datasource reads without transforms. Pure; test/activity-metrics.test.ts.
import { cohortRetention, type CohortMember } from "./cohorts";

export type ActivityKind = "workouts" | "nutrition" | "checkins" | "water" | "steps" | "events" | "signups";

export interface ActivityRaw {
  perDay: Array<{ date: string; kind: ActivityKind; n: number; users: number }>;
  dau: Array<{ date: string; users: number }>;
  wau: number;
  mau: number;
  totalUsers: number;
  adoption: Array<{ feature: string; users: number }>; // distinct users over the window
  topEvents: Array<{ event: string; n: number; users: number }>;
  cohorts: CohortMember[];
  topUsers: Array<{ id: number; name: string; workouts: number; nutritionDays: number; activeDays: number; lastActive: string }>;
}

export interface ActivityDay {
  date: string;
  dau: number;
  workouts: number;
  workoutUsers: number;
  nutritionUsers: number;
  checkins: number;
  waterUsers: number;
  stepsUsers: number;
  events: number;
  signups: number;
}

function isoDaysBefore(today: string, n: number): string {
  return new Date(Date.parse(`${today}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);
}

export function buildActivityMetrics(raw: ActivityRaw, today: string, days: number) {
  const daily: ActivityDay[] = [];
  for (let i = days - 1; i >= 0; i--) {
    daily.push({ date: isoDaysBefore(today, i), dau: 0, workouts: 0, workoutUsers: 0, nutritionUsers: 0, checkins: 0, waterUsers: 0, stepsUsers: 0, events: 0, signups: 0 });
  }
  const byDate = new Map(daily.map((d) => [d.date, d]));
  for (const r of raw.perDay) {
    const d = byDate.get(r.date);
    if (!d) continue;
    if (r.kind === "workouts") { d.workouts = r.n; d.workoutUsers = r.users; }
    else if (r.kind === "nutrition") d.nutritionUsers = r.users;
    else if (r.kind === "checkins") d.checkins = r.n;
    else if (r.kind === "water") d.waterUsers = r.users;
    else if (r.kind === "steps") d.stepsUsers = r.users;
    else if (r.kind === "events") d.events = r.n;
    else if (r.kind === "signups") d.signups = r.n;
  }
  for (const r of raw.dau) {
    const d = byDate.get(r.date);
    if (d) d.dau = r.users;
  }
  const last7 = daily.slice(-7);
  const avgDau7 = last7.length ? last7.reduce((s, d) => s + d.dau, 0) / last7.length : 0;
  const share = (n: number) => (raw.totalUsers ? Math.round((n / raw.totalUsers) * 1000) / 10 : 0);
  return {
    generatedAt: new Date().toISOString(),
    windowDays: days,
    summary: {
      totalUsers: raw.totalUsers,
      dauToday: daily.at(-1)?.dau ?? 0,
      avgDau7: Math.round(avgDau7 * 10) / 10,
      wau: raw.wau,
      mau: raw.mau,
      // DAU/MAU: how many days a month the typical monthly user shows up (x30).
      stickinessPct: raw.mau ? Math.round((avgDau7 / raw.mau) * 1000) / 10 : 0,
      mauSharePct: share(raw.mau),
      workouts7: last7.reduce((s, d) => s + d.workouts, 0),
      signups7: last7.reduce((s, d) => s + d.signups, 0),
    },
    daily,
    adoption: raw.adoption.map((a) => ({ ...a, sharePct: share(a.users) })).sort((a, b) => b.users - a.users),
    topEvents: raw.topEvents,
    retention: cohortRetention(raw.cohorts, today, 12).map((r) => ({
      cohort: r.cohort, size: r.size, w1: r.rates[0] ?? null, w2: r.rates[1] ?? null, w4: r.rates[2] ?? null, w8: r.rates[3] ?? null,
    })),
    topUsers: raw.topUsers,
  };
}

export type ActivityMetrics = ReturnType<typeof buildActivityMetrics>;
