// Engagement analytics: event counters (v2_analytics_events), last-seen, plan sources,
// cohorts and daily actives, and the cross-domain activity window used by reports.
import type { BodyLogDoc, DailyCheckinDoc, NutritionLogDoc, StepLogDoc, StrengthRecordDoc, UserProfile, WorkoutLogDoc } from "../../types";
import { nowIso, safeJsonParse, type DB } from "./shared";
import { bodyLogsByUser, dailyCheckinsSince, stepLogsSince, waterLogsSince } from "./v2Tracking";
import { nutritionLogsSince } from "./v2Nutrition";
import { listStrength, workoutLogsSince } from "./v2Workouts";

export async function listUsersBrief(
  db: DB,
  limit?: number,
): Promise<{ id: number; name: string; username?: string; onboarded: boolean; updatedAt: string; lastSeenAt?: string; trainerId?: number; blocked: boolean; botBlocked: boolean; profile: UserProfile }[]> {
  // No limit → every user (owner report lists all). With a limit → most-recently-active first.
  const sql =
    `SELECT a.id AS id, o.status AS onboardingStatus, p.profile AS profile, a.updatedAt AS updatedAt,
            a.lastSeenAt AS lastSeenAt, a.username AS username, a.blocked AS blocked, a.botBlocked AS botBlocked,
            (SELECT trainerId FROM v2_trainer_relationships WHERE clientId = a.id AND status = 'active' LIMIT 1) AS trainerId
     FROM v2_accounts a
     LEFT JOIN v2_profiles p ON p.accountId = a.id
     LEFT JOIN v2_onboarding o ON o.accountId = a.id
     ORDER BY a.updatedAt DESC` + (limit ? " LIMIT ?" : "");
  const stmt = limit ? db.prepare(sql).bind(limit) : db.prepare(sql);
  const r = await stmt.all<{
    id: number; onboardingStatus: string | null; profile: string | null; updatedAt: string;
    lastSeenAt: string | null; trainerId: number | null; username: string | null; blocked: number | null; botBlocked: number | null;
  }>();
  return (r.results ?? []).map((x) => {
    const profile = safeJsonParse<UserProfile>(x.profile, {});
    return {
      id: x.id,
      name: profile.name || "",
      username: x.username ?? undefined,
      onboarded: x.onboardingStatus === "completed",
      updatedAt: x.updatedAt,
      lastSeenAt: x.lastSeenAt ?? undefined,
      trainerId: x.trainerId ?? undefined,
      blocked: !!x.blocked,
      botBlocked: !!x.botBlocked,
      profile,
    };
  });
}

/** All-time logged-event counts per user (workouts, check-ins, nutrition logs, step logs).
 * Four GROUP BY queries total — independent of user count — for the owner report. */
export async function eventCountsByUser(
  db: DB,
): Promise<Map<number, { workouts: number; checkins: number; nutrition: number; steps: number }>> {
  const q = (sql: string) => db.prepare(sql).all<{ userId: number; c: number }>();
  const [w, c, n, s] = await Promise.all([
    // Completed only — a skip writes a v2_workout_sessions row with completed=0 and must NOT count as a workout.
    q("SELECT accountId AS userId, COUNT(*) AS c FROM v2_workout_sessions WHERE completed = 1 GROUP BY accountId"),
    q("SELECT accountId AS userId, COUNT(*) AS c FROM v2_wellbeing GROUP BY accountId"),
    q("SELECT accountId AS userId, COUNT(*) AS c FROM v2_nutrition_days GROUP BY accountId"),
    q("SELECT accountId AS userId, COUNT(*) AS c FROM v2_step_logs GROUP BY accountId"),
  ]);
  const map = new Map<number, { workouts: number; checkins: number; nutrition: number; steps: number }>();
  const get = (id: number) => {
    let e = map.get(id);
    if (!e) { e = { workouts: 0, checkins: 0, nutrition: 0, steps: 0 }; map.set(id, e); }
    return e;
  };
  for (const r of w.results ?? []) get(r.userId).workouts = r.c;
  for (const r of c.results ?? []) get(r.userId).checkins = r.c;
  for (const r of n.results ?? []) get(r.userId).nutrition = r.c;
  for (const r of s.results ?? []) get(r.userId).steps = r.c;
  return map;
}

