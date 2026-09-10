-- Per-squad recap bookkeeping. The weekly recap used to be gated by a single global setting
-- ("last_squad_digest_week"), which forced the whole fan-out into ONE cron invocation: on the
-- Workers Free plan that is capped at 50 external subrequests, and every recap post is one.
-- Marking the week per squad lets the sweep run in small batches across consecutive ticks
-- without re-posting to a chat that already got its recap.
ALTER TABLE squads ADD COLUMN lastRecapWeek TEXT;
