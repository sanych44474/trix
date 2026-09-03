-- Group / semi-private sessions: a group booking creates one session row PER participant that
-- shares a groupId, so the entire 1:1 session lifecycle (confirm/decline/cancel/reminders/ICS/
-- billing) keeps working unchanged per client. groupId is NULL for ordinary 1:1 sessions.
ALTER TABLE sessions ADD COLUMN groupId TEXT;
CREATE INDEX IF NOT EXISTS idx_sessions_group ON sessions (groupId);
