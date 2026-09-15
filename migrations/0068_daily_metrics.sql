-- Product analytics rollup (roadmap item 4 / docs/slos.md §4). Populated once per day by the
-- scheduler (dailyMetricsRollup.ts), never computed live at dashboard-render time -- retention/
-- funnel queries over the full user history get expensive as the user base grows.
CREATE TABLE IF NOT EXISTS daily_metrics (
  date   TEXT NOT NULL,
  metric TEXT NOT NULL,
  dims   TEXT NOT NULL DEFAULT '{}',
  value  REAL NOT NULL,
  PRIMARY KEY (date, metric, dims)
);

-- Cohort anchor for retention_d1/d7/d30 (docs/slos.md §2: "of users onboarded on day X..."). Only
-- stamped going forward from this migration -- existing users keep NULL, so retention is
-- honestly computable only for cohorts that onboard after this ships, not backfilled.
ALTER TABLE users ADD COLUMN onboardedAt TEXT;
