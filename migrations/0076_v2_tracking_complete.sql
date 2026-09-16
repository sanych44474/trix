-- Domain 6 (tracking: measurements/wellbeing/water/steps/injuries/progress photos) completeness
-- pass. 0069/0070/0072 gave v2_measurements/v2_wellbeing/v2_water_logs/v2_step_logs/v2_injuries/
-- v2_progress_photos a PARTIAL shadow of src/db/repos/tracking.ts (enough for the parity-count
-- checks in scripts/verify-v2-backfill.mjs). Comparing every in-scope tracking.ts export's actual
-- column usage against these tables found two real gaps this migration closes, same
-- reasoning/pattern as 0073 (v2Users) and 0075 (v2Nutrition):
--
--   1. v2_measurements has no `createdAt` -- legacy body_logs.createdAt is a distinct,
--      first-insert-only timestamp (BodyLogDoc.createdAt / ON CONFLICT never touches it in
--      upsertBodyLog). Add it as a plain column, backfilled from body_logs, defaulted for the
--      (rare) row with no legacy counterpart.
--   2. v2_injuries is missing two columns InjuryDoc actually needs: `lastAskedAt` (dedup for the
--      once-a-day follow-up nudge, legacy 0034) and `checkinsHistory` (pain-score trend, legacy
--      0046). Both round-trip through v2Tracking.ts's toInjury()/markInjuryAsked()/
--      appendInjuryCheckin() exactly like the legacy columns they mirror.
--
-- v2_water_logs/v2_step_logs (0072) already match water_logs/step_logs column-for-column and need
-- no changes. v2_wellbeing (0069) already matches daily_checkins column-for-column. v2_progress_photos
-- (0070) already has everything ProgressPhotoRow needs (legacyFileId is the legacy fileId column;
-- objectKey stays NULL/unused here -- it belongs to the R2-native upload path in
-- src/webapp/photoStorage.ts, out of scope for this domain).
--
-- NOTE on v2_activity_days (0070): this table is a separate per-day (accountId, date) rollup of
-- steps+water in ONE row, distinct in shape from v2_water_logs/v2_step_logs (one row per metric,
-- matching legacy's two separate tables and addWater's increment-in-place semantics). No projector
-- or write path populates v2_activity_days today, and v2Tracking.ts does not write it either --
-- it appears intended for a future aggregate reader (dashboard/admin), not as the domain's source
-- of truth for individual water/step logs. Left untouched.

-- ---------- v2_measurements: the missing first-insert timestamp ----------
ALTER TABLE v2_measurements ADD COLUMN createdAt TEXT; -- mirrors body_logs.createdAt (0001)

-- ---------- v2_injuries: follow-up dedup + pain-score history ----------
ALTER TABLE v2_injuries ADD COLUMN lastAskedAt TEXT;                         -- mirrors injuries.lastAskedAt (0034)
ALTER TABLE v2_injuries ADD COLUMN checkinsHistory TEXT NOT NULL DEFAULT '[]'; -- mirrors injuries.checkinsHistory (0046)

CREATE INDEX IF NOT EXISTS idx_v2_progress_photos_account_taken ON v2_progress_photos(accountId, takenAt DESC); -- mirrors idx_progress_photos_user (0048)

-- ---------- Idempotent backfill from legacy tables, same pattern as 0069/0070/0072/0073/0075 ----------
UPDATE v2_measurements SET
  createdAt = (SELECT b.createdAt FROM body_logs b WHERE b.userId = v2_measurements.accountId AND b.date = v2_measurements.date)
WHERE EXISTS (SELECT 1 FROM body_logs b WHERE b.userId = v2_measurements.accountId AND b.date = v2_measurements.date);

UPDATE v2_injuries SET
  lastAskedAt = (SELECT i.lastAskedAt FROM injuries i WHERE i.id = v2_injuries.id),
  checkinsHistory = (SELECT COALESCE(i.checkinsHistory, '[]') FROM injuries i WHERE i.id = v2_injuries.id AND (i.checkinsHistory IS NULL OR json_valid(i.checkinsHistory)))
WHERE EXISTS (SELECT 1 FROM injuries i WHERE i.id = v2_injuries.id);
