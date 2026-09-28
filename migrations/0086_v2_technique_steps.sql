-- Step-by-step technique for the logger's technique pictures (free-exercise-db, whose instructions
-- are English only): each exercise's steps are condensed/translated by the AI once per language
-- and kept here, so every later open is a single row read (src/webapp/techniqueSteps.ts).
CREATE TABLE IF NOT EXISTS v2_technique_steps (
  exerciseId TEXT NOT NULL,        -- free-exercise-db id (= image folder)
  lang TEXT NOT NULL,              -- uk | en
  steps TEXT NOT NULL,             -- JSON array of short steps
  createdAt TEXT NOT NULL,
  PRIMARY KEY (exerciseId, lang)
);
