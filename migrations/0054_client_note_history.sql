-- Trainer note-taking (client_notes.note, client_cards.healthNotes/personalNotes) is a single
-- mutable field per (trainer, client) pair — a new save silently destroys the previous value.
-- This journal keeps every past value so a trainer can look up what they wrote weeks ago instead
-- of only ever seeing the latest overwrite. Append-only: setClientNote/setClientCard write the
-- CURRENT value here right before overwriting it (see db/repos/trainer.ts).
CREATE TABLE IF NOT EXISTS client_note_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trainerId INTEGER NOT NULL,
  clientId INTEGER NOT NULL,
  field TEXT NOT NULL, -- "note" | "healthNotes" | "personalNotes"
  value TEXT NOT NULL,
  savedAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_note_history_lookup ON client_note_history(trainerId, clientId, field, savedAt);
