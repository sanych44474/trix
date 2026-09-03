-- Per-user food macro corrections.
-- When a user edits the КБЖУ of a logged meal item the corrected per-100g values are
-- stored here and applied automatically on every subsequent lookup for the same food query.
CREATE TABLE IF NOT EXISTS food_corrections (
  userId  INTEGER NOT NULL,
  query   TEXT    NOT NULL,  -- canonical English food name (same key as food_cache)
  per100g TEXT    NOT NULL,  -- JSON: {kcal,protein,fats,carbs}
  ts      TEXT    NOT NULL,
  PRIMARY KEY (userId, query)
);
