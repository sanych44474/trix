-- Multi-role: trainers, their clients, the pairing handshake, and draft plans.

ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'solo';   -- solo | trainer | client
ALTER TABLE users ADD COLUMN trainerId INTEGER;                   -- client -> trainer user id
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_trainer ON users(trainerId);

ALTER TABLE plans ADD COLUMN status TEXT NOT NULL DEFAULT 'active'; -- draft | active
ALTER TABLE plans ADD COLUMN authoredBy INTEGER;                   -- trainer id, NULL = AI

CREATE TABLE IF NOT EXISTS trainers (
  trainerId   INTEGER PRIMARY KEY,
  status      TEXT    NOT NULL DEFAULT 'pending', -- pending | approved | rejected
  inviteCode  TEXT,
  name        TEXT    NOT NULL,
  bio         TEXT,
  accepting   INTEGER NOT NULL DEFAULT 1,
  createdAt   TEXT    NOT NULL,
  approvedAt  TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_trainers_code ON trainers(inviteCode);
CREATE INDEX IF NOT EXISTS idx_trainers_status ON trainers(status, accepting);

CREATE TABLE IF NOT EXISTS client_requests (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  clientId  INTEGER NOT NULL,
  trainerId INTEGER NOT NULL,
  note      TEXT,
  status    TEXT    NOT NULL DEFAULT 'pending', -- pending | accepted | declined | cancelled
  createdAt TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_req_trainer ON client_requests(trainerId, status);
CREATE INDEX IF NOT EXISTS idx_req_client ON client_requests(clientId, status);

CREATE TABLE IF NOT EXISTS client_questions (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  clientId  INTEGER NOT NULL,
  trainerId INTEGER NOT NULL,
  text      TEXT    NOT NULL,
  aiDraft   TEXT,
  status    TEXT    NOT NULL DEFAULT 'pending', -- pending | answered | dismissed
  createdAt TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_q_trainer ON client_questions(trainerId, status);

CREATE TABLE IF NOT EXISTS messages (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  fromId    INTEGER NOT NULL,
  toId      INTEGER NOT NULL,
  text      TEXT    NOT NULL,
  createdAt TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_msg_to ON messages(toId, createdAt);
