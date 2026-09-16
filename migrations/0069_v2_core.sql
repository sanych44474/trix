-- Versioned storage seam for the staged v2 migration.
-- Legacy tables remain authoritative until the backfill + parity checks complete.
CREATE TABLE IF NOT EXISTS v2_accounts (
  id INTEGER PRIMARY KEY,
  legacyUserId INTEGER NOT NULL UNIQUE,
  chatId INTEGER NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'solo',
  status TEXT NOT NULL DEFAULT 'active',
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS v2_profiles (
  accountId INTEGER PRIMARY KEY REFERENCES v2_accounts(id) ON DELETE CASCADE,
  lang TEXT NOT NULL DEFAULT 'uk',
  name TEXT,
  timezone TEXT,
  sex TEXT,
  age INTEGER,
  heightCm REAL,
  weightKg REAL,
  goal TEXT,
  goalWeight REAL,
  level TEXT,
  equipment TEXT,
  limitations TEXT,
  dietPrefs TEXT,
  trainingWeekdays TEXT NOT NULL DEFAULT '[]',
  shareWithTrainer TEXT NOT NULL DEFAULT '{}',
  updatedAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS v2_plans (
  id INTEGER PRIMARY KEY,
  accountId INTEGER NOT NULL REFERENCES v2_accounts(id) ON DELETE CASCADE,
  version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active',
  source TEXT NOT NULL DEFAULT 'unknown',
  nutrition TEXT,
  mesocycle TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  UNIQUE(accountId, version)
);

CREATE TABLE IF NOT EXISTS v2_plan_days (
  id INTEGER PRIMARY KEY,
  planId INTEGER NOT NULL REFERENCES v2_plans(id) ON DELETE CASCADE,
  weekday INTEGER NOT NULL,
  name TEXT NOT NULL,
  muscleGroup TEXT NOT NULL,
  warmup TEXT,
  UNIQUE(planId, weekday)
);

CREATE TABLE IF NOT EXISTS v2_plan_exercises (
  id INTEGER PRIMARY KEY,
  dayId INTEGER NOT NULL REFERENCES v2_plan_days(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  catalogId TEXT,
  name TEXT NOT NULL,
  sets TEXT NOT NULL,
  startWeight TEXT NOT NULL,
  technique TEXT,
  metric TEXT NOT NULL DEFAULT 'reps',
  supersetGroup TEXT,
  weightMode TEXT,
  UNIQUE(dayId, position)
);

CREATE TABLE IF NOT EXISTS v2_workout_sessions (
  id INTEGER PRIMARY KEY,
  accountId INTEGER NOT NULL REFERENCES v2_accounts(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  weekday INTEGER,
  completed INTEGER NOT NULL DEFAULT 0,
  rawText TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  UNIQUE(accountId, date)
);

CREATE TABLE IF NOT EXISTS v2_workout_exercises (
  id INTEGER PRIMARY KEY,
  sessionId INTEGER NOT NULL REFERENCES v2_workout_sessions(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  name TEXT NOT NULL,
  metric TEXT NOT NULL DEFAULT 'reps',
  skipped INTEGER NOT NULL DEFAULT 0,
  rpe REAL,
  UNIQUE(sessionId, position)
);

CREATE TABLE IF NOT EXISTS v2_workout_sets (
  id INTEGER PRIMARY KEY,
  exerciseId INTEGER NOT NULL REFERENCES v2_workout_exercises(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  weight REAL NOT NULL DEFAULT 0,
  reps INTEGER NOT NULL DEFAULT 0,
  seconds INTEGER,
  meters INTEGER,
  UNIQUE(exerciseId, position)
);

CREATE TABLE IF NOT EXISTS v2_nutrition_days (
  accountId INTEGER NOT NULL REFERENCES v2_accounts(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  target TEXT,
  updatedAt TEXT NOT NULL,
  PRIMARY KEY(accountId, date)
);

CREATE TABLE IF NOT EXISTS v2_nutrition_entries (
  id INTEGER PRIMARY KEY,
  accountId INTEGER NOT NULL REFERENCES v2_accounts(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  position INTEGER NOT NULL,
  description TEXT NOT NULL,
  grams REAL,
  kcal REAL NOT NULL DEFAULT 0,
  protein REAL NOT NULL DEFAULT 0,
  fats REAL NOT NULL DEFAULT 0,
  carbs REAL NOT NULL DEFAULT 0,
  source TEXT,
  UNIQUE(accountId, date, position)
);

CREATE TABLE IF NOT EXISTS v2_measurements (
  id INTEGER PRIMARY KEY,
  accountId INTEGER NOT NULL REFERENCES v2_accounts(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  weight REAL,
  measurements TEXT NOT NULL DEFAULT '{}',
  UNIQUE(accountId, date)
);

CREATE TABLE IF NOT EXISTS v2_wellbeing (
  accountId INTEGER NOT NULL REFERENCES v2_accounts(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  energy INTEGER,
  sleep INTEGER,
  stress INTEGER,
  createdAt TEXT NOT NULL,
  PRIMARY KEY(accountId, date)
);

CREATE TABLE IF NOT EXISTS v2_trainer_relationships (
  clientId INTEGER NOT NULL REFERENCES v2_accounts(id) ON DELETE CASCADE,
  trainerId INTEGER NOT NULL REFERENCES v2_accounts(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active',
  consent TEXT NOT NULL DEFAULT '{}',
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  PRIMARY KEY(clientId, trainerId)
);

-- idempotencyKey is scoped per-account (composite index below), not globally unique: legacy
-- notification_outbox's actual uniqueness is the composite (userId, idempotencyKey) index
-- (migrations/0067) -- scheduler.ts's enqueueAndDeliver builds the key as
-- `${date}:${text.slice(0,200)}`, WITHOUT the userId baked in, relying entirely on that index to
-- scope it per user. A single global UNIQUE would collide (and silently drop) a second user's
-- identical templated reminder text on the same day -- confirmed against real production data,
-- which had exactly this collision across several users on the same day.
CREATE TABLE IF NOT EXISTS v2_notifications (
  id INTEGER PRIMARY KEY,
  accountId INTEGER NOT NULL REFERENCES v2_accounts(id) ON DELETE CASCADE,
  chatId INTEGER NOT NULL DEFAULT 0,
  kind TEXT NOT NULL,
  idempotencyKey TEXT NOT NULL,
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  nextAttemptAt TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  lastError TEXT,
  createdAt TEXT NOT NULL,
  sentAt TEXT
);

CREATE TABLE IF NOT EXISTS v2_audit_events (
  id INTEGER PRIMARY KEY,
  actorId INTEGER,
  targetId INTEGER,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  createdAt TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_v2_workout_account_date ON v2_workout_sessions(accountId, date);
CREATE INDEX IF NOT EXISTS idx_v2_nutrition_account_date ON v2_nutrition_entries(accountId, date);
CREATE UNIQUE INDEX IF NOT EXISTS idx_v2_notifications_idem ON v2_notifications(accountId, idempotencyKey);
CREATE INDEX IF NOT EXISTS idx_v2_notifications_due ON v2_notifications(status, nextAttemptAt);
CREATE INDEX IF NOT EXISTS idx_v2_audit_target_time ON v2_audit_events(targetId, createdAt);

-- Deterministic, idempotent first backfill. Nested legacy JSON is expanded only when valid;
-- malformed rows remain in legacy storage for the repair report instead of aborting migration.
INSERT OR IGNORE INTO v2_accounts (id, legacyUserId, chatId, role, status, createdAt, updatedAt)
SELECT id, id, chatId, role, CASE WHEN botBlocked = 1 OR blocked = 1 THEN 'blocked' ELSE 'active' END, createdAt, updatedAt
FROM users;

INSERT OR IGNORE INTO v2_profiles (accountId, lang, name, timezone, sex, age, heightCm, weightKg, goal,
  goalWeight, level, equipment, limitations, dietPrefs, trainingWeekdays, shareWithTrainer, updatedAt)
SELECT id, lang,
  json_extract(profile, '$.name'), json_extract(profile, '$.timezone'), json_extract(profile, '$.sex'),
  json_extract(profile, '$.age'), json_extract(profile, '$.heightCm'), json_extract(profile, '$.weightKg'),
  json_extract(profile, '$.goal'), json_extract(profile, '$.goalWeight'), json_extract(profile, '$.level'),
  json_extract(profile, '$.equipment'), json_extract(profile, '$.limitations'), json_extract(profile, '$.dietPrefs'),
  COALESCE(json_extract(profile, '$.trainingWeekdays'), '[]'),
  COALESCE(json_extract(profile, '$.shareWithTrainer'), '{}'), updatedAt
FROM users
WHERE json_valid(profile);

-- version is a real per-account generation counter (chronological by generatedAt, ties broken by
-- id), not a hardcoded 1 -- v2_plans has UNIQUE(accountId, version), and any account with more
-- than one historical plan row (a regenerate) would otherwise collide on version=1 and have every
-- plan after its first silently dropped by OR IGNORE, which then orphans v2_plan_days/
-- v2_plan_exercises rows below that reference the dropped plan's id (FOREIGN KEY constraint
-- failed). Confirmed against real production data, which had this exact case; the local dev D1
-- has zero plan rows and could never have caught it. Same "real counter, not a placeholder"
-- reasoning as v2Plans.ts's own runtime NEXT_VERSION_SUBQUERY (migrations/0078).
INSERT OR IGNORE INTO v2_plans (id, accountId, version, status, source, nutrition, mesocycle, createdAt, updatedAt)
SELECT id, userId, ROW_NUMBER() OVER (PARTITION BY userId ORDER BY generatedAt, id),
  COALESCE(status, CASE WHEN active = 1 THEN 'active' ELSE 'draft' END),
  CASE WHEN authoredBy IS NULL THEN 'ai' ELSE 'trainer' END, nutrition, NULL, generatedAt, generatedAt
FROM plans;

INSERT OR IGNORE INTO v2_plan_days (id, planId, weekday, name, muscleGroup, warmup)
SELECT p.id * 10 + CAST(json_extract(d.value, '$.weekday') AS INTEGER), p.id,
  CAST(json_extract(d.value, '$.weekday') AS INTEGER),
  COALESCE(json_extract(d.value, '$.muscleGroup'), 'Training day'),
  COALESCE(json_extract(d.value, '$.muscleGroup'), 'Training'),
  json_extract(d.value, '$.warmUp')
FROM plans p, json_each(p.split) d
WHERE json_valid(p.split);

INSERT OR IGNORE INTO v2_plan_exercises (id, dayId, position, catalogId, name, sets, startWeight, technique, metric, supersetGroup, weightMode)
SELECT (p.id * 10 + CAST(json_extract(d.value, '$.weekday') AS INTEGER)) * 100 + CAST(e.key AS INTEGER) + 1,
  p.id * 10 + CAST(json_extract(d.value, '$.weekday') AS INTEGER), CAST(e.key AS INTEGER),
  json_extract(e.value, '$.exerciseId'), json_extract(e.value, '$.name'), json_extract(e.value, '$.sets'),
  json_extract(e.value, '$.startWeight'), json_extract(e.value, '$.technique'),
  COALESCE(json_extract(e.value, '$.metric'), 'reps'), json_extract(e.value, '$.supersetGroup'), json_extract(e.value, '$.weightMode')
FROM plans p, json_each(p.split) d, json_each(json_extract(d.value, '$.exercises')) e
WHERE json_valid(p.split);

INSERT OR IGNORE INTO v2_nutrition_days (accountId, date, target, updatedAt)
SELECT userId, date, NULL, updatedAt FROM nutrition_logs;

INSERT OR IGNORE INTO v2_nutrition_entries (accountId, date, position, description, grams, kcal, protein, fats, carbs, source)
SELECT n.userId, n.date, CAST(m.key AS INTEGER), json_extract(m.value, '$.desc'), json_extract(m.value, '$.grams'),
  COALESCE(json_extract(m.value, '$.kcal'), 0), COALESCE(json_extract(m.value, '$.protein'), 0),
  COALESCE(json_extract(m.value, '$.fats'), 0), COALESCE(json_extract(m.value, '$.carbs'), 0), json_extract(m.value, '$.query')
FROM nutrition_logs n, json_each(n.meals) m
WHERE json_valid(n.meals);

INSERT OR IGNORE INTO v2_workout_sessions (accountId, date, weekday, completed, rawText, createdAt, updatedAt)
SELECT userId, date, weekday, completed, notes, createdAt, createdAt FROM workout_logs;

INSERT OR IGNORE INTO v2_workout_exercises (id, sessionId, position, name, metric, skipped, rpe)
SELECT s.id * 100 + CAST(e.key AS INTEGER) + 1, s.id, CAST(e.key AS INTEGER), json_extract(e.value, '$.name'),
  COALESCE(json_extract(e.value, '$.metric'), 'reps'),
  COALESCE(json_extract(e.value, '$.skipped'), 0), json_extract(e.value, '$.rpe')
FROM v2_workout_sessions s JOIN workout_logs w ON w.userId = s.accountId AND w.date = s.date,
  json_each(w.exercises) e
WHERE json_valid(w.exercises);

INSERT OR IGNORE INTO v2_workout_sets (id, exerciseId, position, weight, reps, seconds, meters)
SELECT e.id * 100 + CAST(setRow.key AS INTEGER) + 1, e.id, CAST(setRow.key AS INTEGER),
  COALESCE(json_extract(setRow.value, '$.weight'), 0), COALESCE(json_extract(setRow.value, '$.reps'), 0),
  json_extract(setRow.value, '$.seconds'), json_extract(setRow.value, '$.meters')
FROM v2_workout_exercises e
JOIN v2_workout_sessions s ON s.id = e.sessionId
JOIN workout_logs w ON w.userId = s.accountId AND w.date = s.date
JOIN json_each(w.exercises) raw ON CAST(raw.key AS INTEGER) = e.position
JOIN json_each(json_extract(raw.value, '$.setsDone')) setRow
WHERE json_valid(w.exercises);

INSERT OR IGNORE INTO v2_measurements (accountId, date, weight, measurements)
SELECT userId, date, weight, COALESCE(measurements, '{}') FROM body_logs;

INSERT OR IGNORE INTO v2_trainer_relationships (clientId, trainerId, status, consent, createdAt, updatedAt)
SELECT id, trainerId, 'active', COALESCE(json_extract(profile, '$.shareWithTrainer'), '{}'), createdAt, updatedAt
FROM users WHERE trainerId IS NOT NULL;

INSERT OR IGNORE INTO v2_notifications (accountId, chatId, kind, idempotencyKey, payload, status, nextAttemptAt, attempts, lastError, createdAt, sentAt)
SELECT userId, chatId, kind, idempotencyKey, payload, status, nextAttemptAt, attempts, lastError, createdAt, sentAt
FROM notification_outbox;

INSERT OR IGNORE INTO v2_audit_events (id, actorId, targetId, kind, payload, createdAt)
SELECT id, actorId, targetId, action, COALESCE(detail, '{}'), ts FROM admin_audit;
