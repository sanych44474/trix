-- Daily water intake. One row per user per local date; ml is the running daily total.
CREATE TABLE IF NOT EXISTS water_logs (
  userId INTEGER NOT NULL,
  date TEXT NOT NULL,        -- YYYY-MM-DD local
  ml INTEGER NOT NULL,       -- total millilitres logged that day
  createdAt TEXT NOT NULL,
  PRIMARY KEY (userId, date)
);
CREATE INDEX IF NOT EXISTS idx_water_logs_user_date ON water_logs(userId, date);
