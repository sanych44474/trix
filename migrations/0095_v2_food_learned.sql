-- Foods the app has learned from external lookups (FatSecret, Open Food Facts, barcode scans, AI
-- product lookups): each result a user saw is kept here so the same search or barcode next time
-- is answered locally -- no external call, no AI call -- and the local food base keeps growing
-- with what people actually eat (src/adapters/d1/v2FoodLearned.ts).
CREATE TABLE IF NOT EXISTS v2_food_learned (
  id TEXT PRIMARY KEY,             -- normalised "name|brand"
  name TEXT NOT NULL,
  brand TEXT NOT NULL DEFAULT '',
  barcode TEXT,                    -- EAN/GTIN digits when it came from a scan
  kcal REAL NOT NULL,
  protein REAL NOT NULL,
  fat REAL NOT NULL,
  carbs REAL NOT NULL,
  source TEXT NOT NULL,            -- fatsecret | off | ai
  hits INTEGER NOT NULL DEFAULT 0, -- times picked and logged; ranks results
  updatedAt TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_v2_food_learned_barcode ON v2_food_learned(barcode) WHERE barcode IS NOT NULL;

-- Word index for search without a full scan: one row per (word, food). A search reads the rows
-- of its first word's stem by index range, then filters the candidates by the other words.
-- (A plain table rather than FTS5: `wrangler d1 export`, used by scripts/backup-d1.mjs, can't
-- export virtual tables.)
CREATE TABLE IF NOT EXISTS v2_food_learned_words (
  word TEXT NOT NULL,
  foodId TEXT NOT NULL REFERENCES v2_food_learned(id) ON DELETE CASCADE,
  PRIMARY KEY (word, foodId)
);
