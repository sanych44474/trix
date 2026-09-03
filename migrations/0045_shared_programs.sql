-- 0045: shared programs — the unit behind "share a program" modes 2 (link) and 3 (public
-- library). An instructor publishes a BankPlan-shaped snapshot under a short code; a link
-- (isPublic 0) is opened via t.me/bot?start=prog_<code>, a library entry (isPublic 1) is
-- browsable by anyone. Taking one adapts it per user (adaptPlan) and activates it.
-- Apply manually: npx wrangler d1 execute trix --remote --file migrations/0045_shared_programs.sql

CREATE TABLE IF NOT EXISTS shared_programs (
  code TEXT PRIMARY KEY,
  ownerId INTEGER NOT NULL,      -- the instructor/owner who shared it
  name TEXT NOT NULL,
  plan TEXT NOT NULL,            -- BankPlan JSON
  isPublic INTEGER NOT NULL DEFAULT 0,
  takenCount INTEGER NOT NULL DEFAULT 0,
  createdAt TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_shared_public ON shared_programs(isPublic, createdAt);
