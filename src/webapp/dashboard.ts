// Dashboard payload for the Mini App: one JSON with everything the five charts need.
// Assembly is pure (assemblePayload, unit-tested); buildDashboardPayload only fetches rows.
import { projectWeight, weeklyVolume } from "../domain/analysis";
import { localParts, muscleGroupOf } from "../domain/progression";
import { BADGES, e1rm, weekStartStr, weekStreak } from "../domain/records";
import { complianceScore, getPlanDay } from "../domain/progression";
import { missedConsecutiveWorkouts } from "../domain/atrisk";
import { computeXp, levelFromXp } from "../domain/gamification";
import {
  aiCallStatsSince,
  allNutritionDatesSince,
  allWorkoutLogsSince,
  bodyLogsByUser,
  countActiveSince,
  countOnboarded,
  countPlanSourcesSince,
  countUsers,
  awardAchievement,
  dailyActiveUsers,
  dashboardExtrasBatch,
  getActivePlan,
  getOwnerChatId,
  getUser,
  listActivePlans,
  listClients,
  listStrength,
  nutritionLogsSince,
  sessionsBetween,
  upcomingSessionsFor,
  workoutLogsSince,
} from "../db/repos";
import { sessionTimeFor } from "../domain/sessionTz";
import { t } from "../locales/i18n";
import { resolveStepsGoal, resolveWaterGoal } from "../domain/challenges";
import type {
  BodyLogDoc,
  Lang,
  NutritionLogDoc,
  NutritionTargets,
  PlanDoc,
  SessionDoc,
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
    sessions: { date: string; hour: number; status: string; with?: string }[]; // trainer sessions (clients)
    logs: { date: string; done: boolean; ex: { n: string; s: number }[] }[]; // what was actually done that day
  };
  volume: { group: string; sets: number; mev: number; mav: number; zone: string }[];
  // Body measurements (cm) with >=2 points — waist/chest/hips/arm/thigh trend lines.
  measurements?: { key: string; points: { date: string; v: number }[] }[];
  exercises: { name: string; group: string; points: { date: string; e1rm: number }[] }[];
  macros: {
    targets?: NutritionTargets;
    restTargets?: NutritionTargets;
    days: { date: string; kcal: number; p: number; f: number; c: number; training: boolean }[];
  };
  // XP/level derived from all-time counts (same math as /progress — domain/gamification).
  gamification?: { level: number; xp: number; intoLevel: number; needed: number; streak?: number };
  // Earned badges — client celebrates ones it hasn't shown before (localStorage diff).
  badges?: { code: string; label: string }[];
  // Full badge catalog (all codes + labels) — powers the achievements showcase (earned vs locked).
  badgeCatalog?: { code: string; label: string }[];
  // Today's water/steps vs goals — powers the activity rings (workouts ring derives from calendar).
  todayStats?: { waterMl: number; waterGoal: number; steps: number; stepsGoal: number };
  // Accountability buddy — name + their completed workouts this week (mutual motivation card).
  buddy?: { name: string; workouts: number };
  // Today's plan exercises for the quick-log form (empty on rest days / no plan).
  logForm?: { exercises: string[] };
  // Trainer-only portfolio view: one row per client with 7-day compliance + at-risk flag.
  trainer?: {
    clients: { id: number; name: string; workoutPct: number; nutritionPct: number; atRisk: boolean; flagged: boolean }[];
    sessions: { date: string; hour: number; status: string; with?: string }[];
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
    sessions?: SessionDoc[];
    sessionWith?: string; // the other party's display name (client → trainer name)
  },
): DashboardPayload {
  const { bodyLogs, workouts, records, nutrition, plan } = rows;

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
      sessions: (rows.sessions ?? [])
        .filter((s) => s.status === "confirmed" || s.status === "proposed")
        .map((s) => ({
          date: s.date,
          hour: s.hour,
          status: s.status,
          ...(rows.sessionWith ? { with: rows.sessionWith } : {}),
        })),
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
    ...(measurements.length ? { measurements } : {}),
    exercises,
    macros: {
      ...(user.nutrition ? { targets: user.nutrition } : {}),
      ...(plan?.restDayNutrition ? { restTargets: plan.restDayNutrition } : {}),
      days: macroDays,
    },
  };
}

// Free-tier subrequest cap: the section must stay O(1) in queries, not O(clients).
const TRAINER_SECTION_MAX_CLIENTS = 30;

/** Trainer portfolio: per-client 7-day compliance + at-risk (2 consecutive planned misses).
 * Three bulk queries + the sessions list — NOT per-client fan-out (subrequest cap). */
