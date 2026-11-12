// v2-native workout-log + strength/PR-record repo (Domain 4 of the v2 cutover — see
// docs/adr/0001-v2-seams-and-staged-cutover.md). Faithful port of the workout-logging + PR
// subset of src/db/repos/workouts.ts: same exported names/signatures (so a call site switches by
// changing one import), same filters/ordering/edge cases — but reads/writes ONLY
// v2_workout_sessions/v2_workout_exercises/v2_workout_sets (migrations/0069_v2_core.sql,
// 0070_v2_long_tail.sql) and the new v2_strength_records (migrations/0079_v2_workouts_complete.sql,
// which also added v2_workout_sets.rpe — see that file's header comment for both gaps).
//
// Achievements, buddies, competitors and leaderboards live in v2Gamification.ts.
import type { ExerciseMetric, LoggedExercise, StrengthRecordDoc, Weekday, WorkoutLogDoc } from "../../types";
import { allInChunks, nowIso, type DB } from "./shared";

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

/** One entry per date, keeping the last one written. Saving the same day again used to append
 * another entry every time, so a session saved three times charted as three identical points.
 * Applied on read as well, which collapses rows written before the fix without a data migration. */
export function oneEntryPerDate<T extends { date: string }>(history: T[]): T[] {
  const byDate = new Map<string, T>();
  for (const entry of history) {
    byDate.delete(entry.date); // re-insert so the surviving entry keeps the position of the latest write
    byDate.set(entry.date, entry);
  }
  return [...byDate.values()];
}

function toStrength(r: V2StrengthRow): StrengthRecordDoc {
  let history: StrengthRecordDoc["history"] = [];
  try { history = oneEntryPerDate(JSON.parse(r.history)); } catch { history = []; }
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

interface PrResult {
  isPR: boolean; // beat a previous best (not the first-ever record)
  prevWeight?: number;
  prevReps?: number;
}

/** Best set of one exercise in a session, on whichever axis the exercise is measured. */
interface BestSet {
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
  type Entry = { date: string; weight: number; reps: number; seconds?: number; meters?: number; rpe?: number };
  const stored = JSON.parse(row.history) as Entry[];
  // A re-save of the same day replaces that day's entry instead of adding another one. Kept in
  // date order: a back-filled day used to land at the end, and deloadDue reads the first and last
  // entries as the oldest and newest.
  const history = oneEntryPerDate([...stored, entry]).sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));
  // The stored best normally only moves up. The exception is a corrected day: when the entry
  // being replaced IS the stored best (800 x 5 typed for 80 x 5), the best is taken from the
  // history again, or the typo stays the record for good and no PR can fire after it.
  const replaced = stored.find((e) => e.date === date);
  const amount = (e: Entry) => (metric === "time" ? e.seconds ?? 0 : metric === "distance" ? e.meters ?? 0 : e.weight);
  const wasBest = !!replaced && (metric === "time" ? (replaced.seconds ?? 0) === (row.bestSeconds ?? 0)
    : metric === "distance" ? (replaced.meters ?? 0) === (row.bestMeters ?? 0)
    : replaced.weight === row.bestWeight && replaced.reps === row.bestReps);
  let prior = { weight: row.bestWeight, reps: row.bestReps, seconds: row.bestSeconds ?? 0, meters: row.bestMeters ?? 0 };
  if (wasBest) {
    const others = stored.filter((e) => e.date !== date);
    const top = others.reduce<Entry | null>((best, e) => (!best || amount(e) > amount(best) || (metric === "reps" && e.weight === best.weight && e.reps > best.reps) ? e : best), null);
    prior = { ...prior, ...(metric === "time" ? { seconds: top?.seconds ?? 0 } : metric === "distance" ? { meters: top?.meters ?? 0 } : { weight: top?.weight ?? 0, reps: top?.reps ?? 0 }) };
  }
  // "Better" and PR-worthiness are judged on the exercise's native axis. Time/distance PRs count
  // even at bodyweight; weight×reps PRs require external load (bodyweight reps don't rank).
  let better: boolean;
  let isPR: boolean;
  if (metric === "time") {
    better = seconds > prior.seconds;
    isPR = better && prior.seconds > 0;
  } else if (metric === "distance") {
    better = meters > prior.meters;
    isPR = better && prior.meters > 0;
  } else {
    better = weight > prior.weight || (weight === prior.weight && reps > prior.reps);
    isPR = better && weight > 0 && (prior.weight > 0 || prior.reps > 0 || !wasBest);
  }
  await db
    .prepare(
      "UPDATE v2_strength_records SET bestWeight = ?, bestReps = ?, bestSeconds = ?, bestMeters = ?, metric = ?, history = ?, updatedAt = ? WHERE accountId = ? AND exercise = ?",
    )
    .bind(
      metric === "reps" && better ? weight : prior.weight,
      metric === "reps" && better ? reps : prior.reps,
      metric === "time" && better ? seconds : prior.seconds,
      metric === "distance" && better ? meters : prior.meters,
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
  durationSec?: number | null;
  restTotalSec?: number | null;
}

