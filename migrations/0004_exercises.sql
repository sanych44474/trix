-- API Ninjas exercise catalog (seeded once, occasionally refreshed) + per-language
-- on-demand translation cache. English instructions/safety_info are canonical; non-English
-- strings are AI-translated lazily on first "how to do it" view.

CREATE TABLE IF NOT EXISTS exercises (
  id           TEXT PRIMARY KEY,           -- stable hash of lower(name) (API returns no id)
  name         TEXT NOT NULL,              -- canonical English name
  type         TEXT,
  muscle       TEXT NOT NULL,              -- one of the 16 API muscle enums
  difficulty   TEXT,                       -- beginner | intermediate | expert
  equipments   TEXT NOT NULL DEFAULT '[]', -- JSON string[]
  instructions TEXT NOT NULL DEFAULT '',
  safety_info  TEXT NOT NULL DEFAULT '',
  fetchedAt    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_exercises_muscle ON exercises(muscle, difficulty);

CREATE TABLE IF NOT EXISTS exercise_translations (
  exerciseId   TEXT NOT NULL,
  lang         TEXT NOT NULL,              -- 'uk' (en is served from the source row)
  name         TEXT NOT NULL,
  instructions TEXT NOT NULL,
  safety_info  TEXT NOT NULL,
  createdAt    TEXT NOT NULL,
  PRIMARY KEY (exerciseId, lang)
);
