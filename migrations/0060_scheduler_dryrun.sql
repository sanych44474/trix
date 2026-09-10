-- Observation log for the scheduler's Durable-Object dry-run phase. Each per-user DO alarm runs
-- the SAME processUser logic the old cron path uses, but against a shadow D1 (src/durable/
-- shadowDb.ts) that intercepts writes instead of applying them, and a logging Sender instead of
-- a real Telegram bot -- so this table records what the DO path WOULD have sent/written, for
-- comparison against what the still-live cron path actually did. Purely observational: nothing
-- here is read back by the app. Safe to prune freely once the comparison window is over.
CREATE TABLE IF NOT EXISTS scheduler_dryrun_log (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  source    TEXT    NOT NULL,   -- which DO produced this: 'user' | 'squad' | 'global'
  entityId  INTEGER NOT NULL,   -- userId / chatId, depending on source
  kind      TEXT    NOT NULL,   -- 'send' | 'write'
  detail    TEXT    NOT NULL,   -- JSON: {chatId,text} for a send, {sql,params} for a write
  createdAt TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_scheduler_dryrun_log_entity ON scheduler_dryrun_log(source, entityId, createdAt);