async function buildTrainerSection(
  db: D1Database,
  trainerId: number,
  today: string,
  trainerTz: string | undefined,
): Promise<NonNullable<DashboardPayload["trainer"]>> {
  const clients = (await listClients(db, trainerId).catch(() => [] as UserDoc[])).slice(0, TRAINER_SECTION_MAX_CLIENTS);
  if (!clients.length) return { clients: [], sessions: [] };
  const ids = new Set(clients.map((c) => c._id));
  const cutoff = isoDaysBefore(today, 6);
  const [allLogs, allPlans, allNutrition, upcoming] = await Promise.all([
    allWorkoutLogsSince(db, isoDaysBefore(today, 20)).catch(() => []),
    listActivePlans(db).catch(() => []),
    allNutritionDatesSince(db, cutoff).catch(() => []),
    upcomingSessionsFor(db, trainerId, "trainer", today, 10).catch(() => []),
  ]);
  const logsByUser = new Map<number, WorkoutLogDoc[]>();
  for (const l of allLogs) {
    if (!ids.has(l.userId)) continue;
    const arr = logsByUser.get(l.userId) ?? [];
    arr.push(l);
    logsByUser.set(l.userId, arr);
  }
  const planByUser = new Map(allPlans.filter((p) => ids.has(p.userId)).map((p) => [p.userId, p]));
  const nutritionDays = new Map<number, number>();
  for (const n of allNutrition) {
    if (ids.has(n.userId)) nutritionDays.set(n.userId, (nutritionDays.get(n.userId) ?? 0) + 1);
  }
  const rows = clients.map((c) => {
    const wl = logsByUser.get(c._id) ?? [];
    const plan = planByUser.get(c._id);
    // Schedule denominator falls back to the PLAN's weekdays — many trainer-managed clients
    // never set profile.trainingWeekdays and would read as a fake 0% compliance.
    const scheduled = c.profile.trainingWeekdays?.length
      ? c.profile.trainingWeekdays.length
      : (plan?.split.length ?? 0);
    const comp = complianceScore({
      completedWorkouts: wl.filter((l) => l.completed && l.date >= cutoff).length,
      scheduledWorkouts: scheduled,
      nutritionDays: nutritionDays.get(c._id) ?? 0,
      windowDays: 7,
    });
    let atRisk = false;
    if (plan?.split.length) {
      const genD = plan.generatedAt.toISOString().slice(0, 10);
      const joinD = c.createdAt.toISOString().slice(0, 10);
      atRisk = !!missedConsecutiveWorkouts(
        plan.split.map((d) => d.weekday),
        wl.filter((l) => l.completed).map((l) => l.date),
        today,
        genD > joinD ? genD : joinD,
      );
    }
    return { id: c._id, name: c.profile.name ?? `id ${c._id}`, workoutPct: comp.workoutPct, nutritionPct: comp.nutritionPct, atRisk, flagged: !!c.flagged };
  });
  const names = new Map(clients.map((c) => [c._id, c.profile.name]));
  const sessions = upcoming.map((s) => {
    // Stored wall time lives in the booker's zone — show the TRAINER their local time.
    const local = sessionTimeFor(s.date, s.hour, s.tz, trainerTz);
    const withName = names.get(s.clientId);
    return { date: local.date, hour: local.hour, status: s.status, ...(withName ? { with: withName } : {}) };
  });
  return { clients: rows, sessions };
}

/** Owner analytics: 28-day DAU, funnel, 7-day AI provider stats, 30-day plan-source offload. */
async function buildOwnerSection(db: D1Database, today: string): Promise<NonNullable<DashboardPayload["owner"]>> {
  const [dau, total, onboarded, active7, active30, ai, sources] = await Promise.all([
    dailyActiveUsers(db, isoDaysBefore(today, 27)).catch(() => []),
    countUsers(db).catch(() => 0),
    countOnboarded(db).catch(() => 0),
    countActiveSince(db, new Date(Date.now() - 7 * 86_400_000).toISOString()).catch(() => 0),
    countActiveSince(db, new Date(Date.now() - 30 * 86_400_000).toISOString()).catch(() => 0),
    aiCallStatsSince(db, new Date(Date.now() - 7 * 86_400_000).toISOString()).catch(() => []),
    countPlanSourcesSince(db, new Date(Date.now() - 30 * 86_400_000).toISOString()).catch(() => []),
  ]);
  const bySource = new Map<string, number>();
  for (const s of sources) bySource.set(s.source, (bySource.get(s.source) ?? 0) + s.c);
  return {
    dau,
    funnel: { total, onboarded, active7, active30 },
    ai,
    planSources: [...bySource.entries()].map(([source, n]) => ({ source, n })),
  };
}

