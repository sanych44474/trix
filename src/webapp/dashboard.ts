// Dashboard payload shape + PURE assembly for the Mini App: one JSON with everything the five
// charts need. `assemblePayload` (unit-tested by test/dashboard-payload.test.ts and, via
// buildClientCardPayload, test/client-card-payload.test.ts) takes already-fetched rows and does
// no I/O of its own. The D1 orchestration that fetches those rows — the former
// `buildDashboardPayload`/`buildTrainerSection`/`buildOwnerSection` that used to live in this
// file — now lives in src/adapters/d1/dashboardReader.ts, the concrete v2-native adapter for the
// `DashboardReader` application seam (src/application/dashboard.ts, Domain 10 of the v2 cutover —
// see docs/adr/0001-v2-seams-and-staged-cutover.md). This file has no D1 access at all.
import { projectWeight, weeklyVolume } from "../domain/analysis";
import { CONDITIONING_LANDMARK, conditioningWeek } from "../domain/conditioning";
import { recoveryScore, type RecoveryFactor, type RecoveryLabel } from "../domain/recovery";
import { muscleGroupOf } from "../domain/progression";
import { e1rm } from "../domain/records";
import type {
  BodyLogDoc,
  DailyCheckinDoc,
  Lang,
  NutritionLogDoc,
  NutritionTargets,
  PlanDoc,
  StrengthRecordDoc,
  UserDoc,
  Weekday,
  WorkoutLogDoc,
} from "../types";

export const CALENDAR_DAYS = 84; // 12 weeks
export const MACRO_DAYS = 7;

export interface DashboardPayload {
  lang: Lang;
  today: string; // YYYY-MM-DD in the user's timezone
  name?: string;
  weight: {
    points: { date: string; kg: number }[];
    goal?: number;
    projection?: { slopePerWeek: number; etaWeeks?: number; onTrack: boolean; reached: boolean };
  };
  calendar: {
    days: { date: string; s: "done" | "missed" | "rest" }[];
    plannedWeekdays: number[]; // ISO 1..7 — lets the client mark FUTURE training days
    split: { weekday: number; group: string; n: number }[]; // plan day summaries for the day card
    logs: { date: string; done: boolean; ex: { n: string; s: number }[] }[]; // what was actually done that day
  };
  volume: { group: string; sets: number; mev: number; mav: number; zone: string }[];
  // Conditioning (cardio) load for the same 7-day window — the other half of training volume,
  // which the strength bars above have never been able to show.
  conditioning: { sessions: number; minutes: number; meters: number; untimedSets: number; zone: string; targetMin: number; highMin: number };
  // Combines the daily check-in with what the app already knows from logged training -- see
  // domain/recovery.ts for why HRV/pulse are deliberately not inputs (no wearable integration).
  recovery: { score: number; label: RecoveryLabel; factors: RecoveryFactor[] };
  // Body measurements (cm) with >=2 points — waist/chest/hips/arm/thigh trend lines.
  measurements?: { key: string; points: { date: string; v: number }[] }[];
  exercises: { name: string; group: string; points: { date: string; e1rm: number }[] }[];
  macros: {
    targets?: NutritionTargets;
    restTargets?: NutritionTargets;
    days: { date: string; kcal: number; p: number; f: number; c: number; training: boolean }[];
  };
  // XP/level derived from all-time counts (same math as /progress — domain/gamification).
  // totalWorkouts powers the "X/threshold" progress hint on locked workout-count badges.
  gamification?: { level: number; xp: number; intoLevel: number; needed: number; streak?: number; totalWorkouts?: number };
  // Earned badges — client celebrates ones it hasn't shown before (localStorage diff).
  badges?: { code: string; label: string }[];
  // Full badge catalog (all codes + labels) — powers the achievements showcase (earned vs locked).
  // `progress` (locked badges only, where we track a cheap running total) drives the "7/10" hint.
  badgeCatalog?: { code: string; label: string; progress?: { current: number; needed: number } }[];
  // Today's water/steps vs goals — powers the activity rings (workouts ring derives from calendar).
  todayStats?: { waterMl: number; waterGoal: number; steps: number; stepsGoal: number };
  // Accountability buddy — name + their completed workouts this week (mutual motivation card).
  buddy?: { name: string; workouts: number };
  // Today's plan exercises for the quick-log form (empty on rest days / no plan).
  logForm?: { exercises: string[] };
  // Trainer-only portfolio view: one row per client with 7-day compliance + at-risk flag.
  trainer?: {
    clients: { id: number; name: string; workoutPct: number; nutritionPct: number; atRisk: boolean; flagged: boolean; missedDates?: [string, string] }[];
  };
  // Owner-only analytics: DAU trend, funnel, AI provider stats, plan-source offload.
  owner?: {
    dau: { date: string; n: number }[];
    funnel: { total: number; onboarded: number; active7: number; active30: number };
    ai: { provider: string; calls: number; fallbacks: number; avgLatencyMs: number; tokens: number }[];
    planSources: { source: string; n: number }[];
  };
}

