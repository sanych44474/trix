-- scheduler_dryrun_log (migrations/0060) recorded what the scheduler Durable Objects would have
-- sent and written while they shadow-ran next to the cron. The Durable Objects now do that work
-- for real and the dry-run mode is removed (docs/adr/0015-scheduler-runs-in-durable-objects.md),
-- so nothing writes or reads this table. Its rows hold message texts. Schema only.
DROP INDEX IF EXISTS idx_scheduler_dryrun_log_entity;
DROP TABLE IF EXISTS scheduler_dryrun_log;
