-- Mini App workout logger: three things the app measured or knew but had nowhere to keep.
--
-- 1. Session length + rest total. The app timed the session only in the browser, so the length
--    was lost the moment the app was closed, and a two-hour session could be reported as "2:44".
--    NULL = not measured (chat/CSV/trainer logs never are); a later save without a measurement
--    keeps the earlier value instead of wiping it (see upsertWorkoutLog).
-- 2. Which plan exercise a logged one replaced (the in-session "swap"). Without it, re-opening a
--    saved day had to guess which plan slot a swapped exercise stood for.
-- 3. A server copy of the in-progress (not yet saved) logger, so a half-logged session survives
--    a cleared Telegram cache or a switch to another device. One row per account and day,
--    overwritten on every autosave, deleted once the session is saved.

ALTER TABLE v2_workout_sessions ADD COLUMN durationSec INTEGER;
ALTER TABLE v2_workout_sessions ADD COLUMN restTotalSec INTEGER;

ALTER TABLE v2_workout_exercises ADD COLUMN planName TEXT;

CREATE TABLE IF NOT EXISTS v2_workout_drafts (
  accountId INTEGER NOT NULL REFERENCES v2_accounts(id) ON DELETE CASCADE,
  date TEXT NOT NULL,          -- YYYY-MM-DD, the day being logged
  body TEXT NOT NULL,          -- the logger's own JSON (exercises + session clock), opaque here
  updatedAt TEXT NOT NULL,
  PRIMARY KEY (accountId, date)
);
