-- 0042: per-trainer client capacity. NULL = unlimited. When the roster is full, new client
-- requests stay pending as a WAITLIST (the client is told the trainer is at capacity).
-- Apply manually: npx wrangler d1 execute trix --remote --file migrations/0042_trainer_max_clients.sql

ALTER TABLE trainers ADD COLUMN maxClients INTEGER;
