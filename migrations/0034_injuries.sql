-- Injury / pain reports with the plan swaps they triggered. One active row per (user, area);
-- a follow-up check is scheduled via checkAfter and the swaps let us restore on recovery.
CREATE TABLE IF NOT EXISTS injuries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER NOT NULL,
  area TEXT NOT NULL,
  severity TEXT NOT NULL,                 -- mild | strong
  status TEXT NOT NULL DEFAULT 'active',  -- active | recovered
  reportedAt TEXT NOT NULL,
  checkAfter TEXT NOT NULL,               -- YYYY-MM-DD local — when to ask "how is it?"
  lastAskedAt TEXT,
  swaps TEXT NOT NULL DEFAULT '[]',       -- [{weekday,index,original:PlanExercise,replacementCanonical}]
  resolvedAt TEXT
);
CREATE INDEX IF NOT EXISTS idx_injuries_user ON injuries(userId, status);
