// Per-100 g food numbers from outside (Open Food Facts, FatSecret, an AI) are remembered for the next
// search, so an impossible row must be dropped at every door: the parsers, the learned-foods store
// (on the way in and on the way out, for rows saved before the check) and the barcode lookup.
import { test } from "node:test";
import assert from "node:assert/strict";
import { newDb } from "./harness";
import { plausiblePer100 } from "../src/domain/foodPlausible";
import { offPer100, parsePer100 } from "../src/webapp/foodDb";
import { learnedByBarcode, rememberFoods, searchLearned } from "../src/adapters/d1/v2FoodLearned";

const ok = { kcal: 250, p: 10, f: 12, c: 25 };

test("plausible per-100 g rows: real foods pass, impossible ones do not, and the limits are exact", () => {
  assert.equal(plausiblePer100(ok), true);
  assert.equal(plausiblePer100({ kcal: 884, p: 0, f: 100, c: 0 }), true, "pure oil");
  assert.equal(plausiblePer100({ kcal: 900, p: 100, f: 100, c: 100 }), true, "the limits themselves are allowed");
  assert.equal(plausiblePer100({ ...ok, kcal: 901 }), false, "over 900 kcal");
  assert.equal(plausiblePer100({ ...ok, kcal: 0 }), false);
  assert.equal(plausiblePer100({ ...ok, kcal: -5 }), false);
  for (const k of ["p", "f", "c"] as const) {
    assert.equal(plausiblePer100({ ...ok, [k]: 100.1 }), false, `${k} over 100 g`);
    assert.equal(plausiblePer100({ ...ok, [k]: -1 }), false, `${k} negative`);
    assert.equal(plausiblePer100({ ...ok, [k]: Number.NaN }), false, `${k} not a number`);
  }
  assert.equal(plausiblePer100({ ...ok, kcal: Number.POSITIVE_INFINITY }), false);
});

test("Open Food Facts: kcal fields and the kJ fallback still work, and an implausible row has no kcal", () => {
  assert.deepEqual(offPer100({ "energy-kcal_100g": 250, proteins_100g: 10, fat_100g: 12, carbohydrates_100g: 25 }), ok);
  assert.equal(offPer100({ energy_100g: 1046 }).kcal, 250, "1046 kJ / 4.184");
  assert.equal(offPer100(undefined).kcal, 0);
  assert.deepEqual(offPer100({ "energy-kcal_100g": 4000, proteins_100g: 10 }), { kcal: 0, p: 0, f: 0, c: 0 }, "kJ typed as kcal");
  assert.equal(offPer100({ "energy-kcal_100g": 250, proteins_100g: 140 }).kcal, 0, "140 g protein in 100 g");
  assert.equal(offPer100({ "energy-kcal_100g": 900 }).kcal, 900, "the limit is allowed");
});

test("FatSecret: only a per-100 g description with believable numbers is used", () => {
  assert.deepEqual(parsePer100("Per 100g - Calories: 250kcal | Fat: 12g | Carbs: 25g | Protein: 10g"), ok);
  assert.equal(parsePer100("Per 1 serving - Calories: 250kcal | Fat: 12g | Carbs: 25g | Protein: 10g"), null);
  assert.equal(parsePer100("Per 100g - Calories: 1200kcal | Fat: 12g | Carbs: 25g | Protein: 10g"), null);
  assert.equal(parsePer100("Per 100g - Calories: 250kcal | Fat: 12g | Carbs: 25g | Protein: 120g"), null);
});

test("learned foods: a bad row is not stored, a stored bad row is not served, and good rows still are", async () => {
  const db = newDb();
  await rememberFoods(db, [
    { name: "Good oats", brand: "", per100: ok, source: "off" },
    { name: "Bad oats", brand: "", per100: { ...ok, kcal: 4000 }, source: "off", barcode: "111" },
  ]);
  assert.deepEqual((await searchLearned(db, "oats")).map((f) => f.name), ["Good oats"], "the bad one was never stored");
  assert.equal(await learnedByBarcode(db, "111"), null);

  // A row written before the check existed.
  await db.prepare("INSERT INTO v2_food_learned (id, name, brand, barcode, kcal, protein, fat, carbs, source, hits, updatedAt) VALUES ('old|', 'Old oats', '', '222', 4000, 10, 12, 25, 'off', 0, ?)").bind(new Date().toISOString()).run();
  await db.prepare("INSERT INTO v2_food_learned_words (foodId, word) VALUES ('old|', 'oats')").run();
  assert.deepEqual((await searchLearned(db, "oats")).map((f) => f.name), ["Good oats"], "not served from the table either");
  assert.equal(await learnedByBarcode(db, "222"), null);
});