/** Engagement counts since a cutoff date (YYYY-MM-DD) for the owner report's product-pulse KPIs. */
export async function engagementSince(db: DB, cutoffDate: string): Promise<{ workouts: number; completed: number; checkins: number; nutrition: number }> {
  const one = async (sql: string) => (await db.prepare(sql).bind(cutoffDate).first<{ c: number }>())?.c ?? 0;
  const [workouts, completed, checkins, nutrition] = await Promise.all([
    one("SELECT COUNT(*) AS c FROM v2_workout_sessions WHERE date >= ?"),
    one("SELECT COUNT(*) AS c FROM v2_workout_sessions WHERE date >= ? AND completed = 1"),
    one("SELECT COUNT(*) AS c FROM v2_wellbeing WHERE date >= ?"),
    one("SELECT COUNT(*) AS c FROM v2_nutrition_days WHERE date >= ?"),
  ]);
  return { workouts, completed, checkins, nutrition };
}

/** Total weekly-progression rows since `cutoff` (ISO) — how many silent micro-adjustments fired. */
export async function countAdjustmentsSince(db: DB, cutoff: string): Promise<number> {
  const r = await db.prepare("SELECT COUNT(*) AS c FROM v2_plan_adjustments WHERE createdAt >= ?").bind(cutoff).first<{ c: number }>();
  return r?.c ?? 0;
}

/** Telemetry: record how a plan/meal was served, or a progression transition. `kind` is
 * 'workout' | 'meal' | 'level_up' | 'goal_switch' | 'plateau_swap'. Best-effort. */
export async function recordPlanSource(db: DB, userId: number, kind: string, source: "bank" | "template" | "ai"): Promise<void> {
  await db
    .prepare("INSERT INTO v2_plan_source_logs (accountId, kind, source, createdAt) VALUES (?, ?, ?, ?)")
    .bind(userId, kind, source, nowIso())
    .run();
}

/** Counts of plan sources since `cutoff` (ISO), for the owner report / Gemini-offload check. */
export async function countPlanSourcesSince(db: DB, cutoff: string): Promise<{ kind: string; source: string; c: number }[]> {
  try {
    const r = await db
      .prepare("SELECT kind, source, COUNT(*) AS c FROM v2_plan_source_logs WHERE createdAt >= ? GROUP BY kind, source")
      .bind(cutoff)
      .all<{ kind: string; source: string; c: number }>();
    return r.results ?? [];
  } catch {
    return [];
  }
}

// ---------- ai usage ----------

/** All of a user's logged activity since `cutoff`, fetched in ONE parallel round-trip. Report
 * (`cmdReport`) and export (`buildExportMd`) built the identical 6-7 read fan-out separately —
 * this collapses that duplication so a new logged metric is added in exactly one place. */
export interface ActivitySnapshot {
  workouts: WorkoutLogDoc[];
  nutrition: NutritionLogDoc[];
  strength: StrengthRecordDoc[];
  body: BodyLogDoc[];
  steps: StepLogDoc[];
  water: { date: string; ml: number }[];
  checkins: DailyCheckinDoc[];
}

export async function loadActivityWindow(
  db: DB,
  userId: number,
  cutoff: string,
  opts: { strengthLimit?: number } = {},
): Promise<ActivitySnapshot> {
  const [workouts, nutrition, strength, body, steps, water, checkins] = await Promise.all([
    workoutLogsSince(db, userId, cutoff),
    nutritionLogsSince(db, userId, cutoff),
    listStrength(db, userId, opts.strengthLimit),
    bodyLogsByUser(db, userId),
    stepLogsSince(db, userId, cutoff),
    waterLogsSince(db, userId, cutoff),
    dailyCheckinsSince(db, userId, cutoff),
  ]);
  return { workouts, nutrition, strength, body, steps, water, checkins };
}

// ---------- combined recent context (for the data-grounded coach) ----------

export async function getRecentContext(
  db: DB,
  userId: number,
  days = 7,
): Promise<{ workouts: WorkoutLogDoc[]; nutrition: NutritionLogDoc[] }> {
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  const [workouts, nutrition] = await Promise.all([
    workoutLogsSince(db, userId, cutoff),
    nutritionLogsSince(db, userId, cutoff),
  ]);
  return { workouts, nutrition };
}

// ---------- config / owner ----------

