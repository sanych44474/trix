-- Domain 3 (workout plans) completeness pass. 0069/0070 gave v2_plans/v2_plan_days/
-- v2_plan_exercises/v2_plan_changes a PARTIAL shadow of src/db/repos/plans.ts +
-- src/db/repos/planChangeLog.ts (enough for the existing projectPlan dual-write). Comparing
-- every plans.ts/planChangeLog.ts export's actual column usage against these tables found
-- several real gaps this migration closes, same reasoning/pattern as 0073/0075/0076:
--
--   1. PlanDoc.active (a required boolean, distinct from `status`) has no column at all.
--   2. PlanDoc.authoredBy (the trainer's account id) has no column -- only the derived
--      `source` ('ai'|'trainer') survives, which cannot tell WHICH trainer authored a plan.
--   3. PlanDoc.methodology/supplements (legacy `plans.methodology`/`plans.supplements`, real
--      dedicated legacy columns) have no v2 column at all -- projectPlan silently drops them.
--   4. PlanDoc's "meta" extras (stepsTarget/restDayNutrition/movementAudit/deloadInterval --
--      legacy packs these into `plans.meta` JSON) have no v2 home. `mesocycle` is the one meta
--      key v2 already promoted to its own column; the rest were never carried over.
--   5. v2_plan_days/v2_plan_exercises only extract a subset of PlanDay/PlanExercise's fields
--      into columns -- sessionType/durationMin/coolDown (day) and isKeyLift/muscles/
--      canonicalName/rpe/rir/rest/tempo/heartRateZone/movementPattern/role/warmupScheme
--      (exercise) have no column and would silently round-trip to nothing.
--   6. THE SERIOUS ONE: 0069's v2_plans backfill hardcoded `version = 1` for every row copied
--      from legacy `plans` (one row per historical plan generation, not one row per account),
--      but v2_plans has `UNIQUE(accountId, version)`. `INSERT OR IGNORE` silently kept only the
--      FIRST (lowest-id, i.e. OLDEST) plan row per account and dropped every later one --
--      including, for any user who has ever regenerated a plan, the row that is actually
--      active today. The live projectPlan (v2Projection.ts) has the exact same bug: it passes
--      `plan.schemaVersion || 1` as `version`, so a second plan for the same account (a fresh
--      `id`, but the same version=1) hits the same UNIQUE(accountId, version) collision.
--      Root cause: `version` was being asked to mean two different things at once -- "this
--      row's data-shape version" (legacy's separate, rarely-changing `schemaVersion` column,
--      migration 0065) and "the Nth plan this account has had" (an ordering concept legacy
--      never needed a column for at all -- it orders by `id`). This migration splits them:
--      `schemaVersion` becomes its own column (mirrors legacy exactly), and `version` becomes
--      a real per-account generation counter, assigned via a correlated-subquery INSERT
--      (`COALESCE(MAX(version) FOR accountId), 0) + 1`) -- same race-avoidance pattern
--      migrations/0075_v2_nutrition_complete.sql's appendMeals uses for `position`, so two
--      concurrent plan saves for the same account serialize on a real next-version number
--      instead of a read-then-write that could collide. v2Plans.ts uses this pattern; this
--      migration's backfill mirrors it with an equivalent correlated COUNT.
--
-- Design for #3-5: same "hot/queried fields get a real column, everything else rides in a
-- full-fidelity JSON escape-hatch column" split as 0073 (v2_profiles.profile) -- `meta` on
-- v2_plans mirrors legacy `plans.meta` (minus `mesocycle`, which stays in its own pre-existing
-- column); `meta` on v2_plan_days/v2_plan_exercises stores the ORIGINAL per-day/per-exercise
-- JSON object from legacy `plans.split` verbatim (day meta has `exercises` stripped, since
-- those live in child rows) rather than hand-picking extra fields -- this is lossless by
-- construction and never needs updating when PlanDay/PlanExercise gains a new optional field.

