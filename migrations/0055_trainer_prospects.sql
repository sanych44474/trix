-- Minimal "invite a specific client" — Telegram bots can't message someone before they've
-- pressed Start (chatId doesn't exist yet), so there's no such thing as truly pre-creating a
-- client record. This is the smallest useful version: a trainer types a name, gets a personal
-- deep link (trp_<code>), and the record here lets /start auto-pair AND pre-fill the client's
-- name from what the trainer already calls them, instead of the generic shared tr_<code> link
-- (which can't tell prospects apart when several are pending at once). Single-use — consumed
-- (deleted) the moment someone opens it.
CREATE TABLE IF NOT EXISTS trainer_prospects (
  code TEXT PRIMARY KEY,
  trainerId INTEGER NOT NULL,
  name TEXT NOT NULL,
  createdAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_prospects_trainer ON trainer_prospects(trainerId);
