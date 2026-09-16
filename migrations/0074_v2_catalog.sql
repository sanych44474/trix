-- Domain 2 (exercise/library catalog) — src/db/repos/catalog.ts -> v2_*. Unlike every other
-- domain there is NO existing partial v2_* schema here (0069-0073 never touched this domain);
-- this migration creates it from scratch.
--
-- Design: this is reference/catalog data (API-Ninjas-seeded, admin/trainer-curated, read-heavy),
-- not per-user transactional state, so there is no "historical incremental migration" pressure
-- to collapse tables the way user-core's profile/preferences/onboarding split had. The legacy
-- 4-table split is kept as 4 tables here, 1:1, because each one has a genuinely distinct shape
-- and lifecycle that a merge would either lose or complicate for no benefit:
--   * v2_exercises          — the catalog itself, one row per exercise, admin-seeded.
--   * v2_exercise_translations — 0..N rows per exercise (one per non-English lang), lazily
--     AI-populated on first view. Folding this into a JSON column on v2_exercises would still
--     need per-lang json_extract for getExerciseTranslations' batched "WHERE lang = ? AND
--     exerciseId IN (...)" query — a real child table with the legacy (exerciseId, lang) PK is
--     simpler and keeps that query index-backed.
--   * v2_exercise_videos    — global YouTube-technique-video cache, keyed by normalizedName
--     (NOT exercise id — legacy exercise_videos predates a stable catalog id and callers still
--     key off the normalized display name), independent create/update cadence (search-refresh
--     cron, manual trainer/owner override) from the catalog row itself.
--   * v2_user_exercise_videos — per-user override of the above; naturally a separate table
--     (composite key includes the account), same as legacy.
-- Columns are renamed to this schema's camelCase convention (safety_info -> safetyInfo,
-- normalized_name -> normalizedName, etc.) but are otherwise a faithful, lossless port of the
-- legacy column set (migrations/0004, 0014, 0023). user_exercise_videos.userId becomes
-- accountId, FK'd to v2_accounts(id) — legacyUserId == v2_accounts.id for every existing user
-- (see 0069's backfill / v2Users.ts), so this is safe and consistent with every other
-- account-scoped v2 table.

CREATE TABLE IF NOT EXISTS v2_exercises (
  id           TEXT PRIMARY KEY,           -- stable hash of lower(name) (API returns no id)
  name         TEXT NOT NULL,              -- canonical English name
  type         TEXT,
  muscle       TEXT NOT NULL,              -- one of the 16 API muscle enums
  difficulty   TEXT,                       -- beginner | intermediate | expert
  equipments   TEXT NOT NULL DEFAULT '[]', -- JSON string[]
  instructions TEXT NOT NULL DEFAULT '',
  safetyInfo   TEXT NOT NULL DEFAULT '',
  fetchedAt    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_v2_exercises_muscle ON v2_exercises(muscle, difficulty);

CREATE TABLE IF NOT EXISTS v2_exercise_translations (
  exerciseId   TEXT NOT NULL REFERENCES v2_exercises(id) ON DELETE CASCADE,
  lang         TEXT NOT NULL,              -- 'uk' (en is served from the source row)
  name         TEXT NOT NULL,
  instructions TEXT NOT NULL,
  safetyInfo   TEXT NOT NULL,
  createdAt    TEXT NOT NULL,
  PRIMARY KEY (exerciseId, lang)
);

-- Cache of one short YouTube technique video per exercise (keyed by the normalized lowercased
-- English name, same as legacy exercise_videos). A row with youtubeUrl IS NULL is a negative
-- cache ("searched, found nothing"). locked=1 is a manual trainer/owner override, never
-- overwritten by refresh/backfill.
CREATE TABLE IF NOT EXISTS v2_exercise_videos (
  normalizedName  TEXT PRIMARY KEY,
  exerciseName    TEXT NOT NULL,
  youtubeVideoId  TEXT,                    -- NULL = negative cache (searched, no match)
  youtubeUrl      TEXT,                    -- https://www.youtube.com/shorts/<id>
  youtubeTitle    TEXT,
  channelName     TEXT,
  thumbnailUrl    TEXT,
  locked          INTEGER NOT NULL DEFAULT 0, -- 1 = manually set by trainer/owner
  setBy           INTEGER,                 -- chatId of the trainer/owner who locked it (audit)
  createdAt       TEXT NOT NULL,
  updatedAt       TEXT NOT NULL
);

-- Per-user technique-video override — a user's own link for an exercise, without changing the
-- shared v2_exercise_videos row trainers/owner manage globally. Render prefers this over the
-- global video.
CREATE TABLE IF NOT EXISTS v2_user_exercise_videos (
  accountId       INTEGER NOT NULL REFERENCES v2_accounts(id) ON DELETE CASCADE,
  normalizedName  TEXT    NOT NULL,
  exerciseName    TEXT    NOT NULL,
  youtubeVideoId  TEXT    NOT NULL,
  youtubeUrl      TEXT    NOT NULL,
  createdAt       TEXT    NOT NULL,
  updatedAt       TEXT    NOT NULL,
  PRIMARY KEY (accountId, normalizedName)
);

-- ---------- Idempotent backfill from legacy tables ----------

INSERT OR IGNORE INTO v2_exercises (id, name, type, muscle, difficulty, equipments, instructions, safetyInfo, fetchedAt)
SELECT id, name, type, muscle, difficulty, equipments, instructions, safety_info, fetchedAt
FROM exercises;

INSERT OR IGNORE INTO v2_exercise_translations (exerciseId, lang, name, instructions, safetyInfo, createdAt)
SELECT exerciseId, lang, name, instructions, safety_info, createdAt
FROM exercise_translations
WHERE EXISTS (SELECT 1 FROM v2_exercises e WHERE e.id = exercise_translations.exerciseId);

INSERT OR IGNORE INTO v2_exercise_videos (normalizedName, exerciseName, youtubeVideoId, youtubeUrl, youtubeTitle, channelName, thumbnailUrl, locked, setBy, createdAt, updatedAt)
SELECT normalized_name, exercise_name, youtube_video_id, youtube_url, youtube_title, channel_name, thumbnail_url, locked, set_by, createdAt, updatedAt
FROM exercise_videos;

INSERT OR IGNORE INTO v2_user_exercise_videos (accountId, normalizedName, exerciseName, youtubeVideoId, youtubeUrl, createdAt, updatedAt)
SELECT uv.userId, uv.normalized_name, uv.exercise_name, uv.youtube_video_id, uv.youtube_url, uv.createdAt, uv.updatedAt
FROM user_exercise_videos uv
WHERE EXISTS (SELECT 1 FROM v2_accounts a WHERE a.id = uv.userId);
