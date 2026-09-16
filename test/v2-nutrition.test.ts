// Domain 5 (nutrition) v2-native repo — src/adapters/d1/v2Nutrition.ts. Exercises it directly
// against the same in-memory D1 harness the legacy repo tests use (test/harness.ts), which
// builds its schema from every migrations/*.sql file, including 0069/0070/0072 (v2_nutrition_days/
// v2_nutrition_entries/v2_food_references/v2_nutrition_corrections) and 0075 (v2_nutrition_days.
// createdAt, v2_meal_plans, v2_food_translations).
import { test } from "node:test";
import assert from "node:assert/strict";
import { newDb } from "./harness";
import type { MealEntry, MealPlanDoc } from "../src/types";
import {
  allNutritionDatesSince,
  appendMeals,
  deleteMealItem,
  getDayMeals,
  getFoodCache,
  getFoodTranslations,
  getMealPlan,
  getRecentFoods,
  getUserFoodCorrection,
  nutritionLogsSince,
  putFoodCache,
  putUserFoodCorrection,
  saveMealPlan,
  setDayMeals,
  upsertFoodTranslations,
} from "../src/adapters/d1/v2Nutrition";

const meal = (desc: string, kcal = 100, extra: Partial<MealEntry> = {}): MealEntry => ({
  desc, kcal, protein: 10, fats: 5, carbs: 8, ...extra,
});

// v2_nutrition_days/v2_nutrition_entries/v2_meal_plans/v2_nutrition_corrections all FK
// accountId -> v2_accounts(id) -- seed minimal account rows directly (this domain doesn't own
// v2_accounts; test/v2-users.test.ts exercises getOrCreateUser itself). Same helper/reasoning as
// test/v2-catalog.test.ts's seedAccount. v2_food_references and v2_food_translations have no
// such FK (global reference data, not account-scoped), so tests touching only those skip this.
function seedAccount(db: ReturnType<typeof newDb>, id: number): void {
  const now = new Date().toISOString();
  db.prepare(
    "INSERT INTO v2_accounts (id, legacyUserId, chatId, role, status, createdAt, updatedAt) VALUES (?, ?, ?, 'solo', 'active', ?, ?)",
  ).bind(id, id, id, now, now).run();
}

// ---------- day meals: appendMeals / getDayMeals / setDayMeals / deleteMealItem ----------

test("appendMeals: creates the day + entries, returns the full day in order", async () => {
  const db = newDb();
  seedAccount(db, 1);
  const day = await appendMeals(db, 1, "2026-01-01", [meal("eggs"), meal("toast")]);
  assert.deepEqual(day.map((m) => m.desc), ["eggs", "toast"]);
});

test("appendMeals: a second call appends after existing positions, doesn't clobber", async () => {
  const db = newDb();
  seedAccount(db, 1);
  await appendMeals(db, 1, "2026-01-01", [meal("eggs")]);
  const day = await appendMeals(db, 1, "2026-01-01", [meal("toast"), meal("coffee")]);
  assert.deepEqual(day.map((m) => m.desc), ["eggs", "toast", "coffee"]);
});

test("appendMeals: v2_nutrition_days.createdAt is set once and never overwritten by later appends", async () => {
  const db = newDb();
  seedAccount(db, 1);
  await appendMeals(db, 1, "2026-01-01", [meal("eggs")]);
  const first = db.dump<{ createdAt: string }>("SELECT createdAt FROM v2_nutrition_days WHERE accountId = ? AND date = ?", 1, "2026-01-01")[0].createdAt;
  await new Promise((r) => setTimeout(r, 5));
  await appendMeals(db, 1, "2026-01-01", [meal("toast")]);
  const second = db.dump<{ createdAt: string }>("SELECT createdAt FROM v2_nutrition_days WHERE accountId = ? AND date = ?", 1, "2026-01-01")[0].createdAt;
  assert.equal(first, second);
});

test("appendMeals: grams/query round-trip; entries without them come back without the optional keys", async () => {
  const db = newDb();
  seedAccount(db, 1);
  seedAccount(db, 2);
  const day = await appendMeals(db, 1, "2026-01-01", [meal("chicken", 200, { grams: 150, query: "chicken breast" })]);
  assert.equal(day[0].grams, 150);
  assert.equal(day[0].query, "chicken breast");

  const day2 = await appendMeals(db, 2, "2026-01-01", [meal("mystery")]);
  assert.equal("grams" in day2[0], false);
  assert.equal("query" in day2[0], false);
});

test("getDayMeals: empty day returns []", async () => {
  const db = newDb();
  assert.deepEqual(await getDayMeals(db, 1, "2026-01-01"), []);
});

