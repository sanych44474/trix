// The cleanup batch: questionnaire drafts on the server (owner console progress), honest macro
// verification labels, the learned-food sweep, and the renamed table row.
import { test } from "node:test";
import assert from "node:assert/strict";
import { newDb } from "./harness";
import { getOrCreateUser } from "../src/adapters/d1/v2Users";
import { handleOnboardingApi } from "../src/webapp/profileApi";
import { ownerUsersData } from "../src/bot/ownerReport";
import { getOnboardingDraft } from "../src/adapters/d1/v2OnboardingDraft";
import { putFoodCache } from "../src/adapters/d1/v2Nutrition";
import { verifyItems } from "../src/features/nutrition/verifyItems";
import { pruneLearned, rememberFoods, searchLearned } from "../src/adapters/d1/v2FoodLearned";
import { PROGRAMS, buildProgram } from "../src/domain/programCatalog";
import type { Env } from "../src/types";

async function call(db: ReturnType<typeof newDb>, id: number, method: string, path: string, body?: unknown) {
  const p = `${path}?debugUser=${id}`;
  const req = new Request(`https://x${p}`, { method, ...(body !== undefined ? { body: JSON.stringify(body), headers: { "content-type": "application/json" } } : {}) });
  return handleOnboardingApi(req, new URL(`https://x${p}`), { DB: db, ALLOW_DEBUG_USER: "1", TELEGRAM_BOT_TOKEN: "t" } as never);
}

test("onboarding draft: saved, read back, shown in the owner roster, removed on completion", async () => {
  const db = newDb();
  await getOrCreateUser(db, 1, 1, "uk", "Марія");
  assert.deepEqual(await (await call(db, 1, "GET", "/api/v2/onboarding/draft")).json(), { answers: null });
  const save = await call(db, 1, "POST", "/api/v2/onboarding/draft", { answers: { sex: "female", age: 29 }, answered: 2, total: 15 });
  assert.equal(save.status, 200);
  assert.deepEqual(await (await call(db, 1, "GET", "/api/v2/onboarding/draft")).json(), { answers: { sex: "female", age: 29 } });
  const row = (await ownerUsersData(db as unknown as D1Database)).rows.find((r) => r.id === 1)!;
  assert.equal(row.onb, "2/15");
  // Bad input is refused, not stored.
  assert.equal((await call(db, 1, "POST", "/api/v2/onboarding/draft", { answers: [1], answered: 1, total: 15 })).status, 400);
  assert.equal((await call(db, 1, "POST", "/api/v2/onboarding/draft", { answers: {}, answered: 9, total: 3 })).status, 400);
  assert.equal((await call(db, 1, "POST", "/api/v2/onboarding/draft", { answers: { x: "y".repeat(5000) }, answered: 1, total: 15 })).status, 400);
  // Completing the questionnaire deletes it.
  await call(db, 1, "POST", "/api/v2/onboarding", {
    sex: "female", age: 29, heightCm: 168, weightKg: 60, goal: "fat loss", level: "beginner", equipment: "full gym", dietPrefs: "none", trainingWeekdays: [1, 3, 5], limitations: "none",
  });
  assert.equal(await getOnboardingDraft(db as unknown as D1Database, 1), null);
});

test("owner roster: no draft and no chat interview reads as 0 answered", async () => {
  const db = newDb();
  await getOrCreateUser(db, 2, 2, "uk", "stito");
  const row = (await ownerUsersData(db as unknown as D1Database)).rows.find((r) => r.id === 2)!;
  assert.equal(row.onb, "0");
});

test("macro verification: an AI-looked-up per-100g may replace numbers but is never 'verified'", async () => {
  const db = newDb() as unknown as D1Database;
  await putFoodCache(db, "mystery stew", { source: "Gemini", kcal: 120, protein: 8, fats: 5, carbs: 10 });
  await putFoodCache(db, "chicken soup house", { source: "USDA", kcal: 50, protein: 4, fats: 2, carbs: 4 });
  const env = {} as Env;
  const ai = await verifyItems(db, env, 1, [{ desc: "stew", query: "mystery stew", grams: 200, kcal: 220, protein: 14, fats: 9, carbs: 22 }]);
  assert.equal(ai.verified, 0);
  assert.equal(ai.source, "");
  assert.equal(ai.final[0].kcal, 240); // the looked-up figure still applies
  const usda = await verifyItems(db, env, 1, [{ desc: "soup", query: "chicken soup house", grams: 300, kcal: 160, protein: 12, fats: 6, carbs: 12 }]);
  assert.deepEqual([usda.verified, usda.source], [1, "USDA"]);
});

test("learned-food sweep: never-picked and old go, picked or recent stay", async () => {
  const db = newDb() as unknown as D1Database;
  await rememberFoods(db, [
    { name: "Старий йогурт", brand: "", per100: { kcal: 80, p: 3, f: 2, c: 12 }, source: "off" },
    { name: "Улюблений йогурт", brand: "", per100: { kcal: 80, p: 3, f: 2, c: 12 }, source: "off" },
  ]);
  await db.prepare("UPDATE v2_food_learned SET updatedAt = '2020-01-01T00:00:00.000Z'").run();
  await db.prepare("UPDATE v2_food_learned SET hits = 3 WHERE name = 'Улюблений йогурт'").run();
  assert.equal(await pruneLearned(db, "2025-01-01T00:00:00.000Z"), 1);
  assert.deepEqual((await searchLearned(db, "йогурт")).map((f) => f.name), ["Улюблений йогурт"]);
  const words = await db.prepare("SELECT COUNT(*) AS n FROM v2_food_learned_words WHERE word = 'старий'").first<{ n: number }>();
  assert.equal(words?.n, 0);
});

test("the table row is called Australian pull-ups in Ukrainian", () => {
  const names = PROGRAMS.flatMap((p) => buildProgram(p.id, "uk")?.split.flatMap((d) => d.exercises.map((e) => e.name)) ?? []);
  assert.ok(names.includes("Австралійські підтягування (під столом)"));
  assert.ok(!names.some((n) => /Тяга лежачи під столом/.test(n)));
});
