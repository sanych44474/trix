// D1 binds at most 100 parameters per statement (the harness enforces it). Lookups keyed by a
// list a user or the AI controls -- plan exercises, food names -- must chunk their IN (...).
import { test } from "node:test";
import assert from "node:assert/strict";
import { newDb } from "./harness";
import { existingCatalogIds, getExerciseTranslations, getExerciseVideos, getUserVideos } from "../src/adapters/d1/v2Catalog";
import { getFoodTranslations } from "../src/adapters/d1/v2Nutrition";

const keys = (n: number, prefix: string) => Array.from({ length: n }, (_, i) => `${prefix}${i}`);

test("IN lookups over 250 keys run in chunks instead of failing", async () => {
  const db = newDb() as never;
  assert.equal((await existingCatalogIds(db, keys(250, "ex"))).size, 0);
  assert.equal((await getExerciseTranslations(db, keys(250, "ex"), "uk")).size, 0);
  assert.equal((await getExerciseVideos(db, keys(250, "squat "))).size, 0);
  assert.equal((await getUserVideos(db, 1, keys(250, "squat "))).size, 0);
  assert.equal((await getFoodTranslations(db, keys(250, "apple "), "uk")).size, 0);
});
