-- 0037: promote session.mode / session.retryAfter to real indexed columns.
-- The every-minute scheduler recovery sweeps (listRetryUsers / listPlanPendingUsers /
-- listOnboardingOwedReply / listStuckOnboardingUsers) filtered on json_extract(session, ...)
-- which cannot use an index — 3-4 full user-table scans per minute. The JSON stays the
-- source of truth; these columns are dual-written by updateUser on every session save.

ALTER TABLE users ADD COLUMN sessionMode TEXT;
ALTER TABLE users ADD COLUMN sessionRetryAfter TEXT;

UPDATE users SET
  sessionMode = json_extract(session, '$.mode'),
  sessionRetryAfter = json_extract(session, '$.retryAfter');

CREATE INDEX IF NOT EXISTS idx_users_session_retry ON users(sessionRetryAfter);
CREATE INDEX IF NOT EXISTS idx_users_session_mode ON users(onboarded, sessionMode);
