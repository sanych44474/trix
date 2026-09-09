-- 0056: promote profile.referredBy to a real indexed column, same fix as 0037 did for
-- session.mode/retryAfter. friendIds() (db/repos/workouts.ts) ran
-- `SELECT id FROM users WHERE json_extract(profile,'$.referredBy') = ?` on every dashboard/
-- leaderboard-scoping request — json_extract can't use an index, so this was a full user-table
-- scan per call. The profile JSON stays the source of truth; this column is dual-written by
-- updateUser whenever profile is saved (referredBy is set exactly once, pre-onboarding, and
-- never changes after).

ALTER TABLE users ADD COLUMN referredBy INTEGER;

UPDATE users SET referredBy = json_extract(profile, '$.referredBy');

CREATE INDEX IF NOT EXISTS idx_users_referred_by ON users(referredBy);