interface V2ExerciseRow {
  id: number;
  sessionId: number;
  position: number;
  name: string;
  metric: string;
  skipped: number;
  rpe: number | null;
  planName?: string | null;
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
    ...(row.planName ? { planName: row.planName } : {}),
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
    updatedAt: new Date(session.updatedAt),
    ...(session.durationSec != null ? { durationSec: session.durationSec } : {}),
    ...(session.restTotalSec != null ? { restTotalSec: session.restTotalSec } : {}),
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

/** Sessions plus their exercise and set rows, assembled into WorkoutLogDocs. */
function assembleWorkoutLogs(sessions: V2SessionRow[], exerciseRows: V2ExerciseRow[], setRows: V2SetRow[]): WorkoutLogDoc[] {
  const setsByExercise = new Map<number, V2SetRow[]>();
  for (const row of setRows) {
    const list = setsByExercise.get(row.exerciseId) ?? [];
    list.push(row);
    setsByExercise.set(row.exerciseId, list);
  }
  const exercisesBySession = new Map<number, LoggedExercise[]>();
  for (const row of exerciseRows) {
    const list = exercisesBySession.get(row.sessionId) ?? [];
    list.push(toLoggedExercise(row, setsByExercise.get(row.id) ?? []));
    exercisesBySession.set(row.sessionId, list);
  }
  return sessions.map((s) => toWorkoutLog(s, exercisesBySession.get(s.id) ?? []));
}

async function loadWorkoutLogs(db: DB, sessions: V2SessionRow[]): Promise<WorkoutLogDoc[]> {
  if (!sessions.length) return [];
  const sessionIds = sessions.map((s) => s.id);
  const exerciseRows = await selectByIdsInChunks<V2ExerciseRow>(db, sessionIds, (placeholders) =>
    `SELECT * FROM v2_workout_exercises WHERE sessionId IN (${placeholders}) ORDER BY sessionId, position`,
  );
  const setRows = exerciseRows.length
    ? await selectByIdsInChunks<V2SetRow>(db, exerciseRows.map((e) => e.id), (placeholders) =>
      `SELECT * FROM v2_workout_sets WHERE exerciseId IN (${placeholders}) ORDER BY exerciseId, position`)
    : [];
  return assembleWorkoutLogs(sessions, exerciseRows, setRows);
}

// Replaces the session's whole exercise/set tree (delete-then-insert) — same convention as
// v2Plans.ts's writeSplit: ids are derived from the parent
// (`sessionId * 100 + position + 1` for exercises, `exerciseId * 100 + setPosition + 1` for
// sets), and writes are chunked at 50 statements per db.batch() call (D1's per-call ceiling) —
// each chunk is atomic, the whole tree is not (accepted trade-off, same as those precedents).
/** D1 binds at most 100 parameters per statement; a multi-row INSERT carries this many rows. */
const ROWS_PER_INSERT = (cols: number) => Math.floor(100 / cols);

/** `INSERT INTO table (cols) VALUES (?, ...), (?, ...)` statements for these rows, chunked under the bind cap. */
function multiInsert(db: DB, table: string, cols: string[], rows: unknown[][]): D1PreparedStatement[] {
  const per = ROWS_PER_INSERT(cols.length);
  const one = `(${cols.map(() => "?").join(", ")})`;
  const out: D1PreparedStatement[] = [];
  for (let i = 0; i < rows.length; i += per) {
    const chunk = rows.slice(i, i + per);
    out.push(db.prepare(`INSERT INTO ${table} (${cols.join(", ")}) VALUES ${chunk.map(() => one).join(", ")}`).bind(...chunk.flat()));
  }
  return out;
}

/**
 * The statements that replace a session's exercises and sets: one DELETE, then multi-row INSERTs
 * (12 rows each under D1's 100-bind cap). A 10 x 5 session is 7 statements instead of 61, which
 * matters on D1's free plan (50 queries per invocation), and the caller runs them in one batch,
 * so a failure leaves the previous exercises in place instead of half a workout.
 */
function exerciseStatements(db: DB, sessionId: number, exercises: WorkoutLogDoc["exercises"]): D1PreparedStatement[] {
  const exRows: unknown[][] = [];
  const setRows: unknown[][] = [];
  exercises.forEach((exercise, position) => {
    const exerciseId = sessionId * 100 + position + 1;
    const metric: ExerciseMetric = exercise.setsDone.some((set) => set.meters != null)
      ? "distance"
      : exercise.setsDone.some((set) => set.seconds != null)
        ? "time"
        : "reps";
    exRows.push([exerciseId, sessionId, position, exercise.name, metric, exercise.skipped ? 1 : 0, exercise.rpe ?? null, exercise.planName ?? null]);
    exercise.setsDone.forEach((set, setPosition) => {
      setRows.push([exerciseId * 100 + setPosition + 1, exerciseId, setPosition, set.weight, set.reps, set.seconds ?? null, set.meters ?? null, set.rpe ?? null]);
    });
  });
  return [
    db.prepare("DELETE FROM v2_workout_exercises WHERE sessionId = ?").bind(sessionId),
    ...multiInsert(db, "v2_workout_exercises", ["id", "sessionId", "position", "name", "metric", "skipped", "rpe", "planName"], exRows),
    ...multiInsert(db, "v2_workout_sets", ["id", "exerciseId", "position", "weight", "reps", "seconds", "meters", "rpe"], setRows),
  ];
}

export async function upsertWorkoutLog(
  db: DB,
  userId: number,
  date: string,
  weekday: Weekday,
  exercises: WorkoutLogDoc["exercises"],
  completed: boolean,
  notes?: string,
  timing?: { durationSec?: number; restTotalSec?: number },
): Promise<void> {
  const now = nowIso();
  // COALESCE: only the Mini App measures a session. A later save from a path that doesn't (a chat
  // edit, the quick-log API) must not wipe the length the app already recorded for that day.
  // RETURNING id gives the session's id from the upsert itself (inserted or updated), one round
  // trip instead of an upsert plus a SELECT.
  const session = await db
    .prepare(
      `INSERT INTO v2_workout_sessions (accountId, date, weekday, completed, rawText, createdAt, updatedAt, durationSec, restTotalSec)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(accountId, date) DO UPDATE SET
         weekday = excluded.weekday, completed = excluded.completed, rawText = excluded.rawText, updatedAt = excluded.updatedAt,
         durationSec = COALESCE(excluded.durationSec, durationSec), restTotalSec = COALESCE(excluded.restTotalSec, restTotalSec)
       RETURNING id`,
    )
    .bind(userId, date, weekday, completed ? 1 : 0, notes ?? null, now, now, timing?.durationSec ?? null, timing?.restTotalSec ?? null)
    .first<{ id: number }>();
  if (!session) return;
  await db.batch(exerciseStatements(db, session.id, exercises));
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

/** These accounts' workout logs on/after `sinceDate` (the trainer dashboard's clients). */
export async function workoutLogsForAccountsSince(db: DB, accountIds: number[], sinceDate: string): Promise<WorkoutLogDoc[]> {
  if (!accountIds.length) return [];
  const rows = await allInChunks<V2SessionRow>(db, accountIds, [sinceDate], (ph) => `SELECT * FROM v2_workout_sessions WHERE date >= ? AND accountId IN (${ph})`);
  return loadWorkoutLogs(db, rows);
}

export async function recentWorkoutLogs(db: DB, userId: number, limit: number): Promise<WorkoutLogDoc[]> {
  const r = await db
    .prepare("SELECT * FROM v2_workout_sessions WHERE accountId = ? ORDER BY date DESC LIMIT ?")
    .bind(userId, limit)
    .all<V2SessionRow>();
  return loadWorkoutLogs(db, r.results ?? []);
}

/**
 * One account's logs on/after `cutoff`, in ONE round trip: sessions, exercises and sets as three
 * statements in a batch, the children joined to the sessions by account and date. Loading the
 * children by id took a query per 100 ids, so the cost grew with the history (5 trips for the
 * dashboard's 84 days, about 10 for the streak job's 120).
 */
export async function workoutLogsSince(db: DB, userId: number, cutoff: string): Promise<WorkoutLogDoc[]> {
  const [sessions, exercises, sets] = await db.batch([
    db.prepare("SELECT * FROM v2_workout_sessions WHERE accountId = ? AND date >= ?").bind(userId, cutoff),
    db.prepare(
      `SELECT e.* FROM v2_workout_exercises e JOIN v2_workout_sessions s ON s.id = e.sessionId
       WHERE s.accountId = ? AND s.date >= ? ORDER BY e.sessionId, e.position`,
    ).bind(userId, cutoff),
    db.prepare(
      `SELECT st.* FROM v2_workout_sets st JOIN v2_workout_exercises e ON e.id = st.exerciseId
       JOIN v2_workout_sessions s ON s.id = e.sessionId
       WHERE s.accountId = ? AND s.date >= ? ORDER BY st.exerciseId, st.position`,
    ).bind(userId, cutoff),
  ]);
  return assembleWorkoutLogs((sessions.results ?? []) as V2SessionRow[], (exercises.results ?? []) as V2ExerciseRow[], (sets.results ?? []) as V2SetRow[]);
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

// ---------- in-progress logger drafts (Mini App) ----------
// The body is the client's own JSON, stored opaquely: the server never interprets it, it only
// hands it back to the same account for the same day. Size is capped by the API layer.

export async function getWorkoutDraft(db: DB, userId: number, date: string): Promise<{ body: string; updatedAt: string } | null> {
  return db.prepare("SELECT body, updatedAt FROM v2_workout_drafts WHERE accountId = ? AND date = ?").bind(userId, date).first<{ body: string; updatedAt: string }>();
}

export async function putWorkoutDraft(db: DB, userId: number, date: string, body: string): Promise<string> {
  const now = nowIso();
  await db
    .prepare(
      `INSERT INTO v2_workout_drafts (accountId, date, body, updatedAt) VALUES (?, ?, ?, ?)
       ON CONFLICT(accountId, date) DO UPDATE SET body = excluded.body, updatedAt = excluded.updatedAt`,
    )
    .bind(userId, date, body, now)
    .run();
  return now;
}

export async function deleteWorkoutDraft(db: DB, userId: number, date: string): Promise<void> {
  await db.prepare("DELETE FROM v2_workout_drafts WHERE accountId = ? AND date = ?").bind(userId, date).run();
}

/** Session-level effort ("how did it go?") for the exercises of that day without their own RPE.
 *  Returns how many exercises took it (0 when there is no completed session that day). */
export async function setSessionFeelRpe(db: DB, userId: number, date: string, rpe: number): Promise<number> {
  const r = await db.prepare(`UPDATE v2_workout_exercises SET rpe = ?
    WHERE rpe IS NULL AND skipped = 0
      AND sessionId = (SELECT id FROM v2_workout_sessions WHERE accountId = ? AND date = ? AND completed = 1)`)
    .bind(rpe, userId, date).run();
  return r.meta?.changes ?? 0;
}
