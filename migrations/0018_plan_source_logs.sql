-- Lightweight telemetry to confirm the plan bank actually offloaded Gemini: one row per plan /
-- meal-plan generation, tagged with whether it was served deterministically from the bank/template
-- (zero AI) or fell back to / was explicitly requested via the AI chain. Query examples:
--   SELECT kind, source, COUNT(*) FROM plan_source_logs GROUP BY kind, source;
--   SELECT source, COUNT(*) FROM plan_source_logs WHERE ts >= '<iso>' AND kind='workout' GROUP BY source;
CREATE TABLE IF NOT EXISTS plan_source_logs (
  userId INTEGER,
  kind   TEXT NOT NULL,   -- 'workout' | 'meal'
  source TEXT NOT NULL,   -- 'bank' | 'template' | 'ai'
  ts     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_plan_source_logs_ts ON plan_source_logs(ts);