test("setDayMeals: overwrites a day's meals atomically", async () => {
  const db = newDb();
  seedAccount(db, 1);
  await appendMeals(db, 1, "2026-01-01", [meal("eggs"), meal("toast")]);
  await setDayMeals(db, 1, "2026-01-01", [meal("salad")]);
  const day = await getDayMeals(db, 1, "2026-01-01");
  assert.deepEqual(day.map((m) => m.desc), ["salad"]);
});

test("setDayMeals: empty list deletes the day row (and its entries)", async () => {
  const db = newDb();
  seedAccount(db, 1);
  await appendMeals(db, 1, "2026-01-01", [meal("eggs")]);
  await setDayMeals(db, 1, "2026-01-01", []);
  assert.deepEqual(await getDayMeals(db, 1, "2026-01-01"), []);
  assert.deepEqual(db.dump("SELECT 1 FROM v2_nutrition_days WHERE accountId = ? AND date = ?", 1, "2026-01-01"), []);
  assert.deepEqual(db.dump("SELECT 1 FROM v2_nutrition_entries WHERE accountId = ? AND date = ?", 1, "2026-01-01"), []);
});

test("setDayMeals: preserves createdAt on overwrite (only updatedAt moves)", async () => {
  const db = newDb();
  seedAccount(db, 1);
  await appendMeals(db, 1, "2026-01-01", [meal("eggs")]);
  const before = db.dump<{ createdAt: string }>("SELECT createdAt FROM v2_nutrition_days WHERE accountId = ? AND date = ?", 1, "2026-01-01")[0].createdAt;
  await new Promise((r) => setTimeout(r, 5));
  await setDayMeals(db, 1, "2026-01-01", [meal("toast")]);
  const after = db.dump<{ createdAt: string }>("SELECT createdAt FROM v2_nutrition_days WHERE accountId = ? AND date = ?", 1, "2026-01-01")[0].createdAt;
  assert.equal(before, after);
});

test("deleteMealItem: removes by index, keeps the rest in order; out-of-range index is a no-op", async () => {
  const db = newDb();
  seedAccount(db, 1);
  await appendMeals(db, 1, "2026-01-01", [meal("eggs"), meal("toast"), meal("coffee")]);
  const after = await deleteMealItem(db, 1, "2026-01-01", 1);
  assert.deepEqual(after.map((m) => m.desc), ["eggs", "coffee"]);

  const unchanged = await deleteMealItem(db, 1, "2026-01-01", 99);
  assert.deepEqual(unchanged.map((m) => m.desc), ["eggs", "coffee"]);
});

test("deleteMealItem: deleting the last item removes the day row", async () => {
  const db = newDb();
  seedAccount(db, 1);
  await appendMeals(db, 1, "2026-01-01", [meal("eggs")]);
  await deleteMealItem(db, 1, "2026-01-01", 0);
  assert.deepEqual(db.dump("SELECT 1 FROM v2_nutrition_days WHERE accountId = ? AND date = ?", 1, "2026-01-01"), []);
});

// ---------- getRecentFoods ----------

test("getRecentFoods: most-recent-day-first, deduped by normalized name, respects limit", async () => {
  const db = newDb();
  seedAccount(db, 1);
  await appendMeals(db, 1, "2026-01-01", [meal("chicken breast (~150 g)")]);
  await appendMeals(db, 1, "2026-01-02", [meal("chicken breast (~200 g)"), meal("rice")]);
  const recent = await getRecentFoods(db, 1, "2026-01-01", 12);
  // Day 2 first (DESC), "chicken breast" deduped to its day-2 occurrence (first-seen wins).
  assert.deepEqual(recent.map((m) => m.desc), ["chicken breast (~200 g)", "rice"]);
});

test("getRecentFoods: limit caps the result", async () => {
  const db = newDb();
  seedAccount(db, 1);
  await appendMeals(db, 1, "2026-01-01", [meal("a"), meal("b"), meal("c")]);
  const recent = await getRecentFoods(db, 1, "2026-01-01", 2);
  assert.equal(recent.length, 2);
});

// ---------- nutritionLogsSince / allNutritionDatesSince ----------

test("nutritionLogsSince: returns full-fidelity NutritionLogDoc, createdAt distinct from updatedAt", async () => {
  const db = newDb();
  seedAccount(db, 1);
  await appendMeals(db, 1, "2026-01-01", [meal("eggs")]);
  await new Promise((r) => setTimeout(r, 5));
  await appendMeals(db, 1, "2026-01-01", [meal("toast")]);
  const [log] = await nutritionLogsSince(db, 1, "2020-01-01");
  assert.equal(log.userId, 1);
  assert.equal(log.date, "2026-01-01");
  assert.deepEqual(log.meals.map((m) => m.desc), ["eggs", "toast"]);
  assert.ok(log.updatedAt.getTime() > log.createdAt.getTime());
});

