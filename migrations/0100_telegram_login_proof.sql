-- Bind Telegram deep-link sign-in completion to the browser tab that created the challenge.
-- The public challenge ID is still safe to pass through Telegram; only a hash of the private
-- browser completion token is stored in D1.
ALTER TABLE v2_auth_telegram_challenges ADD COLUMN completionHash TEXT NOT NULL DEFAULT '';
