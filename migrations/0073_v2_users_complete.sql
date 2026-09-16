-- Domain 1 (user-core/preferences/onboarding) completeness pass. 0069/0070 gave v2_accounts/
-- v2_profiles/v2_preferences/v2_onboarding a PARTIAL shadow of `users` (enough for shadow-read
-- parity checks) -- several UserDoc fields (src/types.ts) have no v2 column at all yet, and the
-- legacy `session`/`profile` JSON blobs are only partially unpacked. This migration adds what's
-- missing so v2Users.ts (src/adapters/d1/v2Users.ts) can be a full, faithful v2-native
-- replacement for src/db/repos/users.ts, not just a parity shadow.
--
-- Design: mirror the legacy pattern (0037/0056/0057) of "JSON blob is the source of truth, hot
-- WHERE-clause fields also get a plain dual-written column so the every-minute scheduler sweeps
-- stay index-backed" -- rather than exploding UserProfile's 30+ optional fields into that many
-- new columns. `v2_profiles.profile` and `v2_onboarding.session` are the new full-fidelity JSON
-- columns (mirroring legacy `users.profile` / `users.session` exactly); referredBy/buddyId/
-- sessionMode/sessionRetryAfter are promoted, indexed columns dual-written from them, exactly
-- matching legacy 0037/0056/0057's reasoning.

-- ---------- v2_accounts: identity/status/moderation/activity fields with no v2 column yet ----------
ALTER TABLE v2_accounts ADD COLUMN username TEXT;
ALTER TABLE v2_accounts ADD COLUMN blocked INTEGER NOT NULL DEFAULT 0;    -- owner-banned (see legacy 0020)
ALTER TABLE v2_accounts ADD COLUMN botBlocked INTEGER NOT NULL DEFAULT 0; -- user blocked the bot (see legacy 0020)
ALTER TABLE v2_accounts ADD COLUMN flagged INTEGER NOT NULL DEFAULT 0;    -- trainer attention flag (see legacy 0024)
ALTER TABLE v2_accounts ADD COLUMN progressionRate TEXT NOT NULL DEFAULT 'normal'; -- legacy progression_rate (0008)
ALTER TABLE v2_accounts ADD COLUMN lastSeenAt TEXT;      -- legacy 0027
ALTER TABLE v2_accounts ADD COLUMN doWokenAt TEXT;       -- legacy 0061
ALTER TABLE v2_accounts ADD COLUMN vacationUntil TEXT;   -- legacy 0028
ALTER TABLE v2_accounts ADD COLUMN comebackDone TEXT;    -- legacy 0028
ALTER TABLE v2_accounts ADD COLUMN inactiveAskedAt TEXT; -- legacy 0029
ALTER TABLE v2_accounts ADD COLUMN inactiveReply TEXT;   -- legacy 0029

-- `status` (0069) already collapses blocked/botBlocked into one string for the parity shadow;
-- the explicit booleans above are what UserDoc.blocked/botBlocked need back out losslessly.
CREATE INDEX IF NOT EXISTS idx_v2_accounts_updated ON v2_accounts(updatedAt); -- mirrors idx_users_updated

-- ---------- v2_profiles: full-fidelity profile JSON + the two hot indexed fields ----------
ALTER TABLE v2_profiles ADD COLUMN profile TEXT NOT NULL DEFAULT '{}';   -- full UserProfile JSON (mirrors users.profile)
ALTER TABLE v2_profiles ADD COLUMN nutrition TEXT;                       -- full NutritionTargets JSON (mirrors users.nutrition); NULL = none set
ALTER TABLE v2_profiles ADD COLUMN referredBy INTEGER;                   -- dual-written from profile.referredBy, see legacy 0056
ALTER TABLE v2_profiles ADD COLUMN buddyId INTEGER;                      -- dual-written from profile.buddyId, see legacy 0057
CREATE INDEX IF NOT EXISTS idx_v2_profiles_referred_by ON v2_profiles(referredBy);
CREATE INDEX IF NOT EXISTS idx_v2_profiles_buddy_id ON v2_profiles(buddyId);

-- ---------- v2_onboarding: full session JSON + the sessionMode/sessionRetryAfter sweep columns ----------
-- `step` (0069) already carries session.mode as a parity-shadow convenience; `session` here is
-- the actual full UserSession JSON (transcript, coachActions, logDraft, ...) -- there was no
-- column for it at all before this migration, so onboarded/non-onboarded session state could
-- not round-trip through v2 losslessly.
ALTER TABLE v2_onboarding ADD COLUMN session TEXT NOT NULL DEFAULT '{"mode":"idle"}';
ALTER TABLE v2_onboarding ADD COLUMN sessionMode TEXT;
ALTER TABLE v2_onboarding ADD COLUMN sessionRetryAfter TEXT;
-- Cohort anchor for retention_d1/d7/d30 (docs/slos.md), mirroring legacy users.onboardedAt
-- (0068) exactly, INCLUDING its COALESCE-only-write discipline (stampOnboardedAt below). Kept
-- separate from `completedAt` (0069/0070), which the existing dual-write projector overwrites on
-- every sync and is therefore unsafe to reuse as a COALESCE-protected first-ever timestamp.
ALTER TABLE v2_onboarding ADD COLUMN onboardedAt TEXT;

