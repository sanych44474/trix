-- Daily NEAT step logging. One row per user per local date.
CREATE TABLE IF NOT EXISTS step_logs (
  userId INTEGER NOT NULL,
  date TEXT NOT NULL,        -- YYYY-MM-DD local
  steps INTEGER NOT NULL,
  createdAt TEXT NOT NULL,
  PRIMARY KEY (userId, date)
);
CREATE INDEX IF NOT EXISTS idx_step_logs_user_date ON step_logs(userId, date);
