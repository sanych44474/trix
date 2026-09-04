// Nutrition logs (meals per day), the AI-nutritionist meal plan + USDA/OFF lookup cache, food
// name translations, and per-user macro corrections. Split out of repos.ts (god-file split,
// same barrel seam); behavior unchanged.
import type { MealEntry, MealPlanDoc, NutritionLogDoc } from "../../types";
import { nowIso, type DB } from "./shared";

// ---------- nutrition logs ----------

export async function appendMeals(
  db: DB,
  userId: number,
  date: string,
  meals: MealEntry[],
): Promise<MealEntry[]> {
  const now = nowIso();
  const row = await db
    .prepare("SELECT meals FROM nutrition_logs WHERE userId = ? AND date = ?")
    .bind(userId, date)
    .first<{ meals: string }>();
  const all: MealEntry[] = row ? [...(JSON.parse(row.meals) as MealEntry[]), ...meals] : [...meals];
  if (row) {
    await db
      .prepare("UPDATE nutrition_logs SET meals = ?, updatedAt = ? WHERE userId = ? AND date = ?")
      .bind(JSON.stringify(all), now, userId, date)
      .run();
  } else {
    await db
      .prepare("INSERT INTO nutrition_logs (userId, date, meals, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)")
      .bind(userId, date, JSON.stringify(all), now, now)
      .run();
  }
  return all;
}

// Overwrite a day's meals (used by in-place edits). Deletes the row if the list is empty.
export async function setDayMeals(db: DB, userId: number, date: string, meals: MealEntry[]): Promise<void> {
  if (!meals.length) {
    await db.prepare("DELETE FROM nutrition_logs WHERE userId = ? AND date = ?").bind(userId, date).run();
    return;
  }
  const now = nowIso();
  const res = await db.prepare("UPDATE nutrition_logs SET meals = ?, updatedAt = ? WHERE userId = ? AND date = ?")
    .bind(JSON.stringify(meals), now, userId, date).run();
  if (!res.meta.changes) {
    await db.prepare("INSERT INTO nutrition_logs (userId, date, meals, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)")
      .bind(userId, date, JSON.stringify(meals), now, now).run();
  }
}

