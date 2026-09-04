// Strength records, workout-log CRUD, and the leaderboard/achievement surface (they share the
// StrengthRow mapper and are mutually referential — awardAchievement's badges are earned from
// workout counts, competitorStrength ranks the same strength_records table listStrength reads).
// Split out of repos.ts (god-file split, same barrel seam); behavior unchanged.
import type { ExerciseMetric, StrengthRecordDoc, Weekday, WorkoutLogDoc } from "../../types";
import { nowIso, type DB } from "./shared";

// ---------- strength ----------

interface StrengthRow {
  userId: number;
  exercise: string;
  bestWeight: number;
  bestReps: number;
  bestSeconds?: number;
  bestMeters?: number;
  metric?: string;
  history: string;
  updatedAt: string;
}

function toStrength(r: StrengthRow): StrengthRecordDoc {
  return {
    userId: r.userId,
    exercise: r.exercise,
    bestWeight: r.bestWeight,
    bestReps: r.bestReps,
    bestSeconds: r.bestSeconds ?? 0,
    bestMeters: r.bestMeters ?? 0,
    metric: (r.metric as StrengthRecordDoc["metric"]) ?? "reps",
    history: JSON.parse(r.history),
    updatedAt: new Date(r.updatedAt),
  };
}

export interface PrResult {
  isPR: boolean; // beat a previous best (not the first-ever record)
  prevWeight?: number;
  prevReps?: number;
}

/** Best set of one exercise in a session, on whichever axis the exercise is measured. */
export interface BestSet {
  metric: ExerciseMetric;
  weight: number;
  reps: number;
  seconds?: number;
  meters?: number;
}

