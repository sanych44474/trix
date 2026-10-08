import { test } from "node:test";
import assert from "node:assert/strict";
import { catalogFoods, searchCatalog, stem } from "../src/domain/foodCatalog";
import { bumpLearned, learnedByBarcode, rememberFoods, searchLearned } from "../src/adapters/d1/v2FoodLearned";
import { getOrCreateUser } from "../src/adapters/d1/v2Users";
import { handleNutritionApi } from "../src/webapp/nutritionApi";
import { newDb } from "./harness";

test("catalog: every line parses, names unique, macros consistent with calories", () => {
  const foods = catalogFoods();
  assert.ok(foods.length >= 400);
  assert.equal(new Set(foods.map((f) => f.uk)).size, foods.length);
  assert.equal(new Set(foods.map((f) => f.en)).size, foods.length);
  for (const f of foods) {
    const { kcal, p, f: fat, c } = f.per100;
    assert.ok([kcal, p, fat, c, f.portionG].every((n) => Number.isFinite(n) && n >= 0), f.uk);
    assert.ok(p + fat + c <= 101, f.uk);
    // Atwater check (alcoholic drinks and fibre-heavy foods aside).
    const est = p * 4 + fat * 9 + c * 4;
    if (kcal >= 60 && !["drinks"].includes(f.category) && !/висівки/i.test(f.uk)) assert.ok(Math.abs(est - kcal) / kcal < 0.3, `${f.uk}: ${kcal} vs ${est}`);
  }
});

test("catalog search: inflected Ukrainian, synonyms, English, generic first", () => {
  const top = (q: string, lang: "uk" | "en" = "uk") => searchCatalog(q, lang, 3).map((f) => f.uk);
  assert.equal(top("курку варену")[0], "Куряче філе варене");
  assert.equal(top("гречки")[0], "Гречка (суха)");
  assert.equal(top("творог")[0], "Сир кисломолочний 5%");
  assert.equal(top("вареники з сиром")[0], "Вареники з сиром");
  assert.equal(top("chicken breast", "en")[0], "Куряче філе (сире)");
  assert.equal(top("олив'є")[0], "Салат Олів'є");
  assert.deepEqual(top("xyzzy"), []);
  assert.equal(stem("курку"), "курк");
});

test("learned foods: remember, search by stem, barcode, hits rank", async () => {
  const db = newDb() as unknown as D1Database;
  await rememberFoods(db, [
    { name: "Йогурт Галичина полуниця", brand: "Галичина", per100: { kcal: 85, p: 3, f: 2.5, c: 12 }, source: "off" },
    { name: "Йогурт Danone персик", brand: "Danone", per100: { kcal: 90, p: 3, f: 2, c: 14 }, barcode: "4820000000001", source: "off" },
  ]);
  assert.deepEqual((await searchLearned(db, "йогурти галичини")).map((f) => f.brand), ["Галичина"]);
  assert.equal((await searchLearned(db, "йогурт")).length, 2);
  await bumpLearned(db, "Йогурт Danone персик", "Danone");
  assert.equal((await searchLearned(db, "йогурт"))[0].brand, "Danone");
  assert.equal((await learnedByBarcode(db, "4820000000001"))?.name, "Йогурт Danone персик");
  // The same barcode re-scanned under another name moves to it.
  await rememberFoods(db, [{ name: "Danone Peach", brand: "Danone", per100: { kcal: 90, p: 3, f: 2, c: 14 }, barcode: "4820000000001", source: "off" }]);
  assert.equal((await learnedByBarcode(db, "4820000000001"))?.name, "Danone Peach");
});

async function call(db: ReturnType<typeof newDb>, body: unknown) {
  const url = "https://x/api/nutrition?debugUser=1";
  const req = new Request(url, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
  return handleNutritionApi(req, new URL(url), { DB: db, ALLOW_DEBUG_USER: "1", TELEGRAM_BOT_TOKEN: "t" } as never);
}

test("dbsearch: the catalog answers in the user's language without any network call", async () => {
  const db = newDb();
  await getOrCreateUser(db, 1, 1, "uk", "Ann");
  const realFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = (async () => { called = true; return new Response("{}"); }) as unknown as typeof fetch;
  try {
    const res = await call(db, { action: "dbsearch", q: "гречка" });
    const body = (await res.json()) as { source: string; items: Array<{ name: string; portionG?: number; per100: { kcal: number } }> };
    assert.equal(body.source, "trix");
    assert.equal(body.items[0].name, "Гречка (суха)");
    assert.equal(body.items[0].per100.kcal, 343);
    assert.ok(body.items[0].portionG);
    assert.equal(called, false);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("dbsearch / barcode: external results are remembered and served locally next time", async () => {
  const db = newDb();
  await getOrCreateUser(db, 1, 1, "uk", "Ann");
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async (url: string) => {
    calls++;
    if (String(url).includes("/api/v2/product/")) {
      return new Response(JSON.stringify({ status: 1, product: { product_name: "Nutella", brands: "Ferrero", nutriments: { "energy-kcal_100g": 539, proteins_100g: 6.3, fat_100g: 30.9, carbohydrates_100g: 57.5 } } }));
    }
    return new Response(JSON.stringify({ products: [{ product_name: "Квас Тарас", brands: "Тарас", nutriments: { "energy-kcal_100g": 30, carbohydrates_100g: 7 } }] }));
  }) as unknown as typeof fetch;
  try {
    const first = (await (await call(db, { action: "dbsearch", q: "квас тарас" })).json()) as { source: string };
    assert.equal(first.source, "off");
    const again = (await (await call(db, { action: "dbsearch", q: "квасу тарас" })).json()) as { source: string; items: Array<{ name: string }> };
    assert.equal(again.source, "trix");
    assert.equal(again.items[0].name, "Квас Тарас");
    await call(db, { action: "barcode", code: "3017624010701" });
    const scanned = (await (await call(db, { action: "barcode", code: "3017624010701" })).json()) as { source: string };
    assert.equal(scanned.source, "trix");
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("catalogExact: names and synonyms only, never a loose match", async () => {
  const { catalogExact } = await import("../src/domain/foodCatalog");
  const { curatedPer100g } = await import("../src/ai/nutritionDb");
  assert.equal(catalogExact("borscht")?.uk, undefined);
  assert.equal(catalogExact("Ukrainian borscht")?.uk, "Борщ український");
  assert.equal(catalogExact("деруни")?.en, "Potato pancakes (deruny)");
  assert.equal(catalogExact("potato pancakes")?.uk, "Деруни");
  assert.equal(catalogExact("soup with something"), null);
  // The curated list still wins for the foods it has.
  assert.equal(curatedPer100g("chicken breast")?.source, "USDA");
  assert.equal(curatedPer100g("varenyky with potato")?.source, "trix");
});
