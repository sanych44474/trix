// dbsearch/recipe/recover hit the network (FatSecret/OFF/AI) and are out of scope here, same as
// every other AI-dependent path in this codebase — covered by the pure logic instead. Everything
// that actually runs on every log/edit (dbadd, readd, macros, del, scale, grams) is local state
// against the real in-memory DB.
import { test } from "node:test";
import assert from "node:assert/strict";
import { newDb } from "./harness";
import { getOrCreateUser, setDayMeals } from "../src/db/repos";
import { handleNutritionApi } from "../src/webapp/nutritionApi";

const TODAY = new Date().toISOString().slice(0, 10);

function req(method: string, path: string, body?: unknown) {
  return new Request(`https://x${path}`, {
    method,
    ...(body !== undefined ? { body: JSON.stringify(body), headers: { "content-type": "application/json" } } : {}),
  });
}
async function call(db: ReturnType<typeof newDb>, userId: number | null, method: string, path: string, body?: unknown) {
  const full = userId ? `${path}${path.includes("?") ? "&" : "?"}debugUser=${userId}` : path;
  return handleNutritionApi(req(method, full, body), new URL(`https://x${full}`), { DB: db, TELEGRAM_BOT_TOKEN: "t" } as never);
}

test("handleNutritionApi: unauthorized without a resolvable user", async () => {
  const db = newDb();
  const res = await call(db, null, "GET", "/api/nutrition");
  assert.equal(res.status, 401);
});

test("GET: an empty day returns zeroed totals and no meals", async () => {
  const db = newDb();
  await getOrCreateUser(db, 1, 1, "en", "Ann");
  const res = await call(db, 1, "GET", "/api/nutrition");
  const body = (await res.json()) as { meals: unknown[]; totals: { kcal: number } };
  assert.equal(res.status, 200);
  assert.deepEqual(body.meals, []);
  assert.equal(body.totals.kcal, 0);
});

test("dbadd: rejects an incomplete macro set, otherwise logs it and returns running totals", async () => {
  const db = newDb();
  await getOrCreateUser(db, 1, 1, "en", "Ann");
  const bad = await call(db, 1, "POST", "/api/nutrition", { action: "dbadd", name: "Chicken", grams: 100 }); // no per100
  assert.equal(bad.status, 400);

  const ok = await call(db, 1, "POST", "/api/nutrition", {
    action: "dbadd", name: "Chicken breast", grams: 150, per100: { kcal: 165, p: 31, f: 3.6, c: 0 },
  });
  assert.equal(ok.status, 200);
  const body = (await ok.json()) as { meals: { desc: string; kcal: number; grams: number }[]; totals: { kcal: number } };
  assert.equal(body.meals.length, 1);
  assert.equal(body.meals[0].desc, "Chicken breast");
  assert.equal(body.meals[0].kcal, Math.round(165 * 1.5));
  assert.equal(body.totals.kcal, Math.round(165 * 1.5));
});

test("readd: copies a recent food verbatim, rejects an out-of-range index", async () => {
  const db = newDb();
  await getOrCreateUser(db, 1, 1, "en", "Ann");
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  await setDayMeals(db, 1, yesterday, [{ desc: "Oatmeal", kcal: 300, protein: 10, fats: 5, carbs: 50 }]);

  const bad = await call(db, 1, "POST", "/api/nutrition", { action: "readd", ri: 5 });
  assert.equal(bad.status, 400);

  const ok = await call(db, 1, "POST", "/api/nutrition", { action: "readd", ri: 0 });
  assert.equal(ok.status, 200);
  const body = (await ok.json()) as { meals: { desc: string }[] };
  assert.equal(body.meals.length, 1);
  assert.equal(body.meals[0].desc, "Oatmeal");
});

