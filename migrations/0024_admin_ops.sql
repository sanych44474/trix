-- Admin operations: audit log of owner/trainer actions, a trainer "flag" on concerning clients,
-- and owner-alert dedup state (so proactive alerts don't spam).
CREATE TABLE IF NOT EXISTS admin_audit (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  ts       TEXT    NOT NULL,
  actorId  INTEGER NOT NULL,
  action   TEXT    NOT NULL,
  targetId INTEGER,
  detail   TEXT
);
CREATE INDEX IF NOT EXISTS idx_admin_audit_ts ON admin_audit(ts);

-- Trainer marks a client as needing attention; surfaced in the weekly digest.
ALTER TABLE users ADD COLUMN flagged INTEGER NOT NULL DEFAULT 0;

-- JSON of last-sent owner alerts ({ "<key>": "<iso>" }) to throttle proactive alerts.
ALTER TABLE config ADD COLUMN alertState TEXT;
