-- The Mini App's notification feed: what happened that's worth seeing again (a plan assigned or
-- changed by the trainer, a trainer's message, a new badge, the weekly progression), written
-- where it happens (src/adapters/d1/v2Inbox.ts). kind + params, not prose: the app words it in
-- the viewer's current language. Pruned to 60 days.
CREATE TABLE IF NOT EXISTS v2_inbox (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  accountId INTEGER NOT NULL REFERENCES v2_accounts(id) ON DELETE CASCADE,
  kind      TEXT NOT NULL,              -- plan_assigned | plan_changed | message | badge | progression
  params    TEXT NOT NULL DEFAULT '{}', -- JSON
  createdAt TEXT NOT NULL,
  readAt    TEXT
);
CREATE INDEX IF NOT EXISTS idx_v2_inbox_account ON v2_inbox(accountId, id);