test("nutritionLogsSince: cutoff excludes earlier dates", async () => {
  const db = newDb();
  seedAccount(db, 1);
  await appendMeals(db, 1, "2026-01-01", [meal("old")]);
  await appendMeals(db, 1, "2026-01-05", [meal("new")]);
  const logs = await nutritionLogsSince(db, 1, "2026-01-03");
  assert.deepEqual(logs.map((l) => l.date), ["2026-01-05"]);
});

test("allNutritionDatesSince: spans all users, ignores meals content", async () => {
  const db = newDb();
  seedAccount(db, 1);
  seedAccount(db, 2);
  await appendMeals(db, 1, "2026-01-01", [meal("a")]);
  await appendMeals(db, 2, "2026-01-02", [meal("b")]);
  const pairs = await allNutritionDatesSince(db, "2026-01-01");
  assert.deepEqual(
    pairs.map((p) => `${p.userId}:${p.date}`).sort(),
    ["1:2026-01-01", "2:2026-01-02"],
  );
});

// ---------- food translations ----------

test("getFoodTranslations / upsertFoodTranslations: lowercased key, per-lang, upsert overwrites", async () => {
  const db = newDb();
  await upsertFoodTranslations(db, "uk", [{ en: "Chicken Breast", name: "Куряча грудка" }]);
  let map = await getFoodTranslations(db, ["chicken breast"], "uk");
  assert.equal(map.get("chicken breast"), "Куряча грудка");

  await upsertFoodTranslations(db, "uk", [{ en: "chicken breast", name: "Курка" }]);
  map = await getFoodTranslations(db, ["chicken breast"], "uk");
  assert.equal(map.get("chicken breast"), "Курка");

  const other = await getFoodTranslations(db, ["chicken breast"], "en");
  assert.equal(other.size, 0);
});

// ---------- meal plans ----------

test("saveMealPlan / getMealPlan: round-trips days/targets, upsert by (userId, week)", async () => {
  const db = newDb();
  seedAccount(db, 1);
  const plan: MealPlanDoc = {
    userId: 1,
    week: 0,
    days: [{ label: "Day 1", meals: [] }],
    targets: { calories: 2000, protein: 150, fats: 60, carbs: 200 },
    generatedAt: new Date("2026-01-01T00:00:00.000Z"),
  };
  await saveMealPlan(db, plan);
  const got = await getMealPlan(db, 1, 0);
  assert.deepEqual(got?.days, plan.days);
  assert.deepEqual(got?.targets, plan.targets);

  await saveMealPlan(db, { ...plan, days: [{ label: "Day 1 v2", meals: [] }] });
  const updated = await getMealPlan(db, 1, 0);
  assert.equal(updated?.days[0].label, "Day 1 v2");
});

test("getMealPlan: missing plan returns null", async () => {
  const db = newDb();
  assert.equal(await getMealPlan(db, 1, 0), null);
});

// ---------- food cache (v2_food_references) ----------

test("getFoodCache / putFoodCache: round-trips per100g, keyed by lowercased query", async () => {
  const db = newDb();
  const per100g = { source: "USDA", kcal: 165, protein: 31, fats: 4, carbs: 0 };
  await putFoodCache(db, "Chicken Breast", per100g);
  const got = await getFoodCache(db, "chicken breast");
  assert.deepEqual(got, per100g);
});

test("getFoodCache: miss returns null", async () => {
  const db = newDb();
  assert.equal(await getFoodCache(db, "nonexistent"), null);
});

// ---------- per-user food corrections ----------

test("getUserFoodCorrection / putUserFoodCorrection: per-user, per-query, upsert overwrites", async () => {
  const db = newDb();
  seedAccount(db, 1);
  seedAccount(db, 2);
  await putUserFoodCorrection(db, 1, "oats", { kcal: 380, protein: 13, fats: 7, carbs: 66 });
  const got = await getUserFoodCorrection(db, 1, "oats");
  assert.deepEqual(got, { kcal: 380, protein: 13, fats: 7, carbs: 66 });

  await putUserFoodCorrection(db, 1, "oats", { kcal: 390, protein: 13, fats: 7, carbs: 66 });
  const updated = await getUserFoodCorrection(db, 1, "oats");
  assert.equal(updated?.kcal, 390);

  const other = await getUserFoodCorrection(db, 2, "oats");
  assert.equal(other, null);
});
