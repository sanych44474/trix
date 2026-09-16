// Domain 5 v2-native repo (src/adapters/d1/v2Nutrition.ts) against REAL D1 (workerd) — the
// node:sqlite-backed node:test harness (test/v2-nutrition.test.ts) can't promise db.batch()'s
// atomicity guarantees match real D1. appendMeals/setDayMeals each fan a single logical write
// out across v2_nutrition_days + N v2_nutrition_entries rows in one batch (same reasoning as
// test/vitest/v2-users.test.ts) -- and appendMeals additionally relies on each INSERT's
// correlated MAX(position) subquery being evaluated against the PRIOR statement's already-
// committed-within-the-transaction rows, not a value read before the batch started (see the
// race-avoidance comment on appendMeals) -- real D1/SQLite statement-execution-order semantics,
// not something the node:sqlite harness's synchronous exec loop is guaranteed to model faithfully.
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import {
  appendMeals,
  deleteMealItem,
  getDayMeals,
  setDayMeals,
} from "../../src/adapters/d1/v2Nutrition";

// v2_nutrition_days/v2_nutrition_entries FK accountId -> v2_accounts(id) -- real D1 enforces it
// (unlike the node:sqlite harness in some configurations), so every account this file writes
// nutrition rows for must exist first. This domain doesn't own v2_accounts, so seed it directly
// (same reasoning as test/v2-catalog.test.ts's seedAccount, just async for the real D1 binding).
async function seedAccount(id: number): Promise<void> {
  const now = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO v2_accounts (id, legacyUserId, chatId, role, status, createdAt, updatedAt) VALUES (?, ?, ?, 'solo', 'active', ?, ?)",
  ).bind(id, id, id, now, now).run();
}

describe("v2Nutrition: appendMeals — one batch across v2_nutrition_days + v2_nutrition_entries", () => {
  it("lands the day row and every entry row together", async () => {
    await seedAccount(600);
    await appendMeals(env.DB, 600, "2026-02-01", [
      { desc: "eggs", kcal: 140, protein: 12, fats: 10, carbs: 1 },
      { desc: "toast", kcal: 90, protein: 3, fats: 1, carbs: 17 },
    ]);
    const day = await env.DB.prepare("SELECT * FROM v2_nutrition_days WHERE accountId = ? AND date = ?").bind(600, "2026-02-01").first();
    const entries = await env.DB.prepare("SELECT description, position FROM v2_nutrition_entries WHERE accountId = ? AND date = ? ORDER BY position").bind(600, "2026-02-01").all();
    expect(day).not.toBeNull();
    expect(entries.results).toEqual([
      { description: "eggs", position: 0 },
      { description: "toast", position: 1 },
    ]);
  });

  it("each successive INSERT's correlated position subquery sees the prior statement's row within the same batch — no duplicate/clobbered positions", async () => {
    await seedAccount(601);
    await appendMeals(env.DB, 601, "2026-02-01", [
      { desc: "a", kcal: 1, protein: 1, fats: 1, carbs: 1 },
      { desc: "b", kcal: 2, protein: 1, fats: 1, carbs: 1 },
      { desc: "c", kcal: 3, protein: 1, fats: 1, carbs: 1 },
    ]);
    const positions = await env.DB
      .prepare("SELECT position FROM v2_nutrition_entries WHERE accountId = ? AND date = ? ORDER BY position")
      .bind(601, "2026-02-01")
      .all<{ position: number }>();
    expect(positions.results.map((r) => r.position)).toEqual([0, 1, 2]);
  });

  it("a second appendMeals call continues from the existing max position, not from 0", async () => {
    await seedAccount(602);
    await appendMeals(env.DB, 602, "2026-02-01", [{ desc: "first", kcal: 1, protein: 1, fats: 1, carbs: 1 }]);
    await appendMeals(env.DB, 602, "2026-02-01", [{ desc: "second", kcal: 1, protein: 1, fats: 1, carbs: 1 }]);
    const meals = await getDayMeals(env.DB, 602, "2026-02-01");
    expect(meals.map((m) => m.desc)).toEqual(["first", "second"]);
  });
});

describe("v2Nutrition: setDayMeals — delete-all-entries + reinsert lands atomically", () => {
  it("overwriting a day replaces every entry row in one batch", async () => {
    await seedAccount(610);
    await appendMeals(env.DB, 610, "2026-02-01", [
      { desc: "old1", kcal: 1, protein: 1, fats: 1, carbs: 1 },
      { desc: "old2", kcal: 1, protein: 1, fats: 1, carbs: 1 },
    ]);
    await setDayMeals(env.DB, 610, "2026-02-01", [{ desc: "new", kcal: 1, protein: 1, fats: 1, carbs: 1 }]);
    const meals = await getDayMeals(env.DB, 610, "2026-02-01");
    expect(meals.map((m) => m.desc)).toEqual(["new"]);
  });

  it("deleteMealItem's underlying setDayMeals batch removes the day row when the list empties", async () => {
    await seedAccount(611);
    await appendMeals(env.DB, 611, "2026-02-01", [{ desc: "only", kcal: 1, protein: 1, fats: 1, carbs: 1 }]);
    await deleteMealItem(env.DB, 611, "2026-02-01", 0);
    const day = await env.DB.prepare("SELECT 1 FROM v2_nutrition_days WHERE accountId = ? AND date = ?").bind(611, "2026-02-01").first();
    const entries = await env.DB.prepare("SELECT 1 FROM v2_nutrition_entries WHERE accountId = ? AND date = ?").bind(611, "2026-02-01").all();
    expect(day).toBeNull();
    expect(entries.results).toEqual([]);
  });
});
