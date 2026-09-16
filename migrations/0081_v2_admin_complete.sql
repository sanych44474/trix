-- Domain 9 (owner/admin reporting, AI/error/analytics logging, notification outbox,
-- daily-metrics rollup) completeness pass. 0069/0070 gave this domain a PARTIAL shadow --
-- v2_audit_events/v2_ai_calls/v2_error_events/v2_analytics_events/v2_notifications/
-- v2_notification_attempts/v2_daily_metrics/v2_idempotency exist, but several src/db/repos/
-- admin.ts exports have NO v2 table at all yet (feedback inbox, the separate ai_usage
-- telemetry stream, plan-source logs, rest timers, owner config/alert state, the Telegram
-- update-id dedup set, key-value settings/schedule-lock, and the AI response cache), and
-- v2_analytics_events has a real correctness gap in what 0070 already created (see below). This
-- migration closes both so src/adapters/d1/v2Admin.ts (+ v2Notifications.ts/v2DailyMetrics.ts/
-- v2Idempotency.ts) can be a full, faithful v2-native replacement, not just a parity shadow.
-- (v2_notifications' own idempotency-key scoping bug -- found against real production data,
-- where it silently dropped a second user's identical reminder text -- is fixed directly in
-- 0069/0070 now, not rebuilt here.)

-- ---------- v2_analytics_events: bumpEvent's upsert needs a conflict target ----------
-- Legacy event_counts is genuinely one row per (userId, event, day), incremented in place
-- (`ON CONFLICT(userId, event, day) DO UPDATE SET n = n + 1`) -- eventStatsSince/dailyActiveUsers/
-- recentEventsForUser all assume that shape (recentEventsForUser in particular returns each
-- (event, day) pair ONCE with its cumulative count, not once per bump). 0070 created
-- v2_analytics_events as a plain autoincrement log with no unique constraint at all, which would
-- silently change bumpEvent's semantics from "increment a counter" to "append a row per call" the
-- moment it got a real writer. Same backfill source (event_counts) already guarantees at most one
-- row per (accountId, event, date) today, so adding the constraint now is safe.
CREATE UNIQUE INDEX IF NOT EXISTS idx_v2_analytics_events_unique ON v2_analytics_events(accountId, event, date);

-- ---------- new tables: admin.ts-owned concerns with no v2 home yet ----------

-- Feedback inbox (mirrors `feedback`, migrations/0001). Deleted wholesale on /deleteme, same as
-- legacy -- see admin.ts's deleteUserData.
CREATE TABLE IF NOT EXISTS v2_feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  accountId INTEGER NOT NULL REFERENCES v2_accounts(id) ON DELETE CASCADE,
  username TEXT,
  text TEXT NOT NULL,
  date TEXT NOT NULL,
  createdAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_v2_feedback_created ON v2_feedback(createdAt);

-- Per-attempt AI *usage* telemetry (mirrors `ai_usage`, migrations/0001) -- deliberately separate
-- from v2_ai_calls/ai_call_logs: different grain (model + date + ok, no latency/tokens/fallback)
-- and a different live writer (src/ai/index.ts's aiUsageStmt, called once per provider attempt
-- alongside, not instead of, aiCallStmt). accountId nullable + ON DELETE SET NULL, matching
-- v2_ai_calls/v2_error_events' convention -- legacy ai_usage.userId is nullable too.
CREATE TABLE IF NOT EXISTS v2_ai_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  accountId INTEGER REFERENCES v2_accounts(id) ON DELETE SET NULL,
  provider TEXT NOT NULL,
  kind TEXT NOT NULL,
  model TEXT NOT NULL,
  ok INTEGER NOT NULL,
  date TEXT NOT NULL,
  createdAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_v2_ai_usage_created ON v2_ai_usage(createdAt);

