// v2-native workout-log + strength/PR-record repo (Domain 4 of the v2 cutover — see
// docs/adr/0001-v2-seams-and-staged-cutover.md). Faithful port of the workout-logging + PR
// subset of src/db/repos/workouts.ts: same exported names/signatures (so a call site switches by
// changing one import), same filters/ordering/edge cases — but reads/writes ONLY
// v2_workout_sessions/v2_workout_exercises/v2_workout_sets (migrations/0069_v2_core.sql,
// 0070_v2_long_tail.sql) and the new v2_strength_records (migrations/0079_v2_workouts_complete.sql,
// which also added v2_workout_sets.rpe — see that file's header comment for both gaps).
//
// Out of scope, deliberately left on legacy src/db/repos/workouts.ts (Domain 8's — buddy/
// achievements/challenges/leaderboard/squads, per the plan's domain inventory — being built by a
// concurrent session): awardAchievement/listAchievements (v2_achievements already exists as a
// table but migrating its readers is Domain 8's job, not this one's); friendIds/allBuddyPairs/
// recordBuddyDuel/buddyWinCount/buddyDuelHistory (buddy_duels has no v2 table at all yet); and
// listCompetitors/competitorWorkoutDates/competitorStrength/competitorBodyweights (leaderboard
// composite queries that join users+workout/strength/body tables for board-building — Domain 8's
// rollup surface, not workout-log CRUD or PR bookkeeping).
import type { ExerciseMetric, LoggedExercise, StrengthRecordDoc, Weekday, WorkoutLogDoc } from "../../types";
import { nowIso, type DB } from "../../db/repos/shared";

// ---------- strength records ----------

interface V2StrengthRow {
  accountId: number;
  exercise: string;
  bestWeight: number;
  bestReps: number;
  bestSeconds: number;
  bestMeters: number;
  metric: string;
  history: string;
  updatedAt: string;
}