-- ---------- v2_plans: active/authoredBy/methodology/supplements/meta/schemaVersion ----------
ALTER TABLE v2_plans ADD COLUMN active INTEGER NOT NULL DEFAULT 0;
ALTER TABLE v2_plans ADD COLUMN authoredBy INTEGER;                     -- trainer accountId, NULL = AI (legacy plans.authoredBy)
ALTER TABLE v2_plans ADD COLUMN methodology TEXT NOT NULL DEFAULT '';   -- legacy plans.methodology
ALTER TABLE v2_plans ADD COLUMN supplements TEXT NOT NULL DEFAULT '[]'; -- JSON Supplement[] (legacy plans.supplements)
ALTER TABLE v2_plans ADD COLUMN meta TEXT;                              -- JSON: stepsTarget/restDayNutrition/movementAudit/deloadInterval (legacy plans.meta minus mesocycle)
ALTER TABLE v2_plans ADD COLUMN schemaVersion INTEGER NOT NULL DEFAULT 1; -- PLAN_SCHEMA_VERSION (legacy plans.schemaVersion, migration 0065) -- distinct from `version` (see above)

CREATE INDEX IF NOT EXISTS idx_v2_plans_account_active ON v2_plans(accountId, active);
CREATE INDEX IF NOT EXISTS idx_v2_plans_account_status ON v2_plans(accountId, status);

-- ---------- v2_plan_days / v2_plan_exercises: full-fidelity escape-hatch column ----------
ALTER TABLE v2_plan_days ADD COLUMN meta TEXT;      -- original PlanDay JSON, `exercises` stripped
ALTER TABLE v2_plan_exercises ADD COLUMN meta TEXT; -- original PlanExercise JSON, verbatim

-- ---------- v2_plan_adjustments: bi-weekly adaptive check-in log (mirrors plan_adjustments, 0009) ----------
-- No v2 table existed for this at all (unlike v2_plan_changes, which 0070 already gave a home).
CREATE TABLE IF NOT EXISTS v2_plan_adjustments (
  id        INTEGER PRIMARY KEY,
  accountId INTEGER NOT NULL REFERENCES v2_accounts(id) ON DELETE CASCADE,
  week      INTEGER NOT NULL,
  changes   TEXT    NOT NULL, -- JSON
  createdAt TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_v2_plan_adjustments_account ON v2_plan_adjustments(accountId, createdAt);

-- ---------- v2_plan_bank: pre-generated zero-AI plan bank (mirrors plan_bank, 0017) ----------
-- Static, admin/build-seeded reference data (~144 rows), never written at runtime -- copied via
-- a plain INSERT...SELECT (cheap: reads the existing legacy rows at apply time) rather than
-- duplicating the multi-MB literal seed data into this migration file.
CREATE TABLE IF NOT EXISTS v2_plan_bank (
  id          TEXT PRIMARY KEY,
  goal        TEXT NOT NULL,
  level       TEXT NOT NULL,
  daysBucket  TEXT NOT NULL,
  sex         TEXT NOT NULL,
  equipment   TEXT NOT NULL,
  variant     INTEGER NOT NULL DEFAULT 1,
  plan        TEXT NOT NULL, -- JSON LocalizedBankPlan
  createdAt   TEXT NOT NULL
);

-- ---------- Idempotent backfill from legacy tables, same pattern as 0069/0070/0072/0075 ----------

-- Fix #1-4 + schemaVersion for the v2_plans rows 0069 already inserted (the oldest plan per
-- account, per the version=1 collision explained above). mesocycle is re-derived from legacy
-- meta here too -- 0069 hardcoded it to NULL.
UPDATE v2_plans SET
  active = (SELECT COALESCE(p.active, 0) FROM plans p WHERE p.id = v2_plans.id),
  authoredBy = (SELECT p.authoredBy FROM plans p WHERE p.id = v2_plans.id),
  methodology = (SELECT COALESCE(p.methodology, '') FROM plans p WHERE p.id = v2_plans.id),
  supplements = (SELECT p.supplements FROM plans p WHERE p.id = v2_plans.id AND p.supplements IS NOT NULL AND json_valid(p.supplements)),
  meta = (SELECT json_remove(p.meta, '$.mesocycle') FROM plans p WHERE p.id = v2_plans.id AND p.meta IS NOT NULL AND json_valid(p.meta)),
  mesocycle = (SELECT json_extract(p.meta, '$.mesocycle') FROM plans p WHERE p.id = v2_plans.id AND p.meta IS NOT NULL AND json_valid(p.meta)),
  schemaVersion = (SELECT COALESCE(p.schemaVersion, 1) FROM plans p WHERE p.id = v2_plans.id)
