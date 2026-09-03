-- System-computed training-pace attribute, re-evaluated weekly from log success rate.
-- 'slow' | 'normal' | 'fast'. (sleepSchedule lives in the profile JSON, set during the
-- AI-driven onboarding interview, so it needs no dedicated column.)
ALTER TABLE users ADD COLUMN progression_rate TEXT NOT NULL DEFAULT 'normal';
