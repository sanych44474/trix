-- Time- and distance-based personal records (planks, rowing machine, etc.).
-- strength_records previously tracked only weight×reps; these columns let the same table
-- hold the best hold duration (seconds) and best distance (meters), tagged by metric.
ALTER TABLE strength_records ADD COLUMN bestSeconds INTEGER NOT NULL DEFAULT 0;
ALTER TABLE strength_records ADD COLUMN bestMeters  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE strength_records ADD COLUMN metric      TEXT    NOT NULL DEFAULT 'reps';
