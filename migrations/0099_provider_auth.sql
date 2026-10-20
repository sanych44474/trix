-- Stable external identities, provider-specific sessions, and short-lived login handshakes.
ALTER TABLE v2_auth_sessions ADD COLUMN authMethod TEXT NOT NULL DEFAULT 'email';

CREATE TABLE IF NOT EXISTS v2_auth_identities (
  provider TEXT NOT NULL CHECK (provider IN ('google')),
  subject TEXT NOT NULL,
  accountId INTEGER NOT NULL REFERENCES v2_accounts(id) ON DELETE CASCADE,
  email TEXT,
  createdAt TEXT NOT NULL,
  PRIMARY KEY(provider, subject)
);
CREATE INDEX IF NOT EXISTS idx_v2_auth_identities_account ON v2_auth_identities(accountId);

CREATE TABLE IF NOT EXISTS v2_auth_google_challenges (
  id TEXT PRIMARY KEY,
  nonceHash TEXT NOT NULL,
  linkAccountId INTEGER REFERENCES v2_accounts(id) ON DELETE CASCADE,
  createdAt TEXT NOT NULL,
  expiresAt TEXT NOT NULL,
  consumedAt TEXT
);
CREATE INDEX IF NOT EXISTS idx_v2_auth_google_challenges_expiry ON v2_auth_google_challenges(expiresAt);

CREATE TABLE IF NOT EXISTS v2_auth_telegram_challenges (
  id TEXT PRIMARY KEY,
  verifiedAccountId INTEGER REFERENCES v2_accounts(id) ON DELETE CASCADE,
  createdAt TEXT NOT NULL,
  expiresAt TEXT NOT NULL,
  consumedAt TEXT
);
CREATE INDEX IF NOT EXISTS idx_v2_auth_telegram_challenges_expiry ON v2_auth_telegram_challenges(expiresAt);
