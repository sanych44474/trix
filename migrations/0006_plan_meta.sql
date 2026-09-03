-- Store plan-level extras (stepsTarget, rest-day macros, movement audit) as JSON.
-- These have no dedicated columns; without this they are lost on reload from D1.
ALTER TABLE plans ADD COLUMN meta TEXT;
