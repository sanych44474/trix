-- Cache of one short YouTube technique video per exercise (keyed by the normalized lowercased
-- English name). Cache-first like food_cache: the YouTube Data API is hit only on a miss, then
-- the result is stored forever. A row with youtube_url IS NULL is a negative cache ("searched,
-- found nothing") so a dead exercise is not re-searched on every render. A locked=1 row is a
-- manual override set by a trainer/owner and is never overwritten by refresh/backfill.
CREATE TABLE IF NOT EXISTS exercise_videos (
  normalized_name  TEXT PRIMARY KEY,            -- lowercased canonical English name
  exercise_name    TEXT NOT NULL,               -- display/source name as searched
  youtube_video_id TEXT,                        -- NULL = negative cache (searched, no match)
  youtube_url      TEXT,                         -- https://www.youtube.com/shorts/<id>
  youtube_title    TEXT,
  channel_name     TEXT,
  thumbnail_url    TEXT,
  locked           INTEGER NOT NULL DEFAULT 0,  -- 1 = manually set by trainer/owner; never auto-overwritten
  set_by           INTEGER,                     -- chatId of the trainer/owner who locked it (audit)
  createdAt        TEXT NOT NULL,
  updatedAt        TEXT NOT NULL
);
