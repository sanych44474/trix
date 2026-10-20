-- A short code shown both in the app and in the bot's confirmation prompt, so a person asked to
-- "tap Start" by someone else can see the sign-in is not theirs. Login is confirmed only by an
-- explicit button tap in the bot, never by opening the deep link.
ALTER TABLE v2_auth_telegram_challenges ADD COLUMN matchCode TEXT NOT NULL DEFAULT '';
