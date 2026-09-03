-- User-joined challenges (consistency goals over a fixed window). Progress is computed live
-- from workout/nutrition/step/water logs; only the enrollment + completion are stored here.
CREATE TABLE IF NOT EXISTS challenges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER NOT NULL,
  code TEXT NOT NULL,         -- template code (domain/challenges.ts)
  startDate TEXT NOT NULL,    -- YYYY-MM-DD local, inclusive
  endDate TEXT NOT NULL,      -- YYYY-MM-DD local, inclusive
  joinedAt TEXT NOT NULL,
  completedAt TEXT            -- ISO timestamp when the target was reached (NULL = in progress)
);
CREATE INDEX IF NOT EXISTS idx_challenges_user ON challenges(userId, endDate);
