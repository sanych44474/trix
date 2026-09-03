-- Subjective daily wellbeing check-in (/checkin). One row per user per local date.
-- energy / sleep / stress on a 1-5 scale.
CREATE TABLE IF NOT EXISTS daily_checkins (
  userId    INTEGER NOT NULL,
  date      TEXT    NOT NULL,        -- YYYY-MM-DD local
  energy    INTEGER NOT NULL,
  sleep     INTEGER NOT NULL,
  stress    INTEGER NOT NULL,
  createdAt TEXT    NOT NULL,
  PRIMARY KEY (userId, date)
);
CREATE INDEX IF NOT EXISTS idx_daily_checkins_user_date ON daily_checkins(userId, date);
