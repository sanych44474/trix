-- Trainer scheduling and money. /api/v2/trainer/sessions and /api/v2/trainer/finance were both
-- registered in v2Api.ts's PATHS (and in index.ts's legacy allowlist) but had no handler branch
-- and no table behind them, so every call fell through to notFound(). These are the tables.
--
-- Legacy `client_billing` is deliberately NOT backfilled: legacyFreeze.ts already lists it among
-- the tables earlier domain work found dead/unused, and it has no reader anywhere in src/. There
-- is nothing to port, so both tables start empty.
--
-- Money is stored as whole currency units in an INTEGER, the same scale v2_trainers.priceOnline
-- already uses -- not minor units -- so a session price and a trainer's advertised rate stay
-- directly comparable without a conversion at every read site.

CREATE TABLE IF NOT EXISTS v2_trainer_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trainerId INTEGER NOT NULL REFERENCES v2_accounts(id) ON DELETE CASCADE,
  clientId INTEGER NOT NULL REFERENCES v2_accounts(id) ON DELETE CASCADE,
  startsAt TEXT NOT NULL,                  -- ISO 8601 instant
  durationMin INTEGER NOT NULL DEFAULT 60,
  status TEXT NOT NULL DEFAULT 'planned',  -- planned | done | cancelled | no_show
  price INTEGER,                           -- what this session bills; NULL = not billable
  note TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_v2_sessions_trainer ON v2_trainer_sessions(trainerId, startsAt);
CREATE INDEX IF NOT EXISTS idx_v2_sessions_client ON v2_trainer_sessions(clientId, startsAt);

CREATE TABLE IF NOT EXISTS v2_trainer_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trainerId INTEGER NOT NULL REFERENCES v2_accounts(id) ON DELETE CASCADE,
  clientId INTEGER NOT NULL REFERENCES v2_accounts(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'UAH',
  paidOn TEXT NOT NULL,                    -- YYYY-MM-DD the trainer recorded the payment for
  note TEXT,
  createdAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_v2_payments_trainer ON v2_trainer_payments(trainerId, paidOn);
CREATE INDEX IF NOT EXISTS idx_v2_payments_client ON v2_trainer_payments(clientId, paidOn);
