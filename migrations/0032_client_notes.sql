-- Trainer's private free-text note about one client. One note per (trainer, client) pair.
CREATE TABLE IF NOT EXISTS client_notes (
  trainerId INTEGER NOT NULL,
  clientId INTEGER NOT NULL,
  note TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  PRIMARY KEY (trainerId, clientId)
);
