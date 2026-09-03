-- Progress photos: Telegram file_ids of body-progress pictures, captured when a client answers
-- a trainer's photo request or via the self-serve "📸 Progress photo" flow. Served to the Mini
-- App through the authorized /api/photo proxy (file bytes fetched with the bot token server-side).
CREATE TABLE IF NOT EXISTS progress_photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER NOT NULL,
  fileId TEXT NOT NULL,
  takenAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_progress_photos_user ON progress_photos (userId, takenAt DESC);
