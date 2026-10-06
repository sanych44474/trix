-- Trainer <-> client chat in the Mini App: when the recipient opened the thread. NULL = unread.
-- Old rows predate the in-app chat and were delivered as Telegram pushes; count them as read.
ALTER TABLE v2_messages ADD COLUMN readAt TEXT;
UPDATE v2_messages SET readAt = createdAt WHERE readAt IS NULL;
CREATE INDEX IF NOT EXISTS idx_v2_messages_unread ON v2_messages(toAccountId, readAt);
