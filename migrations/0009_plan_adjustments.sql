-- Micro-adjustments applied to an active plan during a bi-weekly adaptive check-in.
-- changes: JSON describing the weight/volume tweaks the AI proposed (no full replan).
CREATE TABLE IF NOT EXISTS plan_adjustments (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  userId    INTEGER NOT NULL,
  week      INTEGER NOT NULL,        -- weeks since plan start at time of adjustment
  changes   TEXT    NOT NULL,        -- JSON
  ts        TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_plan_adj_user ON plan_adjustments(userId, ts);
