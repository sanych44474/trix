-- AI failure log for the owner report. One row per fully-failed AI call (all providers
-- exhausted), tagged by task kind (interview/plan/coach/…) and error type (json/rate_limit/ai).
CREATE TABLE IF NOT EXISTS error_logs (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  userId    INTEGER,
  kind      TEXT    NOT NULL,
  errorType TEXT    NOT NULL,
  message   TEXT,
  ts        TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_error_logs_ts ON error_logs(ts);
