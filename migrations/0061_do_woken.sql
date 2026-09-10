-- Marks whether a user's per-user scheduler Durable Object has ever been woken (had its alarm
-- armed). NULL = never woken. The hourly cron loop wakes any onboarded user missing this exactly
-- once and then sets it -- self-limiting so the wake fan-out is bounded by NEW users per hour,
-- not the whole onboarded population every hour. Keeping this a plain column (not a key inside
-- the reminders JSON blob) makes it directly queryable/indexable.
ALTER TABLE users ADD COLUMN doWokenAt TEXT;
