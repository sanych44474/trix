-- Performance indexes for query patterns not covered by existing PKs/indexes.
--
-- Already covered (no index needed):
--   workout_logs / nutrition_logs / body_logs (userId, date)  -> composite PRIMARY KEY
--   step_logs (userId, date)                                  -> idx_step_logs_user_date
--   plans (userId, active)                                    -> idx_plans_user_active

-- Draft-plan lookups: WHERE userId = ? AND status = 'draft' (saveDraftPlan / latestDraft / discardDraft).
-- The existing idx_plans_user_active(userId, active) does not cover the status column.
CREATE INDEX IF NOT EXISTS idx_plans_user_status ON plans(userId, status);

-- Engagement counts filter by date alone (no userId), so the composite PK's leading userId
-- column can't be used: WHERE date >= ? [AND completed = 1].
CREATE INDEX IF NOT EXISTS idx_workout_logs_date ON workout_logs(date);
CREATE INDEX IF NOT EXISTS idx_nutrition_logs_date ON nutrition_logs(date);
