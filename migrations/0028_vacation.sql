-- Vacation / pause mode. While now < vacationUntil the scheduler sends NO reminders (don't disturb)
-- and the user is excluded from inactivity-cleanup candidates. On vacation end the bot runs a short
-- comeback interview; comebackDone dedups that so it fires once per vacation.

ALTER TABLE users ADD COLUMN vacationUntil TEXT;  -- ISO; paused while now < this
ALTER TABLE users ADD COLUMN comebackDone  TEXT;  -- ISO of the last handled vacation-end
