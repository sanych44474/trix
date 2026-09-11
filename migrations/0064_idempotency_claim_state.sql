-- Closes a real race in the original get -> execute -> record idempotency flow: two concurrent
-- requests carrying the same key could both miss the cache (nothing recorded yet) and both run
-- the handler for real. `state` lets a row represent "claimed, still running" separately from
-- "done, safe to replay" -- the claim itself is an INSERT that relies on the existing PRIMARY KEY
-- (userId, key) to fail atomically on a concurrent duplicate claim (db/repos/idempotency.ts).
-- Existing rows are all real completed responses, hence the 'done' default.
ALTER TABLE idempotency_keys ADD COLUMN state TEXT NOT NULL DEFAULT 'done';
