-- Learned muscles for exercise names the body map's rules don't recognise (someone's own
-- exercise, a club-specific machine). Classified once -- catalog match first, AI otherwise --
-- by src/exerciseMuscleLearning.ts, and read back into domain/exerciseMuscles.ts so the body map,
-- the region list, quests and the weekly digest all count the exercise. primaryMuscles='[]'
-- with source='none' is a negative cache: tried, couldn't classify, don't retry every hour.
CREATE TABLE IF NOT EXISTS v2_exercise_muscles (
  normalizedName   TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  primaryMuscles   TEXT NOT NULL,             -- JSON Slug[]
  secondaryMuscles TEXT NOT NULL DEFAULT '[]', -- JSON Slug[]
  source           TEXT NOT NULL,             -- catalog | ai | none
  createdAt        TEXT NOT NULL
);
