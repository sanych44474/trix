-- Strava connection (cardio import). One link per account; tokens are stored AES-GCM encrypted
-- with a key derived from STRAVA_CLIENT_SECRET (src/adapters/d1/v2Strava.ts), so a leaked D1
-- dump alone does not hand out Strava access. Imported activity ids are remembered so a sync
-- never adds the same run twice, even after the user edits that day's log.
CREATE TABLE IF NOT EXISTS v2_strava_links (
  accountId INTEGER PRIMARY KEY REFERENCES v2_accounts(id) ON DELETE CASCADE,
  athleteId INTEGER NOT NULL,
  tokens TEXT NOT NULL,           -- encrypted JSON {access, refresh, expiresAt}
  lastSyncAt TEXT,                -- last successful sync (ISO)
  lastError TEXT,                 -- short reason of the last failed sync, NULL when healthy
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS v2_strava_imports (
  accountId INTEGER NOT NULL REFERENCES v2_accounts(id) ON DELETE CASCADE,
  activityId INTEGER NOT NULL,
  date TEXT NOT NULL,             -- local date the activity was logged under
  createdAt TEXT NOT NULL,
  PRIMARY KEY (accountId, activityId)
);
