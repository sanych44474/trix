-- AI nutritionist: generated menus + a cache of USDA/Open Food Facts per-100g lookups
-- (foods like chicken/rice recur across meals/days; caching cuts repeat subrequests and
-- respects the USDA rate limit + the free-plan ~50-subrequest-per-invocation cap).
CREATE TABLE IF NOT EXISTS meal_plans (
  userId      INTEGER NOT NULL,
  week        INTEGER NOT NULL DEFAULT 0,  -- 0 = current day menu
  days        TEXT    NOT NULL,            -- JSON: [{ label, meals: [...] }]
  targets     TEXT    NOT NULL,            -- JSON NutritionTargets
  generatedAt TEXT    NOT NULL,
  PRIMARY KEY (userId, week)
);

CREATE TABLE IF NOT EXISTS food_cache (
  query    TEXT PRIMARY KEY,  -- lowercased food query
  per100g  TEXT NOT NULL,     -- JSON { source, kcal, protein, fats, carbs }
  ts       TEXT NOT NULL
);
