-- Reliable per-user activity signal (set ONLY on a real user action, never by the cron) and
-- lightweight daily usage counters (plan/screen/video/navigation opens) for engagement analytics.

ALTER TABLE users ADD COLUMN lastSeenAt TEXT;   -- ISO of the user's last genuine interaction

CREATE TABLE IF NOT EXISTS event_counts (
  userId INTEGER NOT NULL,
  event  TEXT    NOT NULL,          -- normalized event key, e.g. "menu:plan", "vid:pick", "log:finish"
  day    TEXT    NOT NULL,          -- YYYY-MM-DD (user local day)
  n      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (userId, event, day)
);
CREATE INDEX IF NOT EXISTS idx_event_counts_day ON event_counts(day, event);
