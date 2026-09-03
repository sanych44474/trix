-- Rich trainer profiles: specialization, pricing, location, languages, photo, ratings.
-- Powers the enhanced directory (filters + cards) and feeds trainer-style AI plan drafts.

ALTER TABLE trainers ADD COLUMN specialization  TEXT;
ALTER TABLE trainers ADD COLUMN tags            TEXT;    -- CSV of canonical codes: strength,fatloss,rehab,...
ALTER TABLE trainers ADD COLUMN certifications  TEXT;
ALTER TABLE trainers ADD COLUMN experienceYears INTEGER;
ALTER TABLE trainers ADD COLUMN approach        TEXT;
ALTER TABLE trainers ADD COLUMN priceOnline     INTEGER;
ALTER TABLE trainers ADD COLUMN priceOffline    INTEGER;
ALTER TABLE trainers ADD COLUMN currency        TEXT;    -- 'UAH' | 'USD' | 'EUR'
ALTER TABLE trainers ADD COLUMN city            TEXT;    -- offline location
ALTER TABLE trainers ADD COLUMN contact         TEXT;    -- booking contact; fallback to @username
ALTER TABLE trainers ADD COLUMN languages       TEXT;    -- CSV: uk,en,ru
ALTER TABLE trainers ADD COLUMN photoFileId     TEXT;    -- Telegram file_id (re-sendable)
ALTER TABLE trainers ADD COLUMN profileComplete INTEGER NOT NULL DEFAULT 0;
ALTER TABLE trainers ADD COLUMN ratingSum       INTEGER NOT NULL DEFAULT 0;
ALTER TABLE trainers ADD COLUMN ratingCount     INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_trainers_listed ON trainers(status, accepting, profileComplete);
