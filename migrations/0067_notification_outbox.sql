-- Reliable delivery for scheduler.ts's reminder sends (roadmap item 3, scoped to scheduler
-- notifications only -- see db/repos/notificationOutbox.ts). Today a failed sendMessage inside
-- processUser's `send` closure is caught, logged, and the notification is just lost; this table
-- lets a failure retry with backoff instead, on the existing per-minute cron tick.
CREATE TABLE IF NOT EXISTS notification_outbox (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  userId         INTEGER NOT NULL,
  chatId         INTEGER NOT NULL,
  kind           TEXT    NOT NULL,
  idempotencyKey TEXT    NOT NULL,
  payload        TEXT    NOT NULL,
  status         TEXT    NOT NULL DEFAULT 'pending',
  attempts       INTEGER NOT NULL DEFAULT 0,
  nextAttemptAt  TEXT    NOT NULL,
  lastError      TEXT,
  createdAt      TEXT    NOT NULL,
  sentAt         TEXT
);
-- Defense in depth, not the primary dedup mechanism (that's the cutover mutual-exclusion flag,
-- see durable/cutover.ts) -- collapses an accidental double-enqueue of the identical notification.
CREATE UNIQUE INDEX IF NOT EXISTS idx_notification_outbox_idem ON notification_outbox(userId, idempotencyKey);
CREATE INDEX IF NOT EXISTS idx_notification_outbox_due ON notification_outbox(status, nextAttemptAt);
