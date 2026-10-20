-- Passwordless email identities and revocable app sessions. Telegram remains a separate auth
-- method; an email address can be linked to an existing account only from an authenticated session.
CREATE TABLE IF NOT EXISTS v2_auth_emails (
  email TEXT PRIMARY KEY COLLATE NOCASE,
  accountId INTEGER NOT NULL REFERENCES v2_accounts(id) ON DELETE CASCADE,
  createdAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_v2_auth_emails_account ON v2_auth_emails(accountId);

CREATE TABLE IF NOT EXISTS v2_auth_sessions (
  tokenHash TEXT PRIMARY KEY,
  accountId INTEGER NOT NULL REFERENCES v2_accounts(id) ON DELETE CASCADE,
  createdAt TEXT NOT NULL,
  expiresAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_v2_auth_sessions_account ON v2_auth_sessions(accountId);
CREATE INDEX IF NOT EXISTS idx_v2_auth_sessions_expiry ON v2_auth_sessions(expiresAt);

CREATE TABLE IF NOT EXISTS v2_auth_email_challenges (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL COLLATE NOCASE,
  codeHash TEXT NOT NULL,
  linkAccountId INTEGER REFERENCES v2_accounts(id) ON DELETE CASCADE,
  createdAt TEXT NOT NULL,
  expiresAt TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  consumedAt TEXT
);
CREATE INDEX IF NOT EXISTS idx_v2_auth_challenges_email_created ON v2_auth_email_challenges(email, createdAt);
CREATE INDEX IF NOT EXISTS idx_v2_auth_challenges_expiry ON v2_auth_email_challenges(expiresAt);
