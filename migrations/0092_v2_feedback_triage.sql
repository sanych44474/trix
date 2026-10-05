-- Feedback triage in the owner console: a category (auto-guessed on insert, owner can change it)
-- and a status (new → done / wontfix), so feedback stops being a Telegram scroll. resolvedAt is
-- when it was closed. Old rows get status 'new' and a NULL category (shown as "other").
ALTER TABLE v2_feedback ADD COLUMN category TEXT;
ALTER TABLE v2_feedback ADD COLUMN status TEXT NOT NULL DEFAULT 'new';
ALTER TABLE v2_feedback ADD COLUMN resolvedAt TEXT;
CREATE INDEX IF NOT EXISTS idx_v2_feedback_status ON v2_feedback(status, createdAt);