/** YYYY-MM-DD that is `n` days before `date` (UTC arithmetic on date-only strings). */
export function isoDaysBefore(date: string, n: number): string {
  const t = Date.parse(`${date}T00:00:00Z`) - n * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/** ISO weekday (1=Mon..7=Sun) of a YYYY-MM-DD string. */
export function isoWeekdayOf(date: string): Weekday {
  const d = new Date(`${date}T00:00:00Z`).getUTCDay(); // 0=Sun..6=Sat
  return (d === 0 ? 7 : d) as Weekday;
}

/** Pure payload assembly from pre-fetched rows — exported for unit tests. */
export function assemblePayload(
  user: UserDoc,
  today: string,
  rows: {
    bodyLogs: BodyLogDoc[];
    workouts: WorkoutLogDoc[];
    records: StrengthRecordDoc[];
    nutrition: NutritionLogDoc[];
    plan: PlanDoc | null;
    checkin: DailyCheckinDoc | null;
  },
): DashboardPayload {
  const { bodyLogs, workouts, records, nutrition, plan, checkin } = rows;

  // Weight trend + goal projection.
  const points = bodyLogs
    .filter((b) => typeof b.weight === "number" && (b.weight as number) > 0)
    .map((b) => ({ date: b.date, kg: b.weight as number }));
  const goal = user.profile.goalWeight;
  const proj = goal
    ? projectWeight(points.map((p) => ({ date: p.date, weight: p.kg })), goal)
    : null;

  // Measurement trends (same body_logs rows as the weight chart).
  const MEAS_KEYS = ["waist", "chest", "hips", "arm", "thigh"] as const;
  const measurements = MEAS_KEYS.map((k) => ({
    key: k as string,
    points: bodyLogs
      .filter((b) => typeof b.measurements?.[k] === "number" && (b.measurements[k] as number) > 0)
      .map((b) => ({ date: b.date, v: b.measurements![k] as number })),
  })).filter((m) => m.points.length >= 2);

  // 12-week calendar: done / missed (planned weekday in the past, no completed log) / rest.
  const planned = new Set<Weekday>(
    user.profile.trainingWeekdays ?? plan?.split.map((d) => d.weekday) ?? [],
  );
  const doneDates = new Set(workouts.filter((w) => w.completed).map((w) => w.date));
  const days: DashboardPayload["calendar"]["days"] = [];
  for (let i = CALENDAR_DAYS - 1; i >= 0; i--) {
    const date = isoDaysBefore(today, i);
    const s = doneDates.has(date)
      ? "done"
      : date < today && planned.has(isoWeekdayOf(date))
        ? "missed"
        : "rest";
    days.push({ date, s });
  }

  // Weekly volume vs MEV/MAV (last 7 days of completed sets).
  const volume = weeklyVolume(workouts, isoDaysBefore(today, 6)).map((v) => ({ ...v }));
  const cw = conditioningWeek(workouts, isoDaysBefore(today, 6));

  // Recovery score: combines the check-in with what's already been computed above (conditioning
  // zone, volume-vs-MAV) plus recent RPE -- see domain/recovery.ts for the weighting and why
  // missing data is never itself a penalty.
  const recentCompleted = [...workouts].filter((w) => w.completed).sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 5);
  const rpes = recentCompleted.flatMap((w) => w.exercises.map((e) => e.rpe).filter((r): r is number => typeof r === "number"));
  const avgRpe = rpes.length ? rpes.reduce((a, b) => a + b, 0) / rpes.length : null;
  const groupsAboveMav = volume.filter((v) => v.zone === "above").length;
  const recovery = recoveryScore({
    checkin: checkin ? { energy: checkin.energy, sleep: checkin.sleep, stress: checkin.stress } : null,
    conditioningZone: cw.zone,
    avgRpe,
    groupsAboveMav,
  });
  const conditioning = { ...cw, targetMin: CONDITIONING_LANDMARK.targetMin, highMin: CONDITIONING_LANDMARK.highMin };

  // Per-exercise e1RM history (weighted lifts only, ≥2 usable points), classified into a
  // muscle group so the client can chart a whole group at once instead of one lift at a time.
  // Capped PER GROUP (top-3 by best weight), not globally — a flat top-12 by weight was all
  // legs/back/chest and silently dropped every lighter group (shoulders/arms) from the picker.
  const classified = records
    .filter((r) => r.metric === "reps" && r.bestWeight > 0)
    .map((r) => ({
      name: r.exercise,
      group: muscleGroupOf(r.exercise) ?? "other",
      points: r.history
        .filter((h) => h.weight > 0 && h.reps > 0)
        .map((h) => ({ date: h.date, e1rm: Math.round(e1rm(h.weight, h.reps) * 10) / 10 })),
    }))
    .filter((r) => r.points.length >= 2);
  const perGroup = new Map<string, number>();
  const exercises = classified.filter((r) => {
    const n = perGroup.get(r.group) ?? 0;
    if (n >= 3) return false;
    perGroup.set(r.group, n + 1);
    return true;
  });

  // Last 7 days of macro sums, tagged training/rest for target selection client-side.
  const byDate = new Map(nutrition.map((n) => [n.date, n.meals]));
  const macroDays: DashboardPayload["macros"]["days"] = [];
  for (let i = MACRO_DAYS - 1; i >= 0; i--) {
    const date = isoDaysBefore(today, i);
    const meals = byDate.get(date) ?? [];
    const sum = meals.reduce(
      (a, m) => ({ kcal: a.kcal + m.kcal, p: a.p + m.protein, f: a.f + m.fats, c: a.c + m.carbs }),
      { kcal: 0, p: 0, f: 0, c: 0 },
    );
    macroDays.push({
      date,
      kcal: Math.round(sum.kcal),
      p: Math.round(sum.p),
      f: Math.round(sum.f),
      c: Math.round(sum.c),
      training: planned.has(isoWeekdayOf(date)),
    });
  }

  return {
    lang: user.lang,
    today,
    ...(user.profile.name ? { name: user.profile.name } : {}),
    weight: {
      points,
      ...(goal ? { goal } : {}),
      ...(proj
        ? {
            projection: {
              slopePerWeek: proj.slopePerWeek,
              ...(proj.etaWeeks ? { etaWeeks: proj.etaWeeks } : {}),
              onTrack: proj.onTrack,
              reached: proj.reached,
            },
          }
        : {}),
    },
    calendar: {
      days,
      plannedWeekdays: [...planned],
      split: (plan?.split ?? []).map((d) => ({ weekday: d.weekday, group: d.muscleGroup, n: d.exercises.length })),
      logs: workouts
        .filter((w) => w.exercises.some((e) => !e.skipped))
        .map((w) => ({
          date: w.date,
          done: w.completed,
          ex: w.exercises
            .filter((e) => !e.skipped)
            .slice(0, 10)
            .map((e) => ({ n: e.name, s: e.setsDone.length })),
        })),
    },
    volume,
    conditioning,
    recovery,
    ...(measurements.length ? { measurements } : {}),
    exercises,
    macros: {
      ...(user.nutrition ? { targets: user.nutrition } : {}),
      ...(plan?.restDayNutrition ? { restTargets: plan.restDayNutrition } : {}),
      days: macroDays,
    },
  };
}

