-- v2 long-tail model. Core records are in 0069; this migration gives the remaining product
-- surfaces explicit seams without deleting or rewriting their legacy source rows.

CREATE TABLE IF NOT EXISTS v2_preferences (
  accountId INTEGER PRIMARY KEY REFERENCES v2_accounts(id) ON DELETE CASCADE,
  lang TEXT NOT NULL,
  timezone TEXT,
  waterGoalMl INTEGER,
  stepsGoal INTEGER,
  competeOptIn INTEGER NOT NULL DEFAULT 0,
  alias TEXT,
  reminders TEXT NOT NULL DEFAULT '{}',
  updatedAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS v2_onboarding (
  accountId INTEGER PRIMARY KEY REFERENCES v2_accounts(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  step TEXT,
  answers TEXT NOT NULL DEFAULT '{}',
  completedAt TEXT,
  updatedAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS v2_plan_changes (
  id INTEGER PRIMARY KEY,
  accountId INTEGER NOT NULL REFERENCES v2_accounts(id) ON DELETE CASCADE,
  actorId INTEGER,
  source TEXT NOT NULL,
  summary TEXT NOT NULL,
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS v2_workout_cardio_metrics (
  id INTEGER PRIMARY KEY,
  accountId INTEGER NOT NULL REFERENCES v2_accounts(id) ON DELETE CASCADE,
  sessionId INTEGER REFERENCES v2_workout_sessions(id) ON DELETE CASCADE,
  exerciseId INTEGER REFERENCES v2_workout_exercises(id) ON DELETE CASCADE,
  setPosition INTEGER NOT NULL,
  seconds INTEGER,
  meters REAL,
  avgHeartRate INTEGER,
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS v2_food_references (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  brand TEXT,
  per100g TEXT NOT NULL,
  source TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS v2_nutrition_corrections (
  accountId INTEGER NOT NULL REFERENCES v2_accounts(id) ON DELETE CASCADE,
  query TEXT NOT NULL,
  per100g TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  PRIMARY KEY (accountId, query)
);

CREATE TABLE IF NOT EXISTS v2_activity_days (
  accountId INTEGER NOT NULL REFERENCES v2_accounts(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  waterMl INTEGER,
  steps INTEGER,
  createdAt TEXT,
  updatedAt TEXT NOT NULL,
  PRIMARY KEY (accountId, date)
);

CREATE TABLE IF NOT EXISTS v2_injuries (
  id INTEGER PRIMARY KEY,
  accountId INTEGER NOT NULL REFERENCES v2_accounts(id) ON DELETE CASCADE,
  area TEXT NOT NULL,
  severity TEXT NOT NULL,
  status TEXT NOT NULL,
  reportedAt TEXT NOT NULL,
  checkAfter TEXT,
  swaps TEXT NOT NULL DEFAULT '[]',
  resolvedAt TEXT
);

CREATE TABLE IF NOT EXISTS v2_progress_photos (
  id INTEGER PRIMARY KEY,
  accountId INTEGER NOT NULL REFERENCES v2_accounts(id) ON DELETE CASCADE,
  objectKey TEXT,
  legacyFileId TEXT,
  takenAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS v2_trainer_requests (
  id INTEGER PRIMARY KEY,
  clientId INTEGER NOT NULL REFERENCES v2_accounts(id) ON DELETE CASCADE,
  trainerId INTEGER NOT NULL REFERENCES v2_accounts(id) ON DELETE CASCADE,
  note TEXT,
  status TEXT NOT NULL,
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS v2_trainer_questions (
  id INTEGER PRIMARY KEY,
  clientId INTEGER NOT NULL REFERENCES v2_accounts(id) ON DELETE CASCADE,
  trainerId INTEGER NOT NULL REFERENCES v2_accounts(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  aiDraft TEXT,
  status TEXT NOT NULL,
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS v2_messages (
  id INTEGER PRIMARY KEY,
  fromAccountId INTEGER NOT NULL REFERENCES v2_accounts(id) ON DELETE CASCADE,
  toAccountId INTEGER NOT NULL REFERENCES v2_accounts(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS v2_trainer_templates (
  id INTEGER PRIMARY KEY,
  trainerId INTEGER NOT NULL REFERENCES v2_accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  plan TEXT NOT NULL,
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS v2_achievements (
  accountId INTEGER NOT NULL REFERENCES v2_accounts(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  earnedAt TEXT NOT NULL,
  PRIMARY KEY (accountId, code)
);

CREATE TABLE IF NOT EXISTS v2_challenges (
  id INTEGER PRIMARY KEY,
  accountId INTEGER NOT NULL REFERENCES v2_accounts(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  startDate TEXT NOT NULL,
  endDate TEXT NOT NULL,
  joinedAt TEXT NOT NULL,
  completedAt TEXT
);

CREATE TABLE IF NOT EXISTS v2_leaderboard_entries (
  accountId INTEGER NOT NULL REFERENCES v2_accounts(id) ON DELETE CASCADE,
  board TEXT NOT NULL,
  period TEXT NOT NULL,
  score REAL NOT NULL,
  rank INTEGER,
  updatedAt TEXT NOT NULL,
  PRIMARY KEY (accountId, board, period)
);

CREATE TABLE IF NOT EXISTS v2_buddies (
  accountId INTEGER NOT NULL REFERENCES v2_accounts(id) ON DELETE CASCADE,
  buddyAccountId INTEGER NOT NULL REFERENCES v2_accounts(id) ON DELETE CASCADE,
  createdAt TEXT NOT NULL,
  PRIMARY KEY (accountId, buddyAccountId)
);

CREATE TABLE IF NOT EXISTS v2_squads (
  id INTEGER PRIMARY KEY,
  chatId INTEGER NOT NULL UNIQUE,
  createdByAccountId INTEGER,
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS v2_squad_members (
  squadId INTEGER NOT NULL REFERENCES v2_squads(id) ON DELETE CASCADE,
  accountId INTEGER NOT NULL REFERENCES v2_accounts(id) ON DELETE CASCADE,
  joinedAt TEXT NOT NULL,
  PRIMARY KEY (squadId, accountId)
);

CREATE TABLE IF NOT EXISTS v2_notification_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  notificationId INTEGER NOT NULL REFERENCES v2_notifications(id) ON DELETE CASCADE,
  attempt INTEGER NOT NULL,
  status TEXT NOT NULL,
  error TEXT,
  attemptedAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS v2_idempotency (
  accountId INTEGER NOT NULL REFERENCES v2_accounts(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  status INTEGER NOT NULL,
  response TEXT NOT NULL,
  state TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  PRIMARY KEY (accountId, key)
);

CREATE TABLE IF NOT EXISTS v2_ai_calls (
  id INTEGER PRIMARY KEY,
  accountId INTEGER REFERENCES v2_accounts(id) ON DELETE SET NULL,
  provider TEXT NOT NULL,
  kind TEXT NOT NULL,
  latencyMs INTEGER NOT NULL,
  tokens INTEGER,
  ok INTEGER NOT NULL DEFAULT 1,
  wasFallback INTEGER NOT NULL DEFAULT 0,
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS v2_error_events (
  id INTEGER PRIMARY KEY,
  accountId INTEGER REFERENCES v2_accounts(id) ON DELETE SET NULL,
  kind TEXT NOT NULL,
  errorType TEXT NOT NULL,
  message TEXT,
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS v2_analytics_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  accountId INTEGER REFERENCES v2_accounts(id) ON DELETE CASCADE,
  event TEXT NOT NULL,
  date TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS v2_daily_metrics (
  date TEXT NOT NULL,
  metric TEXT NOT NULL,
  dimensions TEXT NOT NULL DEFAULT '{}',
  value REAL NOT NULL,
  PRIMARY KEY (date, metric, dimensions)
);

CREATE INDEX IF NOT EXISTS idx_v2_activity_days_date ON v2_activity_days(date);
CREATE INDEX IF NOT EXISTS idx_v2_injuries_account_status ON v2_injuries(accountId, status);
CREATE INDEX IF NOT EXISTS idx_v2_requests_trainer_status ON v2_trainer_requests(trainerId, status);
CREATE INDEX IF NOT EXISTS idx_v2_questions_trainer_status ON v2_trainer_questions(trainerId, status);
CREATE INDEX IF NOT EXISTS idx_v2_messages_recipient_time ON v2_messages(toAccountId, createdAt);
CREATE INDEX IF NOT EXISTS idx_v2_ai_calls_created ON v2_ai_calls(createdAt);
CREATE INDEX IF NOT EXISTS idx_v2_errors_created ON v2_error_events(createdAt);

-- Idempotent backfill of the long-tail history. JSON remains payload data at the adapter seam;
-- the entities and ownership edges are normalized so future use cases do not parse legacy blobs.
INSERT OR IGNORE INTO v2_preferences (accountId, lang, timezone, competeOptIn, alias, updatedAt)
SELECT id, lang, json_extract(profile, '$.timezone'), COALESCE(competeOptIn, 0), alias, updatedAt
FROM users;

INSERT OR IGNORE INTO v2_onboarding (accountId, status, step, answers, completedAt, updatedAt)
SELECT id, CASE WHEN onboarded = 1 THEN 'completed' ELSE 'in_progress' END,
       json_extract(session, '$.mode'), profile, CASE WHEN onboarded = 1 THEN onboardedAt ELSE NULL END, updatedAt
FROM users;

INSERT OR IGNORE INTO v2_plan_changes (id, accountId, source, summary, createdAt)
SELECT id, userId, source, summary, createdAt FROM plan_change_log;

INSERT OR IGNORE INTO v2_workout_cardio_metrics (id, accountId, sessionId, exerciseId, setPosition, seconds, meters, createdAt)
SELECT ws.id * 100 + s.position, ws.accountId, ws.id, we.id, s.position, s.seconds, s.meters, ws.updatedAt
FROM v2_workout_sets s
JOIN v2_workout_exercises we ON we.id = s.exerciseId
JOIN v2_workout_sessions ws ON ws.id = we.sessionId
WHERE s.seconds IS NOT NULL OR s.meters IS NOT NULL;

INSERT OR IGNORE INTO v2_nutrition_corrections (accountId, query, per100g, updatedAt)
SELECT userId, query, per100g, ts FROM food_corrections;

INSERT OR IGNORE INTO v2_activity_days (accountId, date, steps, createdAt, updatedAt)
SELECT userId, date, steps, createdAt, createdAt FROM step_logs;
INSERT OR IGNORE INTO v2_activity_days (accountId, date, waterMl, createdAt, updatedAt)
SELECT userId, date, ml, createdAt, createdAt FROM water_logs
WHERE 1 = 1
ON CONFLICT(accountId, date) DO UPDATE SET waterMl = excluded.waterMl, updatedAt = excluded.updatedAt;

INSERT OR IGNORE INTO v2_injuries (id, accountId, area, severity, status, reportedAt, checkAfter, swaps, resolvedAt)
SELECT id, userId, area, severity, status, reportedAt, checkAfter, swaps, resolvedAt FROM injuries;
INSERT OR IGNORE INTO v2_progress_photos (id, accountId, legacyFileId, takenAt)
SELECT id, userId, fileId, takenAt FROM progress_photos;
INSERT OR IGNORE INTO v2_trainer_requests (id, clientId, trainerId, note, status, createdAt)
SELECT id, clientId, trainerId, note, status, createdAt FROM client_requests;
INSERT OR IGNORE INTO v2_trainer_questions (id, clientId, trainerId, text, aiDraft, status, createdAt)
SELECT id, clientId, trainerId, text, aiDraft, status, createdAt FROM client_questions;
INSERT OR IGNORE INTO v2_messages (id, fromAccountId, toAccountId, text, createdAt)
SELECT id, fromId, toId, text, createdAt FROM messages;
INSERT OR IGNORE INTO v2_trainer_templates (id, trainerId, name, plan, createdAt)
SELECT id, trainerId, name, plan, createdAt FROM trainer_templates;
INSERT OR IGNORE INTO v2_achievements (accountId, code, earnedAt)
SELECT userId, code, earnedAt FROM achievements;
INSERT OR IGNORE INTO v2_challenges (id, accountId, code, startDate, endDate, joinedAt, completedAt)
SELECT id, userId, code, startDate, endDate, joinedAt, completedAt FROM challenges;
INSERT OR IGNORE INTO v2_buddies (accountId, buddyAccountId, createdAt)
SELECT id, buddyId, updatedAt FROM users WHERE buddyId IS NOT NULL;
INSERT OR IGNORE INTO v2_squads (id, chatId, createdByAccountId, createdAt)
SELECT chatId, chatId, createdBy, createdAt FROM squads;
INSERT OR IGNORE INTO v2_squad_members (squadId, accountId, joinedAt)
SELECT chatId, userId, joinedAt FROM squad_members;
INSERT OR IGNORE INTO v2_notification_attempts (notificationId, attempt, status, error, attemptedAt)
SELECT id, attempts, status, lastError, COALESCE(sentAt, createdAt) FROM notification_outbox;
INSERT OR IGNORE INTO v2_idempotency (accountId, key, status, response, state, createdAt)
SELECT userId, key, status, response, state, createdAt FROM idempotency_keys;
INSERT OR IGNORE INTO v2_ai_calls (id, accountId, provider, kind, latencyMs, tokens, ok, wasFallback, createdAt)
SELECT id, userId, provider, kind, latency_ms, tokens, 1, was_fallback, ts FROM ai_call_logs;
INSERT OR IGNORE INTO v2_error_events (id, accountId, kind, errorType, message, createdAt)
SELECT id, userId, kind, errorType, message, ts FROM error_logs;
INSERT OR IGNORE INTO v2_analytics_events (accountId, event, date, count)
SELECT userId, event, day, n FROM event_counts;
INSERT OR IGNORE INTO v2_daily_metrics (date, metric, dimensions, value)
SELECT date, metric, dims, value FROM daily_metrics;