CREATE INDEX IF NOT EXISTS idx_v2_onboarding_status ON v2_onboarding(status);               -- mirrors idx_users_onboarded
CREATE INDEX IF NOT EXISTS idx_v2_onboarding_session_retry ON v2_onboarding(sessionRetryAfter);      -- mirrors idx_users_session_retry (0037)
CREATE INDEX IF NOT EXISTS idx_v2_onboarding_status_mode ON v2_onboarding(status, sessionMode);      -- mirrors idx_users_session_mode (0037)

-- ---------- v2_preferences: the UserReminders scheduler-dedup blob ----------
-- NOTE: v2_preferences.reminders (0069) already holds something else (profile.reminderHour +
-- profile.remindersOff, written by the existing dual-write projector) -- NOT the same concept as
-- UserDoc.reminders (UserReminders: scheduler dedup state -- sent/lastNudge/lastLevel/prCount/
-- lastVacation/lastRank/workoutIgnoredStreak, legacy users.reminders, added in 0021). Reusing
-- that column would silently corrupt both. New column, new name.
ALTER TABLE v2_preferences ADD COLUMN userReminders TEXT; -- full UserReminders JSON (mirrors legacy users.reminders / 0021)

-- ---------- Idempotent backfill from legacy `users`, same pattern as 0069/0070 ----------
UPDATE v2_accounts SET
  username = (SELECT u.username FROM users u WHERE u.id = v2_accounts.legacyUserId),
  blocked = (SELECT COALESCE(u.blocked, 0) FROM users u WHERE u.id = v2_accounts.legacyUserId),
  botBlocked = (SELECT COALESCE(u.botBlocked, 0) FROM users u WHERE u.id = v2_accounts.legacyUserId),
  flagged = (SELECT COALESCE(u.flagged, 0) FROM users u WHERE u.id = v2_accounts.legacyUserId),
  progressionRate = (SELECT COALESCE(u.progression_rate, 'normal') FROM users u WHERE u.id = v2_accounts.legacyUserId),
  lastSeenAt = (SELECT u.lastSeenAt FROM users u WHERE u.id = v2_accounts.legacyUserId),
  doWokenAt = (SELECT u.doWokenAt FROM users u WHERE u.id = v2_accounts.legacyUserId),
  vacationUntil = (SELECT u.vacationUntil FROM users u WHERE u.id = v2_accounts.legacyUserId),
  comebackDone = (SELECT u.comebackDone FROM users u WHERE u.id = v2_accounts.legacyUserId),
  inactiveAskedAt = (SELECT u.inactiveAskedAt FROM users u WHERE u.id = v2_accounts.legacyUserId),
  inactiveReply = (SELECT u.inactiveReply FROM users u WHERE u.id = v2_accounts.legacyUserId)
WHERE EXISTS (SELECT 1 FROM users u WHERE u.id = v2_accounts.legacyUserId);

UPDATE v2_profiles SET
  profile = (SELECT u.profile FROM users u WHERE u.id = v2_profiles.accountId AND json_valid(u.profile)),
  nutrition = (SELECT u.nutrition FROM users u WHERE u.id = v2_profiles.accountId AND (u.nutrition IS NULL OR json_valid(u.nutrition))),
  referredBy = (SELECT json_extract(u.profile, '$.referredBy') FROM users u WHERE u.id = v2_profiles.accountId AND json_valid(u.profile)),
  buddyId = (SELECT json_extract(u.profile, '$.buddyId') FROM users u WHERE u.id = v2_profiles.accountId AND json_valid(u.profile))
WHERE EXISTS (SELECT 1 FROM users u WHERE u.id = v2_profiles.accountId);

UPDATE v2_onboarding SET
  session = (SELECT u.session FROM users u WHERE u.id = v2_onboarding.accountId AND json_valid(u.session)),
  sessionMode = (SELECT u.sessionMode FROM users u WHERE u.id = v2_onboarding.accountId),
  sessionRetryAfter = (SELECT u.sessionRetryAfter FROM users u WHERE u.id = v2_onboarding.accountId),
  onboardedAt = (SELECT u.onboardedAt FROM users u WHERE u.id = v2_onboarding.accountId)
WHERE EXISTS (SELECT 1 FROM users u WHERE u.id = v2_onboarding.accountId);

UPDATE v2_preferences SET
  userReminders = (SELECT u.reminders FROM users u WHERE u.id = v2_preferences.accountId AND (u.reminders IS NULL OR json_valid(u.reminders)))
WHERE EXISTS (SELECT 1 FROM users u WHERE u.id = v2_preferences.accountId);
