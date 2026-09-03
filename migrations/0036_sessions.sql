-- Scheduled trainer↔client sessions. Local date/hour as agreed by both (no tz conversion in v1 —
-- offline sessions are same-city; documented assumption).
CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trainerId INTEGER NOT NULL,
  clientId INTEGER NOT NULL,
  date TEXT NOT NULL,                      -- YYYY-MM-DD
  hour INTEGER NOT NULL,                   -- 0..23
  kind TEXT NOT NULL DEFAULT 'offline',    -- offline|online
  status TEXT NOT NULL DEFAULT 'proposed', -- proposed|confirmed|declined|cancelled|done
  proposedBy TEXT NOT NULL,                -- trainer|client
  note TEXT,
  remindedAt TEXT,                         -- YYYY-MM-DD of last reminder (dedup)
  createdAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_trainer ON sessions(trainerId, date);
CREATE INDEX IF NOT EXISTS idx_sessions_client ON sessions(clientId, date);
CREATE INDEX IF NOT EXISTS idx_sessions_due ON sessions(status, date);
