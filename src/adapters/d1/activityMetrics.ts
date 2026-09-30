// Raw aggregates behind GET /admin/metrics/activity (domain/activityMetrics.ts assembles them).
// Read-only queries in one db.batch round trip; each is bounded by the window's start date,
// and "active" means any of: a workout session, a food log day, a check-in, water, steps, or a
// counted bot/app event on that date.
import type { DB } from "../../db/repos/shared";
import type { ActivityKind, ActivityRaw } from "../../domain/activityMetrics";

// Every per-user, per-date activity source, for DAU/WAU/MAU (UNION dedupes the pairs). D1 caps
// a compound SELECT at a few terms, so the six sources are unioned as two groups of three.
const ACTIVE_PAIRS = `
  SELECT accountId, date FROM (
    SELECT accountId, date FROM v2_workout_sessions WHERE date >= ?1
    UNION SELECT accountId, date FROM v2_nutrition_days WHERE date >= ?1
    UNION SELECT accountId, date FROM v2_wellbeing WHERE date >= ?1)
  UNION SELECT accountId, date FROM (
    SELECT accountId, date FROM v2_water_logs WHERE date >= ?1
    UNION SELECT accountId, date FROM v2_step_logs WHERE date >= ?1
    UNION SELECT accountId, date FROM v2_analytics_events WHERE date >= ?1 AND accountId IS NOT NULL)`;

// One statement per source (no big compound SELECT): [kind, table, extra filter].
const DAILY: Array<[ActivityKind, string, string]> = [
  ["workouts", "v2_workout_sessions", "completed = 1 AND "],
  ["nutrition", "v2_nutrition_days", ""],
  ["checkins", "v2_wellbeing", ""],
  ["water", "v2_water_logs", ""],
  ["steps", "v2_step_logs", ""],
];
const ADOPTION: Array<[string, string]> = [
  ["workouts", "SELECT COUNT(DISTINCT accountId) AS users FROM v2_workout_sessions WHERE completed = 1 AND date >= ?1"],
  ["nutrition", "SELECT COUNT(DISTINCT accountId) AS users FROM v2_nutrition_days WHERE date >= ?1"],
  ["checkins", "SELECT COUNT(DISTINCT accountId) AS users FROM v2_wellbeing WHERE date >= ?1"],
  ["water", "SELECT COUNT(DISTINCT accountId) AS users FROM v2_water_logs WHERE date >= ?1"],
  ["steps", "SELECT COUNT(DISTINCT accountId) AS users FROM v2_step_logs WHERE date >= ?1"],
  ["weekly quests", "SELECT COUNT(DISTINCT accountId) AS users FROM v2_quests WHERE completedAt >= ?1"],
  ["challenges", "SELECT COUNT(DISTINCT accountId) AS users FROM v2_challenges WHERE joinedAt >= ?1"],
];

export async function activityRaw(db: DB, since: string, since7: string, since30: string): Promise<ActivityRaw> {
  const results = await db.batch([
    ...DAILY.map(([kind, table, filter]) =>
      db.prepare(`SELECT date, '${kind}' AS kind, COUNT(*) AS n, COUNT(DISTINCT accountId) AS users FROM ${table} WHERE ${filter}date >= ?1 GROUP BY date`).bind(since)),
    db.prepare("SELECT date, 'events' AS kind, SUM(count) AS n, COUNT(DISTINCT accountId) AS users FROM v2_analytics_events WHERE date >= ?1 AND accountId IS NOT NULL GROUP BY date").bind(since),
    db.prepare("SELECT substr(createdAt, 1, 10) AS date, 'signups' AS kind, COUNT(*) AS n, COUNT(*) AS users FROM v2_accounts WHERE createdAt >= ?1 GROUP BY substr(createdAt, 1, 10)").bind(since),
    ...ADOPTION.map(([, sql]) => db.prepare(sql).bind(since30)),
    db.prepare(`SELECT date, COUNT(DISTINCT accountId) AS users FROM (${ACTIVE_PAIRS}) GROUP BY date`).bind(since),
    db.prepare(`SELECT COUNT(DISTINCT accountId) AS n FROM (${ACTIVE_PAIRS})`).bind(since7),
    db.prepare(`SELECT COUNT(DISTINCT accountId) AS n FROM (${ACTIVE_PAIRS})`).bind(since30),
    db.prepare("SELECT COUNT(*) AS n FROM v2_accounts"),
    db.prepare(`
      SELECT event, SUM(count) AS n, COUNT(DISTINCT accountId) AS users FROM v2_analytics_events
      WHERE date >= ?1 AND accountId IS NOT NULL GROUP BY event ORDER BY n DESC LIMIT 25`).bind(since7),
    db.prepare(`
      SELECT substr(a.createdAt, 1, 10) AS joined,
        GROUP_CONCAT(DISTINCT CAST((julianday(w.date) - julianday(substr(a.createdAt, 1, 10))) / 7 AS INTEGER)) AS weeks
      FROM v2_accounts a
      LEFT JOIN v2_workout_sessions w ON w.accountId = a.id AND w.completed = 1 AND w.date >= substr(a.createdAt, 1, 10)
      WHERE a.createdAt >= ?1 GROUP BY a.id`).bind(since),
    db.prepare(`
      SELECT p.accountId AS id, COALESCE(p.name, 'id ' || p.accountId) AS name,
        (SELECT COUNT(*) FROM v2_workout_sessions w WHERE w.accountId = p.accountId AND w.completed = 1 AND w.date >= ?1) AS workouts,
        (SELECT COUNT(*) FROM v2_nutrition_days n WHERE n.accountId = p.accountId AND n.date >= ?1) AS nutritionDays,
        x.activeDays AS activeDays, x.lastActive AS lastActive
      FROM (SELECT accountId, COUNT(DISTINCT date) AS activeDays, MAX(date) AS lastActive FROM (${ACTIVE_PAIRS}) GROUP BY accountId) x
      JOIN v2_profiles p ON p.accountId = x.accountId
      ORDER BY x.activeDays DESC, workouts DESC LIMIT 15`).bind(since30),
  ]);
  const perDayParts = results.slice(0, DAILY.length + 2);
  const adoptionParts = results.slice(DAILY.length + 2, DAILY.length + 2 + ADOPTION.length);
  const [dau, wau, mau, total, topEvents, cohorts, topUsers] = results.slice(DAILY.length + 2 + ADOPTION.length);
  const rows = <T>(r: { results?: unknown[] } | undefined) => (r?.results ?? []) as T[];
  const one = (r: { results?: unknown[] } | undefined) => Number((r?.results?.[0] as { n?: number } | undefined)?.n ?? 0);
  return {
    perDay: perDayParts.flatMap((r) => rows<{ date: string; kind: ActivityKind; n: number; users: number }>(r)).map((r) => ({ ...r, n: Number(r.n) || 0, users: Number(r.users) || 0 })),
    dau: rows<{ date: string; users: number }>(dau),
    wau: one(wau),
    mau: one(mau),
    totalUsers: one(total),
    adoption: ADOPTION.map(([feature], i) => ({ feature, users: Number((adoptionParts[i]?.results?.[0] as { users?: number } | undefined)?.users ?? 0) })),
    topEvents: rows<{ event: string; n: number; users: number }>(topEvents),
    cohorts: rows<{ joined: string; weeks: string | null }>(cohorts).map((x) => ({
      joined: x.joined,
      trainedWeeks: x.weeks ? x.weeks.split(",").map(Number).filter((n) => Number.isFinite(n)) : [],
    })),
    topUsers: rows<ActivityRaw["topUsers"][number]>(topUsers),
  };
}
