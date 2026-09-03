-- Per-user technique-video overrides. A regular user can set their own video link for an exercise
-- WITHOUT changing the shared one in exercise_videos (which trainers/owner manage globally).
-- Render prefers a user's override over the global video.
CREATE TABLE IF NOT EXISTS user_exercise_videos (
  userId           INTEGER NOT NULL,
  normalized_name  TEXT    NOT NULL,
  exercise_name    TEXT    NOT NULL,
  youtube_video_id TEXT    NOT NULL,
  youtube_url      TEXT    NOT NULL,
  createdAt        TEXT    NOT NULL,
  updatedAt        TEXT    NOT NULL,
  PRIMARY KEY (userId, normalized_name)
);
