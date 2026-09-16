// Real v2-native implementation of `DashboardReader` (src/application/dashboard.ts) — Domain 10
// of the v2 cutover, see docs/adr/0001-v2-seams-and-staged-cutover.md. This is the "deep module"
// the ADR calls out by name: it owns ALL the D1 fetching + fan-out for the Mini App dashboard
// (formerly `buildDashboardPayload`/`buildTrainerSection`/`buildOwnerSection`, which used to be
// inlined in src/webapp/dashboard.ts), then hands the raw rows to that file's PURE
// `assemblePayload` for shaping. src/webapp/dashboard.ts now has no D1 access at all — see its
// own header comment.
//
// Every read below is a call into an already-completed domain's own v2-native repo module
// (v2Workouts/v2Plans/v2Nutrition/v2Tracking/v2Trainer/v2Gamification/v2Users) — this file adds
// no new raw SQL of its own against any of those domains' tables. The one exception is the four
// owner-report reads (aiCallStatsSince/countPlanSourcesSince/dailyActiveUsers/getOwnerChatId) and
// dashboardExtrasBatch (all-time stat counts + today's water/steps + earned badges in one
// db.batch round trip): those come from `./v2Admin` because they are Domain 9 (owner/admin
// reporting)'s scope, not this domain's — Domain 9 landed concurrently with this session and
// already ported them v2-natively (v2_config/v2_analytics_events/v2_ai_calls/
// v2_plan_source_logs/the cross-domain batch in v2Admin.ts's own dashboardExtrasBatch). Nothing
// here reads a legacy table.
import { localParts, complianceScore, getPlanDay } from "../../domain/progression";
import { missedConsecutiveWorkouts } from "../../domain/atrisk";
import { computeXp, levelFromXp } from "../../domain/gamification";
import { BADGES, badgeProgress, weekStartStr, weekStreak } from "../../domain/records";
import { resolveStepsGoal, resolveWaterGoal } from "../../domain/challenges";
import { t } from "../../locales/i18n";
import {
  aiCallStatsSince,
  countPlanSourcesSince,
  dailyActiveUsers,
  dashboardExtrasBatch,
  getOwnerChatId,
} from "./v2Admin";
import { allWorkoutLogsSince, listStrength, workoutLogsSince } from "./v2Workouts";
import { awardAchievement } from "./v2Gamification";
import { getActivePlan, listActivePlans } from "./v2Plans";
import { listClients } from "./v2Trainer";
import { bodyLogsByUser, getDailyCheckin } from "./v2Tracking";
import { countActiveSince, countOnboarded, countUsers, getUser } from "./v2Users";
import { allNutritionDatesSince, nutritionLogsSince } from "./v2Nutrition";
import {
  assemblePayload,
  CALENDAR_DAYS,
  isoDaysBefore,
  isoWeekdayOf,
  MACRO_DAYS,
  type DashboardPayload,
} from "../../webapp/dashboard";
import { createDashboardApplication, type DashboardReader } from "../../application/dashboard";
import type { UserDoc, WorkoutLogDoc } from "../../types";

// Free-tier subrequest cap: the section must stay O(1) in queries, not O(clients).
const TRAINER_SECTION_MAX_CLIENTS = 30;

/** Trainer portfolio: per-client 7-day compliance + at-risk (2 consecutive planned misses).
 * Three bulk queries — NOT per-client fan-out (subrequest cap). */
async function buildTrainerSection(
  db: D1Database,
  trainerId: number,
  today: string,
): Promise<NonNullable<DashboardPayload["trainer"]>> {
  // Flagged-first BEFORE the cap so a flagged client past position 30 still survives the
  // O(1) truncation below. atRisk needs the bulk queries below, so it can only reorder AFTER
  // they run (see the final sort on `rows`) — this pre-slice pass only uses the free `flagged`
  // column already loaded on every UserDoc row.
  const allClients = (await listClients(db, trainerId).catch(() => [] as UserDoc[]))
    .sort((a, b) => Number(b.flagged) - Number(a.flagged));
  const clients = allClients.slice(0, TRAINER_SECTION_MAX_CLIENTS);
  if (!clients.length) return { clients: [] };
  const ids = new Set(clients.map((c) => c._id));
  const cutoff = isoDaysBefore(today, 6);
  const [allLogs, allPlans, allNutrition] = await Promise.all([
    allWorkoutLogsSince(db, isoDaysBefore(today, 20)).catch(() => []),
    listActivePlans(db).catch(() => []),
    allNutritionDatesSince(db, cutoff).catch(() => []),
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
  // Attention first in the actual displayed order: flagged, then at-risk, then everyone else.
  rows.sort((a, b) => Number(b.flagged) - Number(a.flagged) || Number(b.atRisk) - Number(a.atRisk));
  return { clients: rows };
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
  const [bodyLogs, workouts, records, nutrition, plan, trainerSection, ownerChatId, extras, checkin] = await Promise.all([
    bodyLogsByUser(db, user._id).catch(() => []),
    workoutLogsSince(db, user._id, isoDaysBefore(today, CALENDAR_DAYS - 1)),
    listStrength(db, user._id, 40),
    nutritionLogsSince(db, user._id, isoDaysBefore(today, MACRO_DAYS - 1)),
    getActivePlan(db, user._id),
    user.role === "trainer"
      ? buildTrainerSection(db, user._id, today).catch(() => undefined)
      : Promise.resolve(undefined),
    getOwnerChatId(db).catch(() => undefined),
    dashboardExtrasBatch(db, user._id, today).catch(() => null),
    getDailyCheckin(db, user._id, today).catch(() => null),
  ]);
  // Owner analytics only for the single owner — resolved after the parallel batch so every
  // other user's dashboard doesn't pay a serial "am I the owner" round-trip.
  const ownerSection =
    ownerChatId !== undefined && ownerChatId === user.chatId
      ? await buildOwnerSection(db, today).catch(() => undefined)
      : undefined;
  const payload = assemblePayload(user, today, {
    bodyLogs,
    workouts,
    records,
    nutrition,
    plan,
    checkin,
  });
  if (trainerSection) payload.trainer = trainerSection;
  if (ownerSection) payload.owner = ownerSection;
  if (extras) {
    payload.gamification = {
      ...levelFromXp(computeXp(extras.statCounts)),
      // Week streak (vacation-frozen) — the same number the bot's /progress and week card show.
      streak: weekStreak(workouts.filter((w) => w.completed).map((w) => w.date), today, user.reminders?.lastVacation),
      totalWorkouts: extras.statCounts.workouts,
    };
    // Earned badges (code+label) — the client diffs against its last-seen set and celebrates
    // newly earned ones with a haptic + overlay animation.
    payload.badges = extras.achievements.map((code) => ({ code, label: t(user.lang, `badge_${code}` as Parameters<typeof t>[1]) }));
    const earnedSet = new Set(extras.achievements);
    const progressCounts = { workouts: extras.statCounts.workouts, streak: payload.gamification.streak, level: payload.gamification.level };
    payload.badgeCatalog = BADGES.map((code) => {
      const progress = earnedSet.has(code) ? undefined : (badgeProgress(code, progressCounts) ?? undefined);
      return { code, label: t(user.lang, `badge_${code}` as Parameters<typeof t>[1]), ...(progress ? { progress } : {}) };
    });
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

export function createD1DashboardApplication(db: D1Database) {
  const reader: DashboardReader = {
    read: (user: UserDoc) => buildDashboardPayload(db, user),
  };
  return createDashboardApplication(reader);
}
