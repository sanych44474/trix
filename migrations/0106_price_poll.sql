-- Price poll: one answer per account to "would you pay about $4-5 a month?" (yes / own price /
-- not ready), plus an optional "what to add or remove". Re-answering overwrites. The wish is also
-- stored in v2_feedback so the owner triages it with the rest of the feedback.
CREATE TABLE IF NOT EXISTS v2_price_poll (
  accountId INTEGER PRIMARY KEY REFERENCES v2_accounts(id) ON DELETE CASCADE,
  choice TEXT NOT NULL,
  price REAL,
  wish TEXT,
  answeredAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
