-- Domain 5 (nutrition) completeness pass. 0069/0070/0072 gave v2_nutrition_days/
-- v2_nutrition_entries/v2_food_references/v2_nutrition_corrections a PARTIAL shadow of
-- src/db/repos/nutrition.ts (enough for the existing projectNutrition dual-write). Comparing
-- every nutrition.ts export's actual column usage against these tables found two real gaps this
-- migration closes, same reasoning/pattern as 0073 (v2Users completeness):
--
--   1. v2_nutrition_days has no `createdAt` -- legacy nutrition_logs.createdAt is a distinct,
--      first-insert-only timestamp (ON CONFLICT never touches it), read back by
--      nutritionLogsSince/NutritionLogDoc.createdAt. Add it as a plain nullable column
--      (v2Nutrition.ts will COALESCE-protect it on every upsert, same discipline as
--      v2Users.stampOnboardedAt).
--   2. Two whole legacy tables nutrition.ts reads/writes have NO v2 table at all yet:
--      `meal_plans` (AI-nutritionist weekly menu + macro targets) and `food_translations`
--      (localized food-name cache). food_cache and food_corrections already have v2 homes
--      (v2_food_references / v2_nutrition_corrections, backfilled in 0070/0072) -- those two
--      are untouched here.

-- ---------- v2_nutrition_days: the missing first-insert timestamp ----------
ALTER TABLE v2_nutrition_days ADD COLUMN createdAt TEXT; -- mirrors nutrition_logs.createdAt (0001)

-- ---------- v2_meal_plans: AI-nutritionist weekly menu + targets (mirrors meal_plans, 0013) ----------
CREATE TABLE IF NOT EXISTS v2_meal_plans (
  accountId   INTEGER NOT NULL REFERENCES v2_accounts(id) ON DELETE CASCADE,
  week        INTEGER NOT NULL DEFAULT 0, -- 0 = current day menu
  days        TEXT    NOT NULL,           -- JSON: [{ label, meals: [...] }] (MealPlanDoc.days)
  targets     TEXT    NOT NULL,           -- JSON NutritionTargets
  generatedAt TEXT    NOT NULL,
  PRIMARY KEY (accountId, week)
);

-- ---------- v2_food_translations: localized food-name cache (mirrors food_translations, 0016) ----------
CREATE TABLE IF NOT EXISTS v2_food_translations (
  en        TEXT NOT NULL, -- lowercased English food name (lookup key)
  lang      TEXT NOT NULL, -- target language code
  name      TEXT NOT NULL, -- localized display name
  createdAt TEXT NOT NULL,
  PRIMARY KEY (en, lang)
);

-- ---------- Idempotent backfill from legacy tables, same pattern as 0069/0070/0072 ----------
UPDATE v2_nutrition_days SET
  createdAt = (SELECT n.createdAt FROM nutrition_logs n WHERE n.userId = v2_nutrition_days.accountId AND n.date = v2_nutrition_days.date)
WHERE EXISTS (SELECT 1 FROM nutrition_logs n WHERE n.userId = v2_nutrition_days.accountId AND n.date = v2_nutrition_days.date);

INSERT OR IGNORE INTO v2_meal_plans (accountId, week, days, targets, generatedAt)
SELECT userId, week, days, targets, generatedAt FROM meal_plans
WHERE json_valid(days) AND json_valid(targets);

INSERT OR IGNORE INTO v2_food_translations (en, lang, name, createdAt)
SELECT en, lang, name, createdAt FROM food_translations;
