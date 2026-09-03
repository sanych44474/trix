-- Trainer-authored client-card fields: health specifics (injuries, pain triggers the trainer
-- writes down), personal notes (hobbies, family, context) and a structured birthday.
-- One row per (trainer, client), same shape as client_billing. All columns nullable — a row
-- appears the first time the trainer writes any field.
CREATE TABLE IF NOT EXISTS client_cards (
  trainerId INTEGER NOT NULL,
  clientId INTEGER NOT NULL,
  healthNotes TEXT,
  personalNotes TEXT,
  birthday TEXT,
  updatedAt TEXT NOT NULL,
  PRIMARY KEY (trainerId, clientId)
);