-- Plan/meal source telemetry (mirrors `plan_source_logs`, migrations/0018) -- confirms the plan
-- bank/template path is actually offloading the AI chain. accountId nullable, matching legacy
-- (userId has no NOT NULL either).
CREATE TABLE IF NOT EXISTS v2_plan_source_logs (
  accountId INTEGER REFERENCES v2_accounts(id) ON DELETE SET NULL,
  kind TEXT NOT NULL,
  source TEXT NOT NULL,
  createdAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_v2_plan_source_logs_created ON v2_plan_source_logs(createdAt);

-- One pending "rest over" nudge per user (mirrors `rest_timers`, migrations/0038). Legacy PK is
-- NOT NULL userId -- always tied to a real account, so CASCADE (not SET NULL) here.
CREATE TABLE IF NOT EXISTS v2_rest_timers (
  accountId INTEGER PRIMARY KEY REFERENCES v2_accounts(id) ON DELETE CASCADE,
  chatId INTEGER NOT NULL,
  dueAt TEXT NOT NULL,
  lang TEXT NOT NULL DEFAULT 'en'
);
CREATE INDEX IF NOT EXISTS idx_v2_rest_timers_due ON v2_rest_timers(dueAt);

-- Owner config singleton + proactive-alert dedup state (mirrors `config`, migrations/0001+0024).
-- Not user-identifying -- no accountId, not part of deleteUserData.
CREATE TABLE IF NOT EXISTS v2_config (
  id TEXT PRIMARY KEY,
  ownerChatId INTEGER,
  alertState TEXT
);

-- Telegram update-id dedup set (mirrors `seen_updates`, migrations/0001). `id` here is a
-- Telegram update_id, not an account id -- global housekeeping state, not user data.
CREATE TABLE IF NOT EXISTS v2_seen_updates (
  id INTEGER PRIMARY KEY,
  createdAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_v2_seen_updates_created ON v2_seen_updates(createdAt);

-- Key-value settings for one-time flags / the scheduler DO cutover switches / the cron mutex
-- (mirrors `settings`, migrations/0005). Global, not user data.
CREATE TABLE IF NOT EXISTS v2_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- AI response cache, keyed by a hash of kind+system+normalized prompt (mirrors `ai_cache`,
-- migrations/0043). User-independent by design -- no accountId.
CREATE TABLE IF NOT EXISTS v2_ai_cache (
  key TEXT PRIMARY KEY,
  response TEXT NOT NULL,
  expiresAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_v2_ai_cache_expires ON v2_ai_cache(expiresAt);

-- ---------- Idempotent backfill from legacy, same pattern as every prior domain migration ----------
INSERT OR IGNORE INTO v2_feedback (id, accountId, username, text, date, createdAt)
SELECT id, userId, username, text, date, createdAt FROM feedback;

-- accountId nulled out for rows whose legacy userId has no matching `users` row -- same real,
-- confirmed-against-production gap as v2_ai_calls/v2_error_events/v2_analytics_events in 0070
-- (see that file's comment); both columns here are nullable (ON DELETE SET NULL) for exactly
-- this reason.
INSERT OR IGNORE INTO v2_ai_usage (id, accountId, provider, kind, model, ok, date, createdAt)
SELECT id, CASE WHEN EXISTS (SELECT 1 FROM users u WHERE u.id = ai_usage.userId) THEN userId END,
  provider, kind, model, ok, date, ts FROM ai_usage;

INSERT OR IGNORE INTO v2_plan_source_logs (accountId, kind, source, createdAt)
SELECT CASE WHEN EXISTS (SELECT 1 FROM users u WHERE u.id = plan_source_logs.userId) THEN userId END,
  kind, source, ts FROM plan_source_logs;

INSERT OR IGNORE INTO v2_rest_timers (accountId, chatId, dueAt, lang)
SELECT userId, chatId, dueAt, lang FROM rest_timers;

INSERT OR IGNORE INTO v2_config (id, ownerChatId, alertState)
SELECT id, ownerChatId, alertState FROM config;

INSERT OR IGNORE INTO v2_seen_updates (id, createdAt)
SELECT id, createdAt FROM seen_updates;

INSERT OR IGNORE INTO v2_settings (key, value)
SELECT key, value FROM settings;

INSERT OR IGNORE INTO v2_ai_cache (key, response, expiresAt)
SELECT key, response, expiresAt FROM ai_cache;