test("del: removes the meal at that index", async () => {
  const db = newDb();
  await getOrCreateUser(db, 1, 1, "en", "Ann");
  await setDayMeals(db, 1, TODAY, [
    { desc: "A", kcal: 100, protein: 5, fats: 2, carbs: 10 },
    { desc: "B", kcal: 200, protein: 10, fats: 4, carbs: 20 },
  ]);
  const res = await call(db, 1, "POST", "/api/nutrition", { action: "del", index: 0 });
  const body = (await res.json()) as { meals: { desc: string }[] };
  assert.equal(body.meals.length, 1);
  assert.equal(body.meals[0].desc, "B");
});

test("scale: only accepts 0.5/1.5/2, multiplies macros and grams", async () => {
  const db = newDb();
  await getOrCreateUser(db, 1, 1, "en", "Ann");
  await setDayMeals(db, 1, TODAY, [{ desc: "Rice", kcal: 200, protein: 4, fats: 1, carbs: 44, grams: 100 }]);
  const bad = await call(db, 1, "POST", "/api/nutrition", { action: "scale", index: 0, factor: 3 });
  assert.equal(bad.status, 400);
  const ok = await call(db, 1, "POST", "/api/nutrition", { action: "scale", index: 0, factor: 2 });
  const body = (await ok.json()) as { meals: { kcal: number; grams: number }[] };
  assert.equal(body.meals[0].kcal, 400);
  assert.equal(body.meals[0].grams, 200);
});

test("grams: rescales by exact grams, rejects when the item has no base grams", async () => {
  const db = newDb();
  await getOrCreateUser(db, 1, 1, "en", "Ann");
  await setDayMeals(db, 1, TODAY, [
    { desc: "Rice", kcal: 200, protein: 4, fats: 1, carbs: 44, grams: 100 },
    { desc: "Estimate", kcal: 300, protein: 10, fats: 5, carbs: 40 }, // no grams
  ]);
  const noBase = await call(db, 1, "POST", "/api/nutrition", { action: "grams", index: 1, grams: 150 });
  assert.equal(noBase.status, 400);

  const ok = await call(db, 1, "POST", "/api/nutrition", { action: "grams", index: 0, grams: 50 });
  const body = (await ok.json()) as { meals: { kcal: number; grams: number }[] };
  assert.equal(body.meals[0].kcal, 100);
  assert.equal(body.meals[0].grams, 50);
});

test("macros: manual edit updates the item and caches a per-100g correction when grams+query are known", async () => {
  const db = newDb();
  await getOrCreateUser(db, 1, 1, "en", "Ann");
  await setDayMeals(db, 1, TODAY, [{ desc: "Mystery meal", kcal: 100, protein: 5, fats: 2, carbs: 10, grams: 100, query: "mystery meal" }]);
  const bad = await call(db, 1, "POST", "/api/nutrition", { action: "macros", index: 0, kcal: 999999 });
  assert.equal(bad.status, 400);

  const res = await call(db, 1, "POST", "/api/nutrition", { action: "macros", index: 0, kcal: 250, protein: 20, fats: 8, carbs: 25 });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { cached: boolean; meals: { kcal: number }[] };
  assert.equal(body.cached, true);
  assert.equal(body.meals[0].kcal, 250);
  const cached = db.dump<{ query: string }>("SELECT query FROM food_corrections WHERE userId = 1");
  assert.equal(cached.length, 1);
});

test("an out-of-range meal index is rejected before the action runs", async () => {
  const db = newDb();
  await getOrCreateUser(db, 1, 1, "en", "Ann");
  const res = await call(db, 1, "POST", "/api/nutrition", { action: "del", index: 3 });
  assert.equal(res.status, 400);
});

test("an unrecognized action is a 400", async () => {
  const db = newDb();
  await getOrCreateUser(db, 1, 1, "en", "Ann");
  await setDayMeals(db, 1, TODAY, [{ desc: "A", kcal: 100, protein: 5, fats: 2, carbs: 10 }]);
  const res = await call(db, 1, "POST", "/api/nutrition", { action: "doTheThing", index: 0 });
  assert.equal(res.status, 400);
});
