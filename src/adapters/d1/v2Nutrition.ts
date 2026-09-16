// v2-native nutrition repo (Domain 5 of the v2 cutover — see docs/adr/0001-v2-seams-and-staged-
// cutover.md). Faithful port of src/db/repos/nutrition.ts: same exported names/signatures (so a
// call site switches by changing one import), same filters/ordering/edge cases — but reads/
// writes ONLY v2_nutrition_days/v2_nutrition_entries (day logs), v2_meal_plans (AI-nutritionist
// weekly menu), v2_food_references (USDA/OFF per-100g cache), v2_food_translations (localized
// food-name cache) and v2_nutrition_corrections (per-user macro overrides) — see
// migrations/0075_v2_nutrition_complete.sql for the completeness pass that gave the first two
// tables the columns this module needs (v2_nutrition_days.createdAt) and gave the last two
// tables their first v2 home (v2_meal_plans, v2_food_translations; v2_food_references and
// v2_nutrition_corrections already existed, backfilled in 0070/0072).
import type { MealEntry, MealPlanDoc, NutritionLogDoc } from "../../types";
import { nowIso, safeJsonParse, type DB } from "../../db/repos/shared";

// ---------- nutrition logs (day meals) ----------

// Same atomic-UPSERT reasoning as legacy appendMeals (src/db/repos/nutrition.ts) — two
// concurrent appends for the same (accountId, date) must not race a read-then-write. A plain
// "SELECT MAX(position) then INSERT" would reopen exactly the race the legacy json_set chain was
// written to close (two concurrent appends could read the same max and collide on the
// UNIQUE(accountId, date, position) constraint), so each INSERT recomputes its own position from
// a correlated subquery instead of a value computed outside the batch — that subquery re-reads
// current state at the moment THAT statement runs, so later statements in the same batch see
// earlier ones' inserts, and two concurrent requests' batches (each its own D1 transaction)
// serialize rather than interleave. Net effect: no read-modify-write window, same guarantee as
// legacy's single atomic UPSERT, without needing every meal to be inside one SQL expression.
export async function appendMeals(
  db: DB,
  userId: number,
  date: string,
  meals: MealEntry[],
): Promise<MealEntry[]> {
  const now = nowIso();
  const statements: D1PreparedStatement[] = [
    // createdAt is COALESCE-protected (first-insert-only) simply by never appearing in the
    // ON CONFLICT SET clause — same discipline as v2Users.stampOnboardedAt.
    db.prepare(
      `INSERT INTO v2_nutrition_days (accountId, date, target, createdAt, updatedAt) VALUES (?, ?, NULL, ?, ?)
       ON CONFLICT(accountId, date) DO UPDATE SET updatedAt = excluded.updatedAt`,
    ).bind(userId, date, now, now),
    ...meals.map((meal) =>
      db.prepare(
        `INSERT INTO v2_nutrition_entries (accountId, date, position, description, grams, kcal, protein, fats, carbs, source)
         SELECT ?, ?, COALESCE((SELECT MAX(position) FROM v2_nutrition_entries WHERE accountId = ? AND date = ?), -1) + 1, ?, ?, ?, ?, ?, ?, ?`,
      ).bind(userId, date, userId, date, meal.desc, meal.grams ?? null, meal.kcal, meal.protein, meal.fats, meal.carbs, meal.query ?? null),
    ),
  ];
  await db.batch(statements);
  // Re-read for the caller's convenience, same reasoning as legacy — happens AFTER the write.
  return getDayMeals(db, userId, date);
}

