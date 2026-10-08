// Learned foods (migration 0095): external lookup results kept so the next identical search or
// barcode is answered from D1. Search reads the word index by range on the first query word's
// stem (an index seek, not a table scan) and filters the few candidates by the remaining words.
import { foodTokens, normalizeFood, stem } from "../../domain/foodCatalog";
import { nowIso } from "./shared";

export interface LearnedFood {
  name: string;
  brand: string;
  per100: { kcal: number; p: number; f: number; c: number };
  barcode?: string;
  source: string;
}

type Row = { id: string; name: string; brand: string; barcode: string | null; kcal: number; protein: number; fat: number; carbs: number; source: string; hits: number };

const toFood = (r: Row): LearnedFood => ({
  name: r.name,
  brand: r.brand,
  per100: { kcal: r.kcal, p: r.protein, f: r.fat, c: r.carbs },
  ...(r.barcode ? { barcode: r.barcode } : {}),
  source: r.source,
});

export const learnedId = (name: string, brand: string) => `${normalizeFood(name)}|${normalizeFood(brand)}`;

/** Upsert foods (one batch). Values must already be validated per-100 g numbers. */
export async function rememberFoods(db: D1Database, foods: LearnedFood[]): Promise<void> {
  const stmts: D1PreparedStatement[] = [];
  const now = nowIso();
  for (const f of foods.slice(0, 10)) {
    if (!f.name || !(f.per100.kcal > 0)) continue;
    const id = learnedId(f.name, f.brand);
    if (f.barcode) {
      // Another food may hold this barcode under a different name; the newest scan wins.
      stmts.push(db.prepare("UPDATE v2_food_learned SET barcode = NULL WHERE barcode = ? AND id <> ?").bind(f.barcode, id));
    }
    stmts.push(
      db
        .prepare(
          `INSERT INTO v2_food_learned (id, name, brand, barcode, kcal, protein, fat, carbs, source, hits, updatedAt)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
           ON CONFLICT(id) DO UPDATE SET name = excluded.name, barcode = COALESCE(excluded.barcode, barcode),
             kcal = excluded.kcal, protein = excluded.protein, fat = excluded.fat, carbs = excluded.carbs,
             source = excluded.source, updatedAt = excluded.updatedAt`,
        )
        .bind(id, f.name, f.brand, f.barcode ?? null, f.per100.kcal, f.per100.p, f.per100.f, f.per100.c, f.source, now),
    );
    for (const w of new Set(foodTokens(`${f.name} ${f.brand}`))) {
      stmts.push(db.prepare("INSERT OR IGNORE INTO v2_food_learned_words (word, foodId) VALUES (?, ?)").bind(w, id));
    }
  }
  if (stmts.length) await db.batch(stmts);
}

/** Learned foods matching every word of `query` (by stem prefix), most picked first. */
export async function searchLearned(db: D1Database, query: string, limit = 5): Promise<LearnedFood[]> {
  const words = foodTokens(query);
  if (!words.length) return [];
  const stems = words.map(stem);
  const lead = stems.reduce((a, b) => (b.length > a.length ? b : a)); // the most selective word
  const r = await db
    .prepare(
      `SELECT f.* FROM v2_food_learned_words w JOIN v2_food_learned f ON f.id = w.foodId
       WHERE w.word >= ? AND w.word < ? GROUP BY f.id ORDER BY f.hits DESC, f.updatedAt DESC LIMIT 50`,
    )
    .bind(lead, `${lead}￿`)
    .all<Row>();
  return (r.results ?? [])
    .filter((row) => {
      const have = foodTokens(`${row.name} ${row.brand}`);
      return stems.every((s) => have.some((h) => h.startsWith(s)));
    })
    .slice(0, limit)
    .map(toFood);
}

export async function learnedByBarcode(db: D1Database, barcode: string): Promise<LearnedFood | null> {
  const r = await db.prepare("SELECT * FROM v2_food_learned WHERE barcode = ?").bind(barcode).first<Row>();
  return r ? toFood(r) : null;
}

/** A logged pick ranks the food higher in later searches. */
export async function bumpLearned(db: D1Database, name: string, brand = ""): Promise<void> {
  await db.prepare("UPDATE v2_food_learned SET hits = hits + 1 WHERE id = ?").bind(learnedId(name, brand)).run();
}
