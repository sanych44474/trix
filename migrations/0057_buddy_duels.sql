-- 0057: buddy duels (weekly win/loss tally between accountability-buddy pairs).
--
-- profile.buddyId gets the same indexed-column treatment 0056 gave referredBy — the weekly
-- duel sweep needs to enumerate every paired user, and json_extract(profile,'$.buddyId') on
-- that scan is exactly the unindexed full-table-scan pattern 0037/0056 already fixed twice.
-- The profile JSON stays the source of truth; this column is dual-written by updateUser
-- whenever profile is saved.
ALTER TABLE users ADD COLUMN buddyId INTEGER;
UPDATE users SET buddyId = json_extract(profile, '$.buddyId');
CREATE INDEX IF NOT EXISTS idx_users_buddy_id ON users(buddyId);

-- One row per (pair, week) — durable history so a tally isn't recomputed retroactively (and
-- can't drift if old logs are ever edited/deleted). userA is always the smaller of the two ids,
-- so a pair has exactly one row per week regardless of which side "started" the pairing.
CREATE TABLE IF NOT EXISTS buddy_duels (
  userA     INTEGER NOT NULL,
  userB     INTEGER NOT NULL,
  weekKey   TEXT    NOT NULL, -- ISO week, e.g. "2026-W24"
  aCount    INTEGER NOT NULL,
  bCount    INTEGER NOT NULL,
  winnerId  INTEGER,          -- NULL = tie
  createdAt TEXT    NOT NULL,
  PRIMARY KEY (userA, userB, weekKey)
);
CREATE INDEX IF NOT EXISTS idx_buddy_duels_winner ON buddy_duels(winnerId);