// Overwrite a day's meals (used by in-place edits). Deletes the day row if the list is empty —
// same as legacy setDayMeals. Single batch: delete-all-entries + reinsert is atomic here, so
// there is no window where a concurrent read sees a partially-written day (same guarantee
// projectNutrition's DELETE-then-reinsert already relies on for this exact table pair).
export async function setDayMeals(db: DB, userId: number, date: string, meals: MealEntry[]): Promise<void> {
  if (!meals.length) {
    await db.batch([
      db.prepare("DELETE FROM v2_nutrition_entries WHERE accountId = ? AND date = ?").bind(userId, date),
      db.prepare("DELETE FROM v2_nutrition_days WHERE accountId = ? AND date = ?").bind(userId, date),
    ]);
    return;
  }
  const now = nowIso();
  await db.batch([
    db.prepare(
      `INSERT INTO v2_nutrition_days (accountId, date, target, createdAt, updatedAt) VALUES (?, ?, NULL, ?, ?)
       ON CONFLICT(accountId, date) DO UPDATE SET updatedAt = excluded.updatedAt`,
    ).bind(userId, date, now, now),
    db.prepare("DELETE FROM v2_nutrition_entries WHERE accountId = ? AND date = ?").bind(userId, date),
    ...meals.map((meal, position) =>
      db.prepare(
        `INSERT INTO v2_nutrition_entries (accountId, date, position, description, grams, kcal, protein, fats, carbs, source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(userId, date, position, meal.desc, meal.grams ?? null, meal.kcal, meal.protein, meal.fats, meal.carbs, meal.query ?? null),
    ),
  ]);
}

function toMealEntry(r: { description: string; grams: number | null; kcal: number; protein: number; fats: number; carbs: number; source: string | null }): MealEntry {
  return {
    desc: r.description,
    kcal: r.kcal,
    protein: r.protein,
    fats: r.fats,
    carbs: r.carbs,
    ...(r.grams != null ? { grams: r.grams } : {}),
    ...(r.source != null ? { query: r.source } : {}),
  };
}

// Recent distinct foods (for one-tap re-log), most-recent first, deduped by name — same
// normalization (strip a trailing "(~123 g)"-style portion suffix) as legacy getRecentFoods.
export async function getRecentFoods(db: DB, userId: number, sinceDate: string, limit = 12): Promise<MealEntry[]> {
  const r = await db
    .prepare(
      `SELECT description, grams, kcal, protein, fats, carbs, source FROM v2_nutrition_entries
       WHERE accountId = ? AND date >= ? ORDER BY date DESC, position ASC`,
    )
    .bind(userId, sinceDate)
    .all<{ description: string; grams: number | null; kcal: number; protein: number; fats: number; carbs: number; source: string | null }>();
  const seen = new Set<string>();
  const out: MealEntry[] = [];
  for (const row of r.results ?? []) {
    const key = (row.description || "").toLowerCase().replace(/[~(]?\s*\d.*$/u, "").trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(toMealEntry(row));
    if (out.length >= limit) return out;
  }
  return out;
}

export async function getDayMeals(db: DB, userId: number, date: string): Promise<MealEntry[]> {
  const r = await db
    .prepare(
      `SELECT description, grams, kcal, protein, fats, carbs, source FROM v2_nutrition_entries
       WHERE accountId = ? AND date = ? ORDER BY position ASC`,
    )
    .bind(userId, date)
    .all<{ description: string; grams: number | null; kcal: number; protein: number; fats: number; carbs: number; source: string | null }>();
  return (r.results ?? []).map(toMealEntry);
}

// Remove one logged item by index from a day; deletes the day row if it becomes empty. Returns
// the rest. Positions are renumbered (0..n-1) after the delete so a later appendMeals still
// appends contiguously — legacy's array splice does this implicitly.
export async function deleteMealItem(db: DB, userId: number, date: string, index: number): Promise<MealEntry[]> {
  const meals = await getDayMeals(db, userId, date);
  if (index < 0 || index >= meals.length) return meals;
  meals.splice(index, 1);
  await setDayMeals(db, userId, date, meals);
  return meals;
}

export async function nutritionLogsSince(db: DB, userId: number, cutoff: string): Promise<NutritionLogDoc[]> {
  const days = await db
    .prepare("SELECT date, createdAt, updatedAt FROM v2_nutrition_days WHERE accountId = ? AND date >= ?")
    .bind(userId, cutoff)
    .all<{ date: string; createdAt: string | null; updatedAt: string }>();
  const out: NutritionLogDoc[] = [];
  for (const day of days.results ?? []) {
    const meals = await getDayMeals(db, userId, day.date);
    out.push({
      userId,
      date: day.date,
      meals,
      createdAt: new Date(day.createdAt ?? day.updatedAt),
      updatedAt: new Date(day.updatedAt),
    });
  }
  return out;
}

/** ALL users' nutrition-log (userId, date) pairs on/after `sinceDate` — bulk compliance
 * counting for the trainer dashboard without a query per client. */
export async function allNutritionDatesSince(db: DB, sinceDate: string): Promise<{ userId: number; date: string }[]> {
  const r = await db
    .prepare("SELECT accountId AS userId, date FROM v2_nutrition_days WHERE date >= ?")
    .bind(sinceDate)
    .all<{ userId: number; date: string }>();
  return r.results ?? [];
}

// ---------- food name translations (cache) ----------

/** Localized names for the given English food names (lowercased keys). Returns en→name map. */
export async function getFoodTranslations(db: DB, names: string[], lang: string): Promise<Map<string, string>> {
  const keys = [...new Set(names.map((n) => n.toLowerCase().trim()).filter(Boolean))];
  const map = new Map<string, string>();
  if (!keys.length) return map;
  const placeholders = keys.map(() => "?").join(",");
  const r = await db
    .prepare(`SELECT en, name FROM v2_food_translations WHERE lang = ? AND en IN (${placeholders})`)
    .bind(lang, ...keys)
    .all<{ en: string; name: string }>();
  for (const row of r.results ?? []) map.set(row.en, row.name);
  return map;
}

/** Cache localized food names. `items` keys are English names (any case); stored lowercased. */
export async function upsertFoodTranslations(db: DB, lang: string, items: { en: string; name: string }[]): Promise<void> {
  const rows = items.filter((it) => it.en && it.name);
  if (!rows.length) return;
  const now = nowIso();
  const batch = rows.map((it) =>
    db
      .prepare(
        `INSERT INTO v2_food_translations (en, lang, name, createdAt) VALUES (?, ?, ?, ?)
         ON CONFLICT(en, lang) DO UPDATE SET name = excluded.name`,
      )
      .bind(it.en.toLowerCase().trim(), lang, it.name, now),
  );
  await db.batch(batch);
}

// ---------- meal plans (AI nutritionist) + USDA/OFF lookup cache ----------

export async function saveMealPlan(db: DB, plan: MealPlanDoc): Promise<void> {
  await db
    .prepare(
      `INSERT INTO v2_meal_plans (accountId, week, days, targets, generatedAt) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(accountId, week) DO UPDATE SET days = excluded.days, targets = excluded.targets, generatedAt = excluded.generatedAt`,
    )
    .bind(plan.userId, plan.week, JSON.stringify(plan.days), JSON.stringify(plan.targets), nowIso())
    .run();
}

export async function getMealPlan(db: DB, userId: number, week = 0): Promise<MealPlanDoc | null> {
  const r = await db
    .prepare("SELECT * FROM v2_meal_plans WHERE accountId = ? AND week = ?")
    .bind(userId, week)
    .first<{ accountId: number; week: number; days: string; targets: string; generatedAt: string }>();
  if (!r) return null;
  const days = safeJsonParse<MealPlanDoc["days"] | null>(r.days, null);
  const targets = safeJsonParse<MealPlanDoc["targets"] | null>(r.targets, null);
  return days && targets ? { userId: r.accountId, week: r.week, days, targets, generatedAt: new Date(r.generatedAt) } : null;
}

// v2_food_references.id is the same lowercased-query key legacy food_cache.query used (see
// 0072's backfill: id = query). name/source have no equivalent on the legacy food_cache call
// sites (getFoodCache/putFoodCache only ever dealt with query -> per100g) -- populated the same
// way the 0072 backfill did, so a row written here looks identical to a backfilled one.
export async function getFoodCache(db: DB, query: string): Promise<unknown | null> {
  const r = await db.prepare("SELECT per100g FROM v2_food_references WHERE id = ?").bind(query.toLowerCase()).first<{ per100g: string }>();
  return r ? safeJsonParse<unknown>(r.per100g, null) : null;
}

export async function putFoodCache(db: DB, query: string, per100g: unknown): Promise<void> {
  const q = query.toLowerCase();
  const source = (per100g && typeof per100g === "object" && "source" in per100g && typeof (per100g as { source: unknown }).source === "string")
    ? (per100g as { source: string }).source
    : "legacy";
  await db
    .prepare(
      `INSERT INTO v2_food_references (id, name, brand, per100g, source, updatedAt) VALUES (?, ?, NULL, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET per100g = excluded.per100g, source = excluded.source, updatedAt = excluded.updatedAt`,
    )
    .bind(q, q, JSON.stringify(per100g), source, nowIso())
    .run();
}

// ---------- per-user food macro corrections ----------

export async function getUserFoodCorrection(db: DB, userId: number, query: string): Promise<{ kcal: number; protein: number; fats: number; carbs: number } | null> {
  const r = await db
    .prepare("SELECT per100g FROM v2_nutrition_corrections WHERE accountId = ? AND query = ?")
    .bind(userId, query.trim().toLowerCase())
    .first<{ per100g: string }>();
  return r ? safeJsonParse<{ kcal: number; protein: number; fats: number; carbs: number } | null>(r.per100g, null) : null;
}

export async function putUserFoodCorrection(db: DB, userId: number, query: string, per100g: { kcal: number; protein: number; fats: number; carbs: number }): Promise<void> {
  await db
    .prepare(
      `INSERT INTO v2_nutrition_corrections (accountId, query, per100g, updatedAt) VALUES (?, ?, ?, ?)
       ON CONFLICT(accountId, query) DO UPDATE SET per100g = excluded.per100g, updatedAt = excluded.updatedAt`,
    )
    .bind(userId, query.trim().toLowerCase(), JSON.stringify(per100g), nowIso())
    .run();
}
