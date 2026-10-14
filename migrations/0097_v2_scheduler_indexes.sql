-- Indexes for the hourly scheduler's all-users reads, which had no index to use:
--   allWorkoutLogsSince: v2_workout_sessions WHERE date >= ? (the existing index leads with accountId)
--   listActivePlans:     v2_plans WHERE active = 1 ORDER BY id (partial: only active plans are indexed)
--   countNotificationsSince / pruneNotificationOutbox: v2_notifications by createdAt
CREATE INDEX IF NOT EXISTS idx_v2_workout_sessions_date ON v2_workout_sessions(date);
CREATE INDEX IF NOT EXISTS idx_v2_plans_active ON v2_plans(id) WHERE active = 1;
CREATE INDEX IF NOT EXISTS idx_v2_notifications_created ON v2_notifications(createdAt);
