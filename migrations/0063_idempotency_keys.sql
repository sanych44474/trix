-- Client-supplied idempotency keys for Mini App POST actions where a retried/duplicated request
-- would otherwise repeat a side effect the underlying row-level write already protects against
-- re-running for real (e.g. workout_logs' PRIMARY KEY (userId, date) makes the LOG itself safe
-- to re-save, but a trainer notification sent inside that same save is not naturally deduped).
-- One row per (userId, key); the cached response is replayed verbatim on a repeat within the
-- window instead of re-running the handler. Pruned by age alongside the other telemetry tables
-- (scheduler.ts's weekly log-prune pass).
CREATE TABLE IF NOT EXISTS idempotency_keys (
  userId     INTEGER NOT NULL,
  key        TEXT    NOT NULL,
  response   TEXT    NOT NULL,   -- JSON body to replay verbatim
  status     INTEGER NOT NULL,   -- HTTP status to replay verbatim
  createdAt  TEXT    NOT NULL,
  PRIMARY KEY (userId, key)
);
CREATE INDEX IF NOT EXISTS idx_idempotency_keys_created ON idempotency_keys(createdAt);
