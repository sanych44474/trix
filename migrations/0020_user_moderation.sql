-- Moderation flags on users.
--   blocked    = the OWNER banned this user (the bot stops serving them, pending owner decision).
--   botBlocked = the USER blocked the bot (auto-detected from a 403 on send, so the scheduler
--                stops retrying the same dead chat every minute).
ALTER TABLE users ADD COLUMN blocked INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN botBlocked INTEGER NOT NULL DEFAULT 0;