export async function buildDashboardPayload(db: D1Database, user: UserDoc): Promise<DashboardPayload> {
  const today = localParts(user.profile.timezone).date;
  const isClient = user.role === "client" && !!user.trainerId;
  const [bodyLogs, workouts, records, nutrition, plan, sessions, trainer, trainerSection, ownerChatId, extras] = await Promise.all([
    bodyLogsByUser(db, user._id).catch(() => []),
    workoutLogsSince(db, user._id, isoDaysBefore(today, CALENDAR_DAYS - 1)),
    listStrength(db, user._id, 40),
    nutritionLogsSince(db, user._id, isoDaysBefore(today, MACRO_DAYS - 1)),
    getActivePlan(db, user._id),
    isClient
      ? sessionsBetween(db, user._id, "client", isoDaysBefore(today, 30), isoDaysBefore(today, -60)).catch(() => [])
      : Promise.resolve([]),
    isClient ? getUser(db, user.trainerId as number).catch(() => null) : Promise.resolve(null),
    user.role === "trainer"
      ? buildTrainerSection(db, user._id, today, user.profile.timezone).catch(() => undefined)
      : Promise.resolve(undefined),
    getOwnerChatId(db).catch(() => undefined),
    dashboardExtrasBatch(db, user._id, today).catch(() => null),
  ]);
  // Owner analytics only for the single owner — resolved after the parallel batch so every
  // other user's dashboard doesn't pay a serial "am I the owner" round-trip.
  const ownerSection =
    ownerChatId !== undefined && ownerChatId === user.chatId
      ? await buildOwnerSection(db, today).catch(() => undefined)
      : undefined;
  // Session wall times are stored in the booker's zone — convert to the viewer's before render.
  const localSessions = sessions.map((s) => ({ ...s, ...sessionTimeFor(s.date, s.hour, s.tz, user.profile.timezone) }));
  const payload = assemblePayload(user, today, {
    bodyLogs,
    workouts,
    records,
    nutrition,
    plan,
    sessions: localSessions,
    ...(trainer?.profile.name ? { sessionWith: trainer.profile.name } : {}),
  });
  if (trainerSection) payload.trainer = trainerSection;
  if (ownerSection) payload.owner = ownerSection;
  if (extras) {
    payload.gamification = {
      ...levelFromXp(computeXp(extras.statCounts)),
      // Week streak (vacation-frozen) — the same number the bot's /progress and week card show.
      streak: weekStreak(workouts.filter((w) => w.completed).map((w) => w.date), today, user.reminders?.lastVacation),
    };
    // Earned badges (code+label) — the client diffs against its last-seen set and celebrates
    // newly earned ones with a haptic + overlay animation.
    payload.badges = extras.achievements.map((code) => ({ code, label: t(user.lang, `badge_${code}` as Parameters<typeof t>[1]) }));
    payload.badgeCatalog = BADGES.map((code) => ({ code, label: t(user.lang, `badge_${code}` as Parameters<typeof t>[1]) }));
    payload.todayStats = {
      waterMl: extras.waterMl,
      waterGoal: resolveWaterGoal(user.profile),
      steps: extras.steps,
      stepsGoal: resolveStepsGoal(user.profile),
    };
    if (user.profile.buddyId) {
      const mate = await getUser(db, user.profile.buddyId).catch(() => null);
      if (mate) {
        const mLogs = await workoutLogsSince(db, mate._id, weekStartStr(today)).catch(() => []);
        payload.buddy = { name: mate.profile.name ?? "Buddy", workouts: mLogs.filter((l) => l.completed).length };
      }
    }
    // Perfect-day badge (one-time): all three daily quests met today — workout + water goal + protein target.
    try {
      const proteinTarget = user.nutrition?.protein ?? 0;
      const proteinToday = (nutrition.find((n) => n.date === today)?.meals ?? []).reduce((s, m) => s + (m.protein || 0), 0);
      const workoutToday = workouts.some((w) => w.date === today && w.completed);
      const waterMet = extras.waterMl >= resolveWaterGoal(user.profile);
      if (workoutToday && waterMet && proteinTarget > 0 && proteinToday >= proteinTarget) {
        await awardAchievement(db, user._id, "perfect_day").catch(() => {});
      }
    } catch {
      /* best-effort */
    }
  }
  const todayDay = plan ? getPlanDay(plan, isoWeekdayOf(today)) : undefined;
  payload.logForm = { exercises: (todayDay?.exercises ?? []).map((e) => e.name) };
  return payload;
}
