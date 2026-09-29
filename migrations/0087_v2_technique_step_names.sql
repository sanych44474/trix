-- The exercise library (Mini App) shows each free-exercise-db exercise under a name in the user's
-- language; the name is translated in the same AI call as the technique steps and cached with them.
ALTER TABLE v2_technique_steps ADD COLUMN name TEXT;
