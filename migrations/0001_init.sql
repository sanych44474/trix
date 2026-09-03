-- trix D1 schema. JSON-shaped fields (profile, session, split, exercises, meals,
-- measurements, history, supplements, nutrition) are stored as TEXT (JSON).

CREATE TABLE IF NOT EXISTS users (
  id        INTEGER PRIMARY KEY,
  chatId    INTEGER NOT NULL,
  lang      TEXT    NOT NULL,
  onboarded INTEGER NOT NULL DEFAULT 0,
  profile   TEXT    NOT NULL DEFAULT '{}',
  nutrition TEXT,
  session   TEXT    NOT NULL DEFAULT '{"mode":"idle"}',
  createdAt TEXT    NOT NULL,
  updatedAt TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_users_onboarded ON users(onboarded);
CREATE INDEX IF NOT EXISTS idx_users_updated   ON users(updatedAt);

CREATE TABLE IF NOT EXISTS plans (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  userId      INTEGER NOT NULL,
  active      INTEGER NOT NULL DEFAULT 1,
  split       TEXT    NOT NULL,
  nutrition   TEXT    NOT NULL,
  supplements TEXT    NOT NULL DEFAULT '[]',
  methodology TEXT    NOT NULL DEFAULT '',
  generatedAt TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_plans_user_active ON plans(userId, active);

CREATE TABLE IF NOT EXISTS workout_logs (
  userId    INTEGER NOT NULL,
  date      TEXT    NOT NULL,
  weekday   INTEGER,
  exercises TEXT    NOT NULL DEFAULT '[]',
  completed INTEGER NOT NULL DEFAULT 0,
  notes     TEXT,
  createdAt TEXT    NOT NULL,
  PRIMARY KEY (userId, date)
);

CREATE TABLE IF NOT EXISTS nutrition_logs (
  userId    INTEGER NOT NULL,
  date      TEXT    NOT NULL,
  meals     TEXT    NOT NULL DEFAULT '[]',
  createdAt TEXT    NOT NULL,
  updatedAt TEXT    NOT NULL,
  PRIMARY KEY (userId, date)
);

CREATE TABLE IF NOT EXISTS strength_records (
  userId     INTEGER NOT NULL,
  exercise   TEXT    NOT NULL,
  bestWeight REAL    NOT NULL DEFAULT 0,
  bestReps   INTEGER NOT NULL DEFAULT 0,
  history    TEXT    NOT NULL DEFAULT '[]',
  updatedAt  TEXT    NOT NULL,
  PRIMARY KEY (userId, exercise)
);

CREATE TABLE IF NOT EXISTS body_logs (
  userId       INTEGER NOT NULL,
  date         TEXT    NOT NULL,
  weight       REAL,
  measurements TEXT,
  createdAt    TEXT    NOT NULL,
  PRIMARY KEY (userId, date)
);

CREATE TABLE IF NOT EXISTS feedback (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  userId    INTEGER NOT NULL,
  username  TEXT,
  text      TEXT    NOT NULL,
  date      TEXT    NOT NULL,
  createdAt TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_feedback_created ON feedback(createdAt);

CREATE TABLE IF NOT EXISTS ai_usage (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  userId   INTEGER,
  provider TEXT    NOT NULL,
  kind     TEXT    NOT NULL,
  model    TEXT    NOT NULL,
  ok       INTEGER NOT NULL,
  date     TEXT    NOT NULL,
  ts       TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_aiusage_ts ON ai_usage(ts);

CREATE TABLE IF NOT EXISTS config (
  id          TEXT PRIMARY KEY,
  ownerChatId INTEGER
);

-- Dedup of Telegram update_ids. No TTL in SQLite → pruned by the cron.
CREATE TABLE IF NOT EXISTS seen_updates (
  id        INTEGER PRIMARY KEY,
  createdAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_seen_created ON seen_updates(createdAt);