// Recent distinct foods (for one-tap re-log), most-recent first, deduped by name.
export async function getRecentFoods(db: DB, userId: number, sinceDate: string, limit = 12): Promise<MealEntry[]> {
  const r = await db
    .prepare("SELECT meals FROM nutrition_logs WHERE userId = ? AND date >= ? ORDER BY date DESC")
    .bind(userId, sinceDate)
    .all<{ meals: string }>();
  const seen = new Set<string>();
  const out: MealEntry[] = [];
  for (const row of r.results ?? []) {
    let meals: MealEntry[] = [];
    try { meals = JSON.parse(row.meals) as MealEntry[]; } catch { /* skip bad row */ }
    for (const m of meals) {
      const key = (m.desc || "").toLowerCase().replace(/[~(]?\s*\d.*$/u, "").trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(m);
      if (out.length >= limit) return out;
    }
  }
  return out;
}

export async function getDayMeals(db: DB, userId: number, date: string): Promise<MealEntry[]> {
  const row = await db
    .prepare("SELECT meals FROM nutrition_logs WHERE userId = ? AND date = ?")
    .bind(userId, date)
    .first<{ meals: string }>();
  return row ? (JSON.parse(row.meals) as MealEntry[]) : [];
}

// Remove one logged item by index from a day; deletes the row if it becomes empty. Returns the rest.
export async function deleteMealItem(db: DB, userId: number, date: string, index: number): Promise<MealEntry[]> {
  const meals = await getDayMeals(db, userId, date);
  if (index < 0 || index >= meals.length) return meals;
  meals.splice(index, 1);
  if (meals.length) {
    await db.prepare("UPDATE nutrition_logs SET meals = ?, updatedAt = ? WHERE userId = ? AND date = ?")
      .bind(JSON.stringify(meals), nowIso(), userId, date).run();
  } else {
    await db.prepare("DELETE FROM nutrition_logs WHERE userId = ? AND date = ?").bind(userId, date).run();
  }
  return meals;
}

export async function nutritionLogsSince(db: DB, userId: number, cutoff: string): Promise<NutritionLogDoc[]> {
  const r = await db
    .prepare("SELECT * FROM nutrition_logs WHERE userId = ? AND date >= ?")
    .bind(userId, cutoff)
    .all<{ userId: number; date: string; meals: string; createdAt: string; updatedAt: string }>();
  return (r.results ?? []).map((row) => ({
    userId: row.userId,
    date: row.date,
    meals: JSON.parse(row.meals),
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
  }));
}

/** ALL users' nutrition-log (userId, date) pairs on/after `sinceDate` — bulk compliance
 * counting for the trainer dashboard without a query per client. */
export async function allNutritionDatesSince(db: DB, sinceDate: string): Promise<{ userId: number; date: string }[]> {
  const r = await db
    .prepare("SELECT userId, date FROM nutrition_logs WHERE date >= ?")
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
    .prepare(`SELECT en, name FROM food_translations WHERE lang = ? AND en IN (${placeholders})`)
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
        `INSERT INTO food_translations (en, lang, name, createdAt) VALUES (?, ?, ?, ?)
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
      `INSERT INTO meal_plans (userId, week, days, targets, generatedAt) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(userId, week) DO UPDATE SET days = excluded.days, targets = excluded.targets, generatedAt = excluded.generatedAt`,
    )
    .bind(plan.userId, plan.week, JSON.stringify(plan.days), JSON.stringify(plan.targets), nowIso())
    .run();
}

export async function getMealPlan(db: DB, userId: number, week = 0): Promise<MealPlanDoc | null> {
  const r = await db
    .prepare("SELECT * FROM meal_plans WHERE userId = ? AND week = ?")
    .bind(userId, week)
    .first<{ userId: number; week: number; days: string; targets: string; generatedAt: string }>();
  return r
    ? { userId: r.userId, week: r.week, days: JSON.parse(r.days), targets: JSON.parse(r.targets), generatedAt: new Date(r.generatedAt) }
    : null;
}

export async function getFoodCache(db: DB, query: string): Promise<unknown | null> {
  const r = await db.prepare("SELECT per100g FROM food_cache WHERE query = ?").bind(query.toLowerCase()).first<{ per100g: string }>();
  return r ? JSON.parse(r.per100g) : null;
}

export async function putFoodCache(db: DB, query: string, per100g: unknown): Promise<void> {
  await db
    .prepare("INSERT INTO food_cache (query, per100g, ts) VALUES (?, ?, ?) ON CONFLICT(query) DO UPDATE SET per100g = excluded.per100g, ts = excluded.ts")
    .bind(query.toLowerCase(), JSON.stringify(per100g), nowIso())
    .run();
}

// ---------- per-user food macro corrections ----------

export async function getUserFoodCorrection(db: DB, userId: number, query: string): Promise<{ kcal: number; protein: number; fats: number; carbs: number } | null> {
  const r = await db
    .prepare("SELECT per100g FROM food_corrections WHERE userId = ? AND query = ?")
    .bind(userId, query.trim().toLowerCase())
    .first<{ per100g: string }>();
  return r ? (JSON.parse(r.per100g) as { kcal: number; protein: number; fats: number; carbs: number }) : null;
}

export async function putUserFoodCorrection(db: DB, userId: number, query: string, per100g: { kcal: number; protein: number; fats: number; carbs: number }): Promise<void> {
  await db
    .prepare("INSERT INTO food_corrections (userId, query, per100g, ts) VALUES (?, ?, ?, ?) ON CONFLICT(userId, query) DO UPDATE SET per100g = excluded.per100g, ts = excluded.ts")
    .bind(userId, query.trim().toLowerCase(), JSON.stringify(per100g), nowIso())
    .run();
}
