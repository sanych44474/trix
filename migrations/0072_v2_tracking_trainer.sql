-- Explicit tracking and trainer records which were previously stored in several small legacy
-- tables. This migration is additive and backfills by stable legacy ids.

CREATE TABLE IF NOT EXISTS v2_water_logs (
  accountId INTEGER NOT NULL REFERENCES v2_accounts(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  ml INTEGER NOT NULL,
  createdAt TEXT NOT NULL,
  PRIMARY KEY (accountId, date)
);

CREATE TABLE IF NOT EXISTS v2_step_logs (
  accountId INTEGER NOT NULL REFERENCES v2_accounts(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  steps INTEGER NOT NULL,
  createdAt TEXT NOT NULL,
  PRIMARY KEY (accountId, date)
);

CREATE TABLE IF NOT EXISTS v2_trainers (
  accountId INTEGER PRIMARY KEY REFERENCES v2_accounts(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  inviteCode TEXT,
  name TEXT NOT NULL,
  bio TEXT,
  accepting INTEGER NOT NULL DEFAULT 1,
  createdAt TEXT NOT NULL,
  approvedAt TEXT
);

CREATE TABLE IF NOT EXISTS v2_client_cards (
  trainerId INTEGER NOT NULL REFERENCES v2_accounts(id) ON DELETE CASCADE,
  clientId INTEGER NOT NULL REFERENCES v2_accounts(id) ON DELETE CASCADE,
  healthNotes TEXT,
  personalNotes TEXT,
  birthday TEXT,
  updatedAt TEXT NOT NULL,
  PRIMARY KEY (trainerId, clientId)
);

CREATE TABLE IF NOT EXISTS v2_client_notes (
  trainerId INTEGER NOT NULL REFERENCES v2_accounts(id) ON DELETE CASCADE,
  clientId INTEGER NOT NULL REFERENCES v2_accounts(id) ON DELETE CASCADE,
  note TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  PRIMARY KEY (trainerId, clientId)
);

CREATE TABLE IF NOT EXISTS v2_trainer_prospects (
  code TEXT PRIMARY KEY,
  trainerId INTEGER NOT NULL REFERENCES v2_accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  createdAt TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_v2_water_account_date ON v2_water_logs(accountId, date);
CREATE INDEX IF NOT EXISTS idx_v2_steps_account_date ON v2_step_logs(accountId, date);
CREATE INDEX IF NOT EXISTS idx_v2_client_cards_client ON v2_client_cards(clientId);

INSERT OR IGNORE INTO v2_wellbeing (accountId, date, energy, sleep, stress, createdAt)
SELECT userId, date, energy, sleep, stress, createdAt FROM daily_checkins;
INSERT OR IGNORE INTO v2_water_logs (accountId, date, ml, createdAt)
SELECT userId, date, ml, createdAt FROM water_logs;
INSERT OR IGNORE INTO v2_step_logs (accountId, date, steps, createdAt)
SELECT userId, date, steps, createdAt FROM step_logs;
INSERT OR IGNORE INTO v2_food_references (id, name, brand, per100g, source, updatedAt)
SELECT query, query, NULL, per100g, COALESCE(json_extract(per100g, '$.source'), 'legacy'), ts FROM food_cache;
INSERT OR IGNORE INTO v2_trainers (accountId, status, inviteCode, name, bio, accepting, createdAt, approvedAt)
SELECT trainerId, status, inviteCode, name, bio, accepting, createdAt, approvedAt FROM trainers;
INSERT OR IGNORE INTO v2_client_cards (trainerId, clientId, healthNotes, personalNotes, birthday, updatedAt)
SELECT trainerId, clientId, healthNotes, personalNotes, birthday, updatedAt FROM client_cards;
INSERT OR IGNORE INTO v2_client_notes (trainerId, clientId, note, updatedAt)
SELECT trainerId, clientId, note, updatedAt FROM client_notes;
INSERT OR IGNORE INTO v2_trainer_prospects (code, trainerId, name, createdAt)
SELECT code, trainerId, name, createdAt FROM trainer_prospects;
