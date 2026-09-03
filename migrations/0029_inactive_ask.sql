-- Owner-triggered "are you still here?" re-engagement ask for inactive users. Asked once per user;
-- the reply ('leaving' = wants removal) is surfaced to the owner in /cleanup. NOT auto-sent.

ALTER TABLE users ADD COLUMN inactiveAskedAt TEXT;  -- ISO when the ask was sent (dedup: ask once)
ALTER TABLE users ADD COLUMN inactiveReply   TEXT;  -- 'leaving' = user asked to be removed; else null
