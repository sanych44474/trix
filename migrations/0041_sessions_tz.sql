-- 0041: timezone-aware sessions + optional online meeting link. `tz` stores the IANA zone
-- the (date, hour) was booked in — render converts for the other party; NULL keeps the v1
-- same-city assumption (both parties read the stored local time as-is).
-- Apply manually: npx wrangler d1 execute trix --remote --file migrations/0041_sessions_tz.sql

ALTER TABLE sessions ADD COLUMN tz TEXT;
ALTER TABLE sessions ADD COLUMN meetingLink TEXT;