WHERE EXISTS (SELECT 1 FROM plans p WHERE p.id = v2_plans.id);

-- Insert every legacy plan row 0069 dropped (any id not already in v2_plans), with a `version`
-- computed the same way -- COUNT of that account's plans with id <= this one -- so it lands on
-- exactly the sequence number the surviving version=1 row above already occupies for the oldest
-- plan, and a unique, correctly-ordered number for every plan after it.
INSERT OR IGNORE INTO v2_plans (id, accountId, version, schemaVersion, status, source, active, authoredBy, nutrition, supplements, methodology, meta, mesocycle, createdAt, updatedAt)
SELECT
  p.id, p.userId,
  (SELECT COUNT(*) FROM plans p2 WHERE p2.userId = p.userId AND p2.id <= p.id),
  COALESCE(p.schemaVersion, 1),
  COALESCE(p.status, CASE WHEN p.active = 1 THEN 'active' ELSE 'draft' END),
  CASE WHEN p.authoredBy IS NULL THEN 'ai' ELSE 'trainer' END,
  COALESCE(p.active, 0),
  p.authoredBy,
  p.nutrition,
  CASE WHEN p.supplements IS NOT NULL AND json_valid(p.supplements) THEN p.supplements ELSE '[]' END,
  COALESCE(p.methodology, ''),
  CASE WHEN p.meta IS NOT NULL AND json_valid(p.meta) THEN json_remove(p.meta, '$.mesocycle') ELSE NULL END,
  CASE WHEN p.meta IS NOT NULL AND json_valid(p.meta) THEN json_extract(p.meta, '$.mesocycle') ELSE NULL END,
  p.generatedAt, p.generatedAt
FROM plans p
WHERE NOT EXISTS (SELECT 1 FROM v2_plans vp WHERE vp.id = p.id);

-- v2_plan_days/v2_plan_exercises were already backfilled by 0069 for EVERY legacy plan id
-- (unconditionally, not gated on the parent v2_plans row existing) -- so the INSERT above just
-- gave the previously-orphaned rows a parent; only `meta` is missing on all of them.
UPDATE v2_plan_days SET meta = (
  SELECT json_remove(d.value, '$.exercises')
  FROM plans p, json_each(p.split) d
  WHERE json_valid(p.split)
    AND p.id * 10 + CAST(json_extract(d.value, '$.weekday') AS INTEGER) = v2_plan_days.id
  LIMIT 1
)
WHERE EXISTS (
  SELECT 1 FROM plans p, json_each(p.split) d
  WHERE json_valid(p.split)
    AND p.id * 10 + CAST(json_extract(d.value, '$.weekday') AS INTEGER) = v2_plan_days.id
);

UPDATE v2_plan_exercises SET meta = (
  SELECT e.value
  FROM plans p, json_each(p.split) d, json_each(json_extract(d.value, '$.exercises')) e
  WHERE json_valid(p.split)
    AND p.id * 10 + CAST(json_extract(d.value, '$.weekday') AS INTEGER) = v2_plan_exercises.dayId
    AND CAST(e.key AS INTEGER) = v2_plan_exercises.position
  LIMIT 1
)
WHERE EXISTS (
  SELECT 1 FROM plans p, json_each(p.split) d, json_each(json_extract(d.value, '$.exercises')) e
  WHERE json_valid(p.split)
    AND p.id * 10 + CAST(json_extract(d.value, '$.weekday') AS INTEGER) = v2_plan_exercises.dayId
    AND CAST(e.key AS INTEGER) = v2_plan_exercises.position
);

INSERT OR IGNORE INTO v2_plan_adjustments (id, accountId, week, changes, createdAt)
SELECT id, userId, week, changes, ts FROM plan_adjustments;

INSERT OR IGNORE INTO v2_plan_bank (id, goal, level, daysBucket, sex, equipment, variant, plan, createdAt)
SELECT id, goal, level, days_bucket, sex, equipment, variant, plan, createdAt FROM plan_bank;
