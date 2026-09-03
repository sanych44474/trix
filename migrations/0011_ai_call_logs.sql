-- Per-attempt AI call telemetry (latency + fallback position). Complements ai_usage,
-- which only records ok/provider/kind. tokens is nullable: providers return bare text
-- today, so token counts are populated only once provider return types expose usage.
CREATE TABLE IF NOT EXISTS ai_call_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  userId      INTEGER,
  provider    TEXT    NOT NULL,
  kind        TEXT    NOT NULL,
  latency_ms  INTEGER NOT NULL,
  tokens      INTEGER,
  was_fallback INTEGER NOT NULL DEFAULT 0,
  ts          TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ai_call_logs_ts ON ai_call_logs(ts);
