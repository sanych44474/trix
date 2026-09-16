-- Domain 4 (workout logs + strength/PR records) completeness pass. 0069/0070 gave
-- v2_workout_sessions/v2_workout_exercises/v2_workout_sets a PARTIAL shadow of
-- src/db/repos/workouts.ts's workout-logging exports (enough for the existing projectWorkout
-- dual-write), and gave `strength_records` (personal records) NO v2 table at all. Comparing
-- every in-scope workouts.ts export's actual column usage against the v2 schema (same exercise
-- as 0073/0075/0076/0077/0078) found two real gaps this migration closes:
--
--   1. THE MISSING TABLE: StrengthRecordDoc (src/types.ts) -- userId/exercise/bestWeight/
--      bestReps/bestSeconds/bestMeters/metric/history/updatedAt -- has no v2_* home whatsoever.
--      upsertStrengthRecord/listStrength (and competitorStrength, left on legacy for Domain 8 --
--      see src/adapters/d1/v2Workouts.ts's header comment) all read/write legacy
--      `strength_records` directly. v2_strength_records below is a faithful 1:1 port of legacy
--      `strength_records` (migrations/0001_init.sql + 0022_record_metrics.sql), keyed by
--      (accountId, exercise) same as legacy's (userId, exercise) primary key, with `history`
--      staying a JSON escape hatch (same as legacy) since it's an append-only log of
--      arbitrary-shaped per-PR snapshots, not a queried column.
--   2. SetEntry.rpe (src/types.ts) -- per-SET RPE, distinct from LoggedExercise.rpe (the
--      session-level exercise RPE, already a real column on v2_workout_exercises since 0069) --
--      has no column on v2_workout_sets. Legacy `workout_logs.exercises` is one JSON blob so this
--      round-trips losslessly there; the normalized v2_workout_sets table silently dropped it.
--      Same "hot column gets promoted" reasoning as every prior completeness migration -- rpe is
--      a plain scalar per set (not a nested structure), so a real column is simpler than a
--      per-set JSON escape hatch.
--
-- v2_workout_cardio_metrics (0070) already exists with an avgHeartRate column that has no legacy
-- source and no reader in workouts.ts's in-scope exports -- left untouched, out of this domain's
-- scope (a future wearables/tracking surface, not workout-log CRUD or PRs).

ALTER TABLE v2_workout_sets ADD COLUMN rpe REAL; -- per-set RPE (SetEntry.rpe, legacy exercises[].setsDone[].rpe)

CREATE TABLE IF NOT EXISTS v2_strength_records (
  accountId   INTEGER NOT NULL REFERENCES v2_accounts(id) ON DELETE CASCADE,
  exercise    TEXT    NOT NULL,
  bestWeight  REAL    NOT NULL DEFAULT 0,
  bestReps    INTEGER NOT NULL DEFAULT 0,
  bestSeconds INTEGER NOT NULL DEFAULT 0,
  bestMeters  INTEGER NOT NULL DEFAULT 0,
  metric      TEXT    NOT NULL DEFAULT 'reps',
  history     TEXT    NOT NULL DEFAULT '[]',
  updatedAt   TEXT    NOT NULL,
  PRIMARY KEY (accountId, exercise)
);

-- ---------- Idempotent backfill from legacy tables, same pattern as 0069/0070/.../0078 ----------

-- rpe backfill: correlate each v2_workout_sets row back to its legacy exercises[].setsDone[]
-- entry via the exercise's sessionId->(accountId,date) and position, same join shape 0069 used
-- to insert these rows in the first place (see that migration's v2_workout_sets INSERT).
UPDATE v2_workout_sets SET rpe = (
  SELECT json_extract(setRow.value, '$.rpe')
  FROM v2_workout_exercises e
  JOIN v2_workout_sessions ws ON ws.id = e.sessionId
  JOIN workout_logs w ON w.userId = ws.accountId AND w.date = ws.date
  JOIN json_each(w.exercises) raw ON CAST(raw.key AS INTEGER) = e.position
  JOIN json_each(json_extract(raw.value, '$.setsDone')) setRow ON CAST(setRow.key AS INTEGER) = v2_workout_sets.position
  WHERE json_valid(w.exercises) AND e.id = v2_workout_sets.exerciseId
)
WHERE EXISTS (
  SELECT 1
  FROM v2_workout_exercises e
  JOIN v2_workout_sessions ws ON ws.id = e.sessionId
  JOIN workout_logs w ON w.userId = ws.accountId AND w.date = ws.date
  JOIN json_each(w.exercises) raw ON CAST(raw.key AS INTEGER) = e.position
  JOIN json_each(json_extract(raw.value, '$.setsDone')) setRow ON CAST(setRow.key AS INTEGER) = v2_workout_sets.position
  WHERE json_valid(w.exercises) AND e.id = v2_workout_sets.exerciseId
);

INSERT OR IGNORE INTO v2_strength_records (accountId, exercise, bestWeight, bestReps, bestSeconds, bestMeters, metric, history, updatedAt)
SELECT userId, exercise, bestWeight, bestReps, bestSeconds, bestMeters, metric,
  CASE WHEN history IS NOT NULL AND json_valid(history) THEN history ELSE '[]' END,
  updatedAt
FROM strength_records;