export async function upsertStrengthRecord(
  db: DB,
  userId: number,
  exercise: string,
  best: BestSet,
  date: string,
  rpe?: number,
): Promise<PrResult> {
  const now = nowIso();
  const { metric, weight, reps, seconds = 0, meters = 0 } = best;
  const entry = {
    date,
    weight,
    reps,
    ...(seconds > 0 ? { seconds } : {}),
    ...(meters > 0 ? { meters } : {}),
    ...(typeof rpe === "number" ? { rpe } : {}),
  };
  const row = await db
    .prepare("SELECT bestWeight, bestReps, bestSeconds, bestMeters, history FROM strength_records WHERE userId = ? AND exercise = ?")
    .bind(userId, exercise)
    .first<{ bestWeight: number; bestReps: number; bestSeconds: number; bestMeters: number; history: string }>();
  if (!row) {
    await db
      .prepare(
        "INSERT INTO strength_records (userId, exercise, bestWeight, bestReps, bestSeconds, bestMeters, metric, history, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(userId, exercise, weight, reps, seconds, meters, metric, JSON.stringify([entry]), now)
      .run();
    return { isPR: false };
  }
  const history = JSON.parse(row.history) as { date: string; weight: number; reps: number; seconds?: number; meters?: number; rpe?: number }[];
  history.push(entry);
  // "Better" and PR-worthiness are judged on the exercise's native axis. Time/distance PRs count
  // even at bodyweight; weight×reps PRs require external load (bodyweight reps don't rank).
  let better: boolean;
  let isPR: boolean;
  if (metric === "time") {
    better = seconds > (row.bestSeconds ?? 0);
    isPR = better && (row.bestSeconds ?? 0) > 0;
  } else if (metric === "distance") {
    better = meters > (row.bestMeters ?? 0);
    isPR = better && (row.bestMeters ?? 0) > 0;
  } else {
    better = weight > row.bestWeight || (weight === row.bestWeight && reps > row.bestReps);
    isPR = better && weight > 0;
  }
  await db
    .prepare(
      "UPDATE strength_records SET bestWeight = ?, bestReps = ?, bestSeconds = ?, bestMeters = ?, metric = ?, history = ?, updatedAt = ? WHERE userId = ? AND exercise = ?",
    )
    .bind(
      metric === "reps" && better ? weight : row.bestWeight,
      metric === "reps" && better ? reps : row.bestReps,
      metric === "time" && better ? seconds : (row.bestSeconds ?? 0),
      metric === "distance" && better ? meters : (row.bestMeters ?? 0),
      metric,
      JSON.stringify(history),
      now,
      userId,
      exercise,
    )
    .run();
  return { isPR, prevWeight: row.bestWeight, prevReps: row.bestReps };
}

export async function listStrength(db: DB, userId: number, limit?: number): Promise<StrengthRecordDoc[]> {
  const sql = `SELECT * FROM strength_records WHERE userId = ? ORDER BY bestWeight DESC${limit ? " LIMIT ?" : ""}`;
  const stmt = limit ? db.prepare(sql).bind(userId, limit) : db.prepare(sql).bind(userId);
  const r = await stmt.all<StrengthRow>();
  return (r.results ?? []).map(toStrength);
}

// ---------- workout logs ----------

interface WorkoutRow {
  userId: number;
  date: string;
  weekday: number | null;
  exercises: string;
  completed: number;
  notes: string | null;
  createdAt: string;
}

function toWorkout(r: WorkoutRow): WorkoutLogDoc {
  return {
    userId: r.userId,
    date: r.date,
    weekday: (r.weekday ?? 1) as Weekday,
    exercises: JSON.parse(r.exercises),
    completed: !!r.completed,
    notes: r.notes ?? undefined,
    createdAt: new Date(r.createdAt),
  };
}

export async function upsertWorkoutLog(
  db: DB,
  userId: number,
  date: string,
  weekday: Weekday,
  exercises: WorkoutLogDoc["exercises"],
  completed: boolean,
  notes?: string,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO workout_logs (userId, date, weekday, exercises, completed, notes, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(userId, date) DO UPDATE SET
         weekday = excluded.weekday, exercises = excluded.exercises,
         completed = excluded.completed, notes = excluded.notes`,
    )
    .bind(userId, date, weekday, JSON.stringify(exercises), completed ? 1 : 0, notes ?? null, nowIso())
    .run();
}

export async function getWorkoutLog(db: DB, userId: number, date: string): Promise<WorkoutLogDoc | null> {
  const r = await db
    .prepare("SELECT * FROM workout_logs WHERE userId = ? AND date = ?")
    .bind(userId, date)
    .first<WorkoutRow>();
  return r ? toWorkout(r) : null;
}

/** ALL users' workout logs on/after `sinceDate` — bulk prefetch of "today's log" (covering
 * every local timezone's today) for the hourly scheduler pass. */
export async function allWorkoutLogsSince(db: DB, sinceDate: string): Promise<WorkoutLogDoc[]> {
  const r = await db.prepare("SELECT * FROM workout_logs WHERE date >= ?").bind(sinceDate).all<WorkoutRow>();
  return (r.results ?? []).map(toWorkout);
}

export async function recentWorkoutLogs(db: DB, userId: number, limit: number): Promise<WorkoutLogDoc[]> {
  const r = await db
    .prepare("SELECT * FROM workout_logs WHERE userId = ? ORDER BY date DESC LIMIT ?")
    .bind(userId, limit)
    .all<WorkoutRow>();
  return (r.results ?? []).map(toWorkout);
}

export async function workoutLogsSince(db: DB, userId: number, cutoff: string): Promise<WorkoutLogDoc[]> {
  const r = await db
    .prepare("SELECT * FROM workout_logs WHERE userId = ? AND date >= ?")
    .bind(userId, cutoff)
    .all<WorkoutRow>();
  return (r.results ?? []).map(toWorkout);
}

export async function countWorkoutsSince(db: DB, cutoff: string): Promise<number> {
  const r = await db
    .prepare("SELECT COUNT(*) AS c FROM workout_logs WHERE date >= ?")
    .bind(cutoff)
    .first<{ c: number }>();
  return r?.c ?? 0;
}

export async function countCompletedWorkouts(db: DB, userId: number): Promise<number> {
  const r = await db
    .prepare("SELECT COUNT(*) AS c FROM workout_logs WHERE userId = ? AND completed = 1")
    .bind(userId)
    .first<{ c: number }>();
  return r?.c ?? 0;
}

// All-users completed workouts in [from, toExclusive) — for the owner report's week-over-week trend.
export async function countCompletedWorkoutsBetween(db: DB, from: string, toExclusive: string): Promise<number> {
  const r = await db
    .prepare("SELECT COUNT(*) AS c FROM workout_logs WHERE completed = 1 AND date >= ? AND date < ?")
    .bind(from, toExclusive)
    .first<{ c: number }>();
  return r?.c ?? 0;
}

// ---------- bot records (leaderboards + achievements) ----------

/** Insert a badge once; returns true if it was newly earned (for one-time celebration). */
export async function awardAchievement(db: DB, userId: number, code: string): Promise<boolean> {
  const r = await db
    .prepare("INSERT OR IGNORE INTO achievements (userId, code, earnedAt) VALUES (?, ?, ?)")
    .bind(userId, code, nowIso())
    .run();
  return (r.meta?.changes ?? 0) > 0;
}

export async function listAchievements(db: DB, userId: number): Promise<string[]> {
  const r = await db
    .prepare("SELECT code FROM achievements WHERE userId = ? ORDER BY earnedAt ASC")
    .bind(userId)
    .all<{ code: string }>();
  return (r.results ?? []).map((x) => x.code);
}

export interface CompetitorRow {
  userId: number;
  lang: string;
  chatId: number;
  alias: string | null;
  profile: string;
}

/** The user's friend graph, derived from referrals (bidirectional): the person who invited
 * them + everyone they invited. Used to scope leaderboards to a friend circle. */
export async function friendIds(db: DB, userId: number): Promise<number[]> {
  const [me, invitees] = await Promise.all([
    db.prepare("SELECT json_extract(profile,'$.referredBy') AS ref FROM users WHERE id = ?").bind(userId).first<{ ref: number | null }>(),
    db.prepare("SELECT id FROM users WHERE json_extract(profile,'$.referredBy') = ?").bind(userId).all<{ id: number }>(),
  ]);
  const ids = new Set<number>();
  if (me?.ref) ids.add(Number(me.ref));
  for (const r of invitees.results ?? []) ids.add(r.id);
  ids.delete(userId);
  return [...ids];
}

/** All opted-in users with the fields needed to build/notify leaderboards. */
export async function listCompetitors(db: DB): Promise<CompetitorRow[]> {
  const r = await db
    .prepare("SELECT id AS userId, lang, chatId, alias, profile FROM users WHERE competeOptIn = 1")
    .all<CompetitorRow>();
  return r.results ?? [];
}

/** All completed-workout dates for opted-in users (for consistency/streak/total boards). */
export async function competitorWorkoutDates(db: DB): Promise<{ userId: number; date: string }[]> {
  const r = await db
    .prepare(
      "SELECT w.userId AS userId, w.date AS date FROM workout_logs w JOIN users u ON u.id = w.userId WHERE u.competeOptIn = 1 AND w.completed = 1",
    )
    .all<{ userId: number; date: string }>();
  return r.results ?? [];
}

/** Strength records for opted-in users (for relative-strength / most-improved boards). */
export async function competitorStrength(db: DB): Promise<StrengthRecordDoc[]> {
  const r = await db
    .prepare(
      "SELECT s.* FROM strength_records s JOIN users u ON u.id = s.userId WHERE u.competeOptIn = 1",
    )
    .all<StrengthRow>();
  return (r.results ?? []).map(toStrength);
}

/** Latest recorded bodyweight per opted-in user (for relative strength). */
export async function competitorBodyweights(db: DB): Promise<Map<number, number>> {
  const r = await db
    .prepare(
      "SELECT b.userId AS userId, b.weight AS weight, b.date AS date FROM body_logs b JOIN users u ON u.id = b.userId WHERE u.competeOptIn = 1 AND b.weight IS NOT NULL ORDER BY b.date ASC",
    )
    .all<{ userId: number; weight: number; date: string }>();
  const out = new Map<number, number>();
  for (const row of r.results ?? []) out.set(row.userId, row.weight); // ASC → last wins = latest
  return out;
}