export async function setLastSeen(db: DB, userId: number, iso: string): Promise<void> {
  await db.prepare("UPDATE v2_accounts SET lastSeenAt = ? WHERE id = ?").bind(iso, userId).run();
}

export async function bumpEvent(db: DB, userId: number, event: string, day: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO v2_analytics_events (accountId, event, date, count) VALUES (?, ?, ?, 1)
       ON CONFLICT(accountId, event, date) DO UPDATE SET count = count + 1`,
    )
    .bind(userId, event, day)
    .run();
}

export async function eventStatsSince(db: DB, sinceDay: string, limit = 20): Promise<{ event: string; n: number }[]> {
  const r = await db
    .prepare("SELECT event, SUM(count) AS n FROM v2_analytics_events WHERE date >= ? GROUP BY event ORDER BY n DESC LIMIT ?")
    .bind(sinceDay, limit)
    .all<{ event: string; n: number }>();
  return r.results ?? [];
}

/** One user's all-time activity counts — feeds the XP/level math (domain/gamification). */
export async function userStatCounts(
  db: DB,
  userId: number,
): Promise<{ workouts: number; nutrition: number; checkins: number; steps: number; badges: number; quests: number }> {
  const r = await db
    .prepare(
      `SELECT
        (SELECT COUNT(*) FROM v2_workout_sessions WHERE accountId = ?1 AND completed = 1) AS workouts,
        (SELECT COUNT(*) FROM v2_nutrition_days WHERE accountId = ?1) AS nutrition,
        (SELECT COUNT(*) FROM v2_wellbeing WHERE accountId = ?1) AS checkins,
        (SELECT COUNT(*) FROM v2_step_logs WHERE accountId = ?1) AS steps,
        (SELECT COUNT(*) FROM v2_achievements WHERE accountId = ?1) AS badges,
        (SELECT COUNT(*) FROM v2_quests WHERE accountId = ?1) AS quests`,
    )
    .bind(userId)
    .first<{ workouts: number; nutrition: number; checkins: number; steps: number; badges: number; quests: number }>();
  return r ?? { workouts: 0, nutrition: 0, checkins: 0, steps: 0, badges: 0, quests: 0 };
}

/** Accounts that signed up since `sinceIso`, each with the week offsets (0 = first 7 days) in
 *  which they completed a workout — the owner's cohort retention (domain/cohorts.ts). One query,
 *  aggregated in SQL so the rows stay one per account. */
export async function cohortMembersSince(db: DB, sinceIso: string): Promise<Array<{ joined: string; trainedWeeks: number[] }>> {
  const r = await db
    .prepare(
      `SELECT substr(a.createdAt, 1, 10) AS joined,
        GROUP_CONCAT(DISTINCT CAST((julianday(w.date) - julianday(substr(a.createdAt, 1, 10))) / 7 AS INTEGER)) AS weeks
      FROM v2_accounts a
      LEFT JOIN v2_workout_sessions w ON w.accountId = a.id AND w.completed = 1 AND w.date >= substr(a.createdAt, 1, 10)
      WHERE a.createdAt >= ?
      GROUP BY a.id`,
    )
    .bind(sinceIso)
    .all<{ joined: string; weeks: string | null }>();
  return (r.results ?? []).map((x) => ({
    joined: x.joined,
    trainedWeeks: x.weeks ? x.weeks.split(",").map(Number).filter((n) => Number.isFinite(n)) : [],
  }));
}

/** Distinct active users per day (from usage counters) — owner dashboard DAU chart. */
export async function dailyActiveUsers(db: DB, sinceDay: string): Promise<{ date: string; n: number }[]> {
  const r = await db
    .prepare("SELECT date, COUNT(DISTINCT accountId) AS n FROM v2_analytics_events WHERE date >= ? GROUP BY date ORDER BY date ASC")
    .bind(sinceDay)
    .all<{ date: string; n: number }>();
  return r.results ?? [];
}

/** One user's recent usage counters, newest first — owner per-user event timeline. */
export async function recentEventsForUser(db: DB, userId: number, limit = 30): Promise<{ event: string; day: string; n: number }[]> {
  const r = await db
    .prepare("SELECT event, date AS day, count AS n FROM v2_analytics_events WHERE accountId = ? ORDER BY date DESC, count DESC LIMIT ?")
    .bind(userId, limit)
    .all<{ event: string; day: string; n: number }>();
  return r.results ?? [];
}
