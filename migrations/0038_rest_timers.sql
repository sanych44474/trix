-- 0038: rest timers — one pending "rest over" nudge per user, set from the guided workout
-- logger and delivered by the every-minute cron sweep (minute-grained, approximate).
-- Apply manually: npx wrangler d1 execute trix --remote --file migrations/0038_rest_timers.sql

CREATE TABLE IF NOT EXISTS rest_timers (
  userId INTEGER PRIMARY KEY,
  chatId INTEGER NOT NULL,
  dueAt TEXT NOT NULL,
  lang TEXT NOT NULL DEFAULT 'en'
);

CREATE INDEX IF NOT EXISTS idx_rest_timers_due ON rest_timers(dueAt);
