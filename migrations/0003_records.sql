-- Bot Records: opt-in global leaderboards + achievement badges.

ALTER TABLE users ADD COLUMN competeOptIn INTEGER NOT NULL DEFAULT 0; -- 0/1 join leaderboards
ALTER TABLE users ADD COLUMN alias TEXT;                              -- board display name; NULL = profile name, '' = anonymous
CREATE INDEX IF NOT EXISTS idx_users_compete ON users(competeOptIn);

CREATE TABLE IF NOT EXISTS achievements (
  userId   INTEGER NOT NULL,
  code     TEXT    NOT NULL,
  earnedAt TEXT    NOT NULL,
  PRIMARY KEY (userId, code)
);
CREATE INDEX IF NOT EXISTS idx_ach_user ON achievements(userId);
