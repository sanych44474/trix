-- Push tokens (Firebase Cloud Messaging) for the native app. An account with no Telegram chat
-- (email / Google sign-in) is reached through these; one row per installed app instance.
CREATE TABLE IF NOT EXISTS v2_push_devices (
  token TEXT PRIMARY KEY,
  accountId INTEGER NOT NULL REFERENCES v2_accounts(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('android', 'ios')),
  appVersion TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_v2_push_devices_account ON v2_push_devices(accountId);
