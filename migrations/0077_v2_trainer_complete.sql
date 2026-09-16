-- Domain 7 (trainer relationships/requests/questions/templates/client cards/notes/messages/
-- prospects) completeness pass. 0072 gave v2_trainers only the base columns (status, inviteCode,
-- name, bio, accepting, createdAt, approvedAt) -- everything src/db/repos/trainer.ts's
-- TrainerDoc/TrainerProfileInput actually carry (rich profile from 0025, maxClients from 0042,
-- isInstructor from 0044) was missing. This migration adds those columns plus the two remaining
-- trainer-domain tables that had no v2 home yet: v2_client_note_history (0054) and
-- v2_shared_programs (0045). legacy trainers.ratingSum/ratingCount are intentionally NOT ported:
-- dead columns from the dropped marketplace-reviews feature (0053), unused by any exported
-- trainer.ts function or TrainerDoc field.

ALTER TABLE v2_trainers ADD COLUMN specialization  TEXT;
ALTER TABLE v2_trainers ADD COLUMN tags            TEXT;
ALTER TABLE v2_trainers ADD COLUMN certifications  TEXT;
ALTER TABLE v2_trainers ADD COLUMN experienceYears INTEGER;
ALTER TABLE v2_trainers ADD COLUMN approach        TEXT;
ALTER TABLE v2_trainers ADD COLUMN priceOnline     INTEGER;
ALTER TABLE v2_trainers ADD COLUMN priceOffline    INTEGER;
ALTER TABLE v2_trainers ADD COLUMN currency        TEXT;
ALTER TABLE v2_trainers ADD COLUMN city            TEXT;
ALTER TABLE v2_trainers ADD COLUMN contact         TEXT;
ALTER TABLE v2_trainers ADD COLUMN languages       TEXT;
ALTER TABLE v2_trainers ADD COLUMN photoFileId     TEXT;
ALTER TABLE v2_trainers ADD COLUMN profileComplete INTEGER NOT NULL DEFAULT 0;
ALTER TABLE v2_trainers ADD COLUMN maxClients      INTEGER;
ALTER TABLE v2_trainers ADD COLUMN isInstructor    INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS v2_client_note_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trainerId INTEGER NOT NULL REFERENCES v2_accounts(id) ON DELETE CASCADE,
  clientId INTEGER NOT NULL REFERENCES v2_accounts(id) ON DELETE CASCADE,
  field TEXT NOT NULL, -- "note" | "healthNotes" | "personalNotes"
  value TEXT NOT NULL,
  savedAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_v2_note_history_lookup ON v2_client_note_history(trainerId, clientId, field, savedAt);

-- "share a program": link (isPublic 0) or public library (isPublic 1) — see 0045.
CREATE TABLE IF NOT EXISTS v2_shared_programs (
  code TEXT PRIMARY KEY,
  ownerId INTEGER NOT NULL REFERENCES v2_accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  plan TEXT NOT NULL,
  isPublic INTEGER NOT NULL DEFAULT 0,
  takenCount INTEGER NOT NULL DEFAULT 0,
  createdAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_v2_shared_public ON v2_shared_programs(isPublic, createdAt);

-- Backfill the new v2_trainers columns for rows 0072 already inserted (correlated subquery per
-- column, same style as 0069/0070's json_extract backfills — no UPDATE...FROM, kept portable).
UPDATE v2_trainers SET
  specialization  = (SELECT specialization  FROM trainers WHERE trainers.trainerId = v2_trainers.accountId),
  tags            = (SELECT tags            FROM trainers WHERE trainers.trainerId = v2_trainers.accountId),
  certifications  = (SELECT certifications  FROM trainers WHERE trainers.trainerId = v2_trainers.accountId),
  experienceYears = (SELECT experienceYears FROM trainers WHERE trainers.trainerId = v2_trainers.accountId),
  approach        = (SELECT approach        FROM trainers WHERE trainers.trainerId = v2_trainers.accountId),
  priceOnline     = (SELECT priceOnline     FROM trainers WHERE trainers.trainerId = v2_trainers.accountId),
  priceOffline    = (SELECT priceOffline    FROM trainers WHERE trainers.trainerId = v2_trainers.accountId),
  currency        = (SELECT currency        FROM trainers WHERE trainers.trainerId = v2_trainers.accountId),
  city            = (SELECT city            FROM trainers WHERE trainers.trainerId = v2_trainers.accountId),
  contact         = (SELECT contact         FROM trainers WHERE trainers.trainerId = v2_trainers.accountId),
  languages       = (SELECT languages       FROM trainers WHERE trainers.trainerId = v2_trainers.accountId),
  photoFileId     = (SELECT photoFileId     FROM trainers WHERE trainers.trainerId = v2_trainers.accountId),
  profileComplete = COALESCE((SELECT profileComplete FROM trainers WHERE trainers.trainerId = v2_trainers.accountId), 0),
  maxClients      = (SELECT maxClients      FROM trainers WHERE trainers.trainerId = v2_trainers.accountId),
  isInstructor    = COALESCE((SELECT isInstructor    FROM trainers WHERE trainers.trainerId = v2_trainers.accountId), 0)
WHERE EXISTS (SELECT 1 FROM trainers WHERE trainers.trainerId = v2_trainers.accountId);

INSERT OR IGNORE INTO v2_client_note_history (id, trainerId, clientId, field, value, savedAt)
SELECT id, trainerId, clientId, field, value, savedAt FROM client_note_history;

INSERT OR IGNORE INTO v2_shared_programs (code, ownerId, name, plan, isPublic, takenCount, createdAt)
SELECT code, ownerId, name, plan, isPublic, takenCount, createdAt FROM shared_programs;
