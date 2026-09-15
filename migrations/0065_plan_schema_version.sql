-- Backing column for domain/plan-schema.ts's PLAN_SCHEMA_VERSION. Existing rows predate
-- versioning and are stamped 1 (the version toPlan()/parsePlanDoc() currently validate against).
ALTER TABLE plans ADD COLUMN schemaVersion INTEGER NOT NULL DEFAULT 1;
