-- Telegram @username per user (without the leading @). Captured/refreshed on each interaction
-- by the bot middleware. NULL for users who have no Telegram username or haven't interacted
-- since this column was added. Used in the owner report's Users table.
ALTER TABLE users ADD COLUMN username TEXT;
