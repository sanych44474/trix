-- AI-safety audit trail (roadmap item 7): every plan mutation outside the bi-weekly progression
-- cycle (plan_adjustments) -- AI-coach edits, manual swaps, injury auto-swaps, trainer edits --
-- gets one row here so "what changed and why" is reconstructable regardless of source.
CREATE TABLE IF NOT EXISTS plan_change_log (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  userId    INTEGER NOT NULL,
  source    TEXT    NOT NULL,
  summary   TEXT    NOT NULL,
  createdAt TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_plan_change_log_user ON plan_change_log(userId, createdAt);