function toStrength(r: V2StrengthRow): StrengthRecordDoc {
  let history: StrengthRecordDoc["history"] = [];
  try { history = JSON.parse(r.history); } catch { history = []; }
  return {
    userId: r.accountId,
    exercise: r.exercise,
    bestWeight: r.bestWeight,
    bestReps: r.bestReps,
    bestSeconds: r.bestSeconds ?? 0,
    bestMeters: r.bestMeters ?? 0,
    metric: (r.metric as StrengthRecordDoc["metric"]) ?? "reps",
    history,
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
    .prepare("SELECT bestWeight, bestReps, bestSeconds, bestMeters, history FROM v2_strength_records WHERE accountId = ? AND exercise = ?")
    .bind(userId, exercise)
    .first<{ bestWeight: number; bestReps: number; bestSeconds: number; bestMeters: number; history: string }>();
  if (!row) {
    await db
      .prepare(
        "INSERT INTO v2_strength_records (accountId, exercise, bestWeight, bestReps, bestSeconds, bestMeters, metric, history, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
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
      "UPDATE v2_strength_records SET bestWeight = ?, bestReps = ?, bestSeconds = ?, bestMeters = ?, metric = ?, history = ?, updatedAt = ? WHERE accountId = ? AND exercise = ?",
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
  const sql = `SELECT * FROM v2_strength_records WHERE accountId = ? ORDER BY bestWeight DESC${limit ? " LIMIT ?" : ""}`;
  const stmt = limit ? db.prepare(sql).bind(userId, limit) : db.prepare(sql).bind(userId);
  const r = await stmt.all<V2StrengthRow>();
  return (r.results ?? []).map(toStrength);
}

// ---------- workout logs ----------

interface V2SessionRow {
  id: number;
  accountId: number;
  date: string;
  weekday: number | null;
  completed: number;
  rawText: string | null;
  createdAt: string;
  updatedAt: string;
}

interface V2ExerciseRow {
  id: number;
  sessionId: number;
  position: number;
  name: string;
  metric: string;
  skipped: number;
  rpe: number | null;
}

interface V2SetRow {
  id: number;
  exerciseId: number;
  position: number;
  weight: number;
  reps: number;
  seconds: number | null;
  meters: number | null;
  rpe: number | null;
}

function toLoggedExercise(row: V2ExerciseRow, sets: V2SetRow[]): LoggedExercise {
  return {
    name: row.name,
    skipped: !!row.skipped,
    rpe: row.rpe ?? undefined,
    setsDone: sets
      .slice()
      .sort((a, b) => a.position - b.position)
      .map((s) => ({
        reps: s.reps,
        weight: s.weight,
        ...(s.seconds != null ? { seconds: s.seconds } : {}),
        ...(s.meters != null ? { meters: s.meters } : {}),
        ...(s.rpe != null ? { rpe: s.rpe } : {}),
      })),
  };
}

function toWorkoutLog(session: V2SessionRow, exercises: LoggedExercise[]): WorkoutLogDoc {
  return {
    userId: session.accountId,
    date: session.date,
    weekday: (session.weekday ?? 1) as Weekday,
    exercises,
    completed: !!session.completed,
    notes: session.rawText ?? undefined,
    createdAt: new Date(session.createdAt),
  };
}

/** Batch-load full WorkoutLogDocs for a set of session rows in three round-trips total
 * (sessions already fetched by the caller, then all their exercises, then all those exercises'
 * sets) rather than N+1 nested awaits per session — matters for allWorkoutLogsSince's
 * all-users-since-a-date scheduler prefetch, which can return hundreds of rows. */
// D1 rejects a statement above a few hundred bound parameters ("too many SQL variables") --
// hit for real once allWorkoutLogsSince (the dashboard's trainer-section bulk fetch) pulled
// every account's sessions/exercises for a real multi-user, multi-week window. Chunking keeps
// each IN (...) query's parameter count bounded regardless of how many ids are being looked up.
const ID_CHUNK_SIZE = 100;

async function selectByIdsInChunks<T>(
  db: DB,
  ids: number[],
  buildQuery: (placeholders: string) => string,
): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += ID_CHUNK_SIZE) {
    const chunk = ids.slice(i, i + ID_CHUNK_SIZE);
    const r = await db.prepare(buildQuery(chunk.map(() => "?").join(","))).bind(...chunk).all<T>();
    out.push(...(r.results ?? []));
  }
  return out;
}

async function loadWorkoutLogs(db: DB, sessions: V2SessionRow[]): Promise<WorkoutLogDoc[]> {
  if (!sessions.length) return [];
  const sessionIds = sessions.map((s) => s.id);
  const exerciseRows = await selectByIdsInChunks<V2ExerciseRow>(db, sessionIds, (placeholders) =>
    `SELECT * FROM v2_workout_exercises WHERE sessionId IN (${placeholders}) ORDER BY sessionId, position`,
  );

  const setsByExercise = new Map<number, V2SetRow[]>();
  if (exerciseRows.length) {
    const exerciseIds = exerciseRows.map((e) => e.id);
    const setRows = await selectByIdsInChunks<V2SetRow>(db, exerciseIds, (placeholders) =>
      `SELECT * FROM v2_workout_sets WHERE exerciseId IN (${placeholders}) ORDER BY exerciseId, position`,
    );
    for (const row of setRows) {
      const list = setsByExercise.get(row.exerciseId) ?? [];
      list.push(row);
      setsByExercise.set(row.exerciseId, list);
    }
  }

  const exercisesBySession = new Map<number, LoggedExercise[]>();
  for (const row of exerciseRows) {
    const list = exercisesBySession.get(row.sessionId) ?? [];
    list.push(toLoggedExercise(row, setsByExercise.get(row.id) ?? []));
    exercisesBySession.set(row.sessionId, list);
  }

  return sessions.map((s) => toWorkoutLog(s, exercisesBySession.get(s.id) ?? []));
}

// Replaces the session's whole exercise/set tree (delete-then-insert) — same convention as
// v2Plans.ts's writeSplit/v2Projection.ts's projectWorkout: ids are derived from the parent
// (`sessionId * 100 + position + 1` for exercises, `exerciseId * 100 + setPosition + 1` for
// sets), and writes are chunked at 50 statements per db.batch() call (D1's per-call ceiling) —
// each chunk is atomic, the whole tree is not (accepted trade-off, same as those precedents).
async function writeExercises(db: DB, sessionId: number, exercises: WorkoutLogDoc["exercises"]): Promise<void> {
  const statements: D1PreparedStatement[] = [db.prepare("DELETE FROM v2_workout_exercises WHERE sessionId = ?").bind(sessionId)];
  exercises.forEach((exercise, position) => {
    const exerciseId = sessionId * 100 + position + 1;
    const metric: ExerciseMetric = exercise.setsDone.some((set) => set.meters != null)
      ? "distance"
      : exercise.setsDone.some((set) => set.seconds != null)
        ? "time"
        : "reps";
    statements.push(
      db
        .prepare("INSERT INTO v2_workout_exercises (id, sessionId, position, name, metric, skipped, rpe) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .bind(exerciseId, sessionId, position, exercise.name, metric, exercise.skipped ? 1 : 0, exercise.rpe ?? null),
    );
    exercise.setsDone.forEach((set, setPosition) => {
      statements.push(
        db
          .prepare("INSERT INTO v2_workout_sets (id, exerciseId, position, weight, reps, seconds, meters, rpe) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
          .bind(exerciseId * 100 + setPosition + 1, exerciseId, setPosition, set.weight, set.reps, set.seconds ?? null, set.meters ?? null, set.rpe ?? null),
      );
    });
  });
  for (let i = 0; i < statements.length; i += 50) {
    await db.batch(statements.slice(i, i + 50));
  }
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
  const now = nowIso();
  await db
    .prepare(
      `INSERT INTO v2_workout_sessions (accountId, date, weekday, completed, rawText, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(accountId, date) DO UPDATE SET
         weekday = excluded.weekday, completed = excluded.completed, rawText = excluded.rawText, updatedAt = excluded.updatedAt`,
    )
    .bind(userId, date, weekday, completed ? 1 : 0, notes ?? null, now, now)
    .run();
  // ON CONFLICT DO UPDATE doesn't reliably surface last_row_id across drivers -- same two-step
  // shape v2Projection.ts's projectWorkout already uses (insert/upsert, then re-select the id).
  const session = await db.prepare("SELECT id FROM v2_workout_sessions WHERE accountId = ? AND date = ?").bind(userId, date).first<{ id: number }>();
  if (!session) return;
  await writeExercises(db, session.id, exercises);
}

export async function getWorkoutLog(db: DB, userId: number, date: string): Promise<WorkoutLogDoc | null> {
  const r = await db.prepare("SELECT * FROM v2_workout_sessions WHERE accountId = ? AND date = ?").bind(userId, date).first<V2SessionRow>();
  if (!r) return null;
  const [doc] = await loadWorkoutLogs(db, [r]);
  return doc ?? null;
}

/** ALL users' workout logs on/after `sinceDate` — bulk prefetch of "today's log" (covering
 * every local timezone's today) for the hourly scheduler pass. */
export async function allWorkoutLogsSince(db: DB, sinceDate: string): Promise<WorkoutLogDoc[]> {
  const r = await db.prepare("SELECT * FROM v2_workout_sessions WHERE date >= ?").bind(sinceDate).all<V2SessionRow>();
  return loadWorkoutLogs(db, r.results ?? []);
}

export async function recentWorkoutLogs(db: DB, userId: number, limit: number): Promise<WorkoutLogDoc[]> {
  const r = await db
    .prepare("SELECT * FROM v2_workout_sessions WHERE accountId = ? ORDER BY date DESC LIMIT ?")
    .bind(userId, limit)
    .all<V2SessionRow>();
  return loadWorkoutLogs(db, r.results ?? []);
}

export async function workoutLogsSince(db: DB, userId: number, cutoff: string): Promise<WorkoutLogDoc[]> {
  const r = await db
    .prepare("SELECT * FROM v2_workout_sessions WHERE accountId = ? AND date >= ?")
    .bind(userId, cutoff)
    .all<V2SessionRow>();
  return loadWorkoutLogs(db, r.results ?? []);
}

export async function countWorkoutsSince(db: DB, cutoff: string): Promise<number> {
  const r = await db
    .prepare("SELECT COUNT(*) AS c FROM v2_workout_sessions WHERE date >= ?")
    .bind(cutoff)
    .first<{ c: number }>();
  return r?.c ?? 0;
}

export async function countCompletedWorkouts(db: DB, userId: number): Promise<number> {
  const r = await db
    .prepare("SELECT COUNT(*) AS c FROM v2_workout_sessions WHERE accountId = ? AND completed = 1")
    .bind(userId)
    .first<{ c: number }>();
  return r?.c ?? 0;
}

// All-users completed workouts in [from, toExclusive) — for the owner report's week-over-week trend.
export async function countCompletedWorkoutsBetween(db: DB, from: string, toExclusive: string): Promise<number> {
  const r = await db
    .prepare("SELECT COUNT(*) AS c FROM v2_workout_sessions WHERE completed = 1 AND date >= ? AND date < ?")
    .bind(from, toExclusive)
    .first<{ c: number }>();
  return r?.c ?? 0;
}
