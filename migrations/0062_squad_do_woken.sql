-- Same idea as users.doWokenAt (migration 0061), for squads: whether this squad's recap
-- Durable Object has ever been woken. NULL = never woken. New squads are woken immediately at
-- creation (bot/squad.ts); this column exists only to catch up any squad that predates that
-- code path.
ALTER TABLE squads ADD COLUMN doWokenAt TEXT;
