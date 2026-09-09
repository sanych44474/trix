-- 0042: per-trainer client capacity. NULL = unlimited. When the roster is full, new client
-- requests stay pending as a WAITLIST (the client is told the trainer is at capacity).

ALTER TABLE trainers ADD COLUMN maxClients INTEGER;
