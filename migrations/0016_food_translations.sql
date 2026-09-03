-- Cached translations of food product names (en → localized), so the meal plan shows
-- consistent localized names instantly and avoids re-translating the same foods every render.
-- Keyed by the lowercased English name + lang. Seeded for the curated catalog; self-fills for
-- any new food name on first meal-plan render.
CREATE TABLE IF NOT EXISTS food_translations (
  en        TEXT NOT NULL,   -- lowercased English food name (lookup key)
  lang      TEXT NOT NULL,   -- target language code
  name      TEXT NOT NULL,   -- localized display name
  createdAt TEXT NOT NULL,
  PRIMARY KEY (en, lang)
);
