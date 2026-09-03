-- 0043: AI response cache. Identical prompts (same kind + system + normalized user text)
-- reuse the stored response instead of re-hitting the provider chain — the big win is
-- repeated nutrition text estimates ("apple 100g"), which are user-independent per language.
-- Rows expire via expiresAt; the weekly telemetry prune deletes stale ones.
-- Apply manually: npx wrangler d1 execute trix --remote --file migrations/0043_ai_cache.sql

CREATE TABLE IF NOT EXISTS ai_cache (
  key TEXT PRIMARY KEY,   -- sha256 hex of kind + system + normalized user prompt
  response TEXT NOT NULL,
  expiresAt TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ai_cache_expires ON ai_cache(expiresAt);
