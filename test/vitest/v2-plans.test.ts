// Domain 3 v2-native repo (src/adapters/d1/v2Plans.ts) against REAL D1 (workerd) — the
// node:sqlite-backed node:test harness (test/v2-plans.test.ts) can't promise db.batch()'s
// atomicity guarantees, nor its statement-execution-order semantics, match real D1.
// setActivePlan/saveDraftPlan each fan a single logical write out across v2_plans + N
// v2_plan_days + M v2_plan_exercises rows (two db.batch() calls: the plan row must commit first
// so its assigned id is known before the day/exercise rows that derive from it can be built —
// see the file-header comment in v2Plans.ts) — and `version` relies on a correlated
// `MAX(version)+1` subquery being evaluated against the batch's own prior statement, not a value
// read before the batch started (same race-avoidance reasoning as
// test/vitest/v2-nutrition.test.ts's appendMeals position tests) — real D1/SQLite
// statement-execution-order semantics, not something the node:sqlite harness's synchronous exec
// loop is guaranteed to model faithfully.
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import type { PlanDay, PlanDoc } from "../../src/types";
import {
  assignDraftPlan,
  getActivePlan,
  getDraftPlan,
  saveDraftPlan,
  setActivePlan,
  updateActivePlanSplit,
} from "../../src/adapters/d1/v2Plans";

// v2_plans.accountId FKs to v2_accounts(id) -- real D1 enforces it (unlike the node:sqlite
// harness in some configurations), so every account this file writes plans for must exist
// first. This domain doesn't own v2_accounts, so seed it directly (same reasoning as
// test/v2-catalog.test.ts's seedAccount, just async for the real D1 binding).
async function seedAccount(id: number): Promise<void> {
  const now = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO v2_accounts (id, legacyUserId, chatId, role, status, createdAt, updatedAt) VALUES (?, ?, ?, 'solo', 'active', ?, ?)",
  ).bind(id, id, id, now, now).run();
}

function makeDay(overrides: Partial<PlanDay> = {}): PlanDay {
  return {
    weekday: overrides.weekday ?? 1,
    muscleGroup: overrides.muscleGroup ?? "Push",
    exercises: overrides.exercises ?? [
      { name: "Bench Press", sets: "4x8", startWeight: "50 kg", technique: "controlled", isKeyLift: true },
      { name: "Overhead Press", sets: "3x10", startWeight: "30 kg", technique: "strict" },
    ],
  };
}

function makePlan(overrides: Partial<PlanDoc> = {}): PlanDoc {
  return {
    userId: overrides.userId ?? 1,
    active: overrides.active ?? true,
    status: overrides.status ?? "active",
    authoredBy: overrides.authoredBy,
    split: overrides.split ?? [makeDay()],
    nutrition: overrides.nutrition ?? { calories: 2200, protein: 160, fats: 70, carbs: 220 },
    supplements: overrides.supplements ?? [],
    methodology: overrides.methodology ?? "Linear progression",
    generatedAt: overrides.generatedAt ?? new Date("2026-01-01T00:00:00.000Z"),
    schemaVersion: overrides.schemaVersion ?? 1,
  };
}

describe("v2Plans: setActivePlan — plan row + day/exercise rows land together, correctly linked", () => {
  it("the plan row, its day rows and their exercise rows all land after one call", async () => {
    await seedAccount(700);
    await setActivePlan(env.DB, makePlan({ userId: 700 }));

    const plan = await env.DB.prepare("SELECT * FROM v2_plans WHERE accountId = ? AND active = 1").bind(700).first<{ id: number }>();
    expect(plan).not.toBeNull();

    const days = await env.DB.prepare("SELECT * FROM v2_plan_days WHERE planId = ?").bind(plan!.id).all();
    expect(days.results.length).toBe(1);

    const exercises = await env.DB.prepare("SELECT name, position FROM v2_plan_exercises WHERE dayId = ? ORDER BY position").bind((days.results[0] as { id: number }).id).all();
    expect(exercises.results).toEqual([
      { name: "Bench Press", position: 0 },
      { name: "Overhead Press", position: 1 },
    ]);
  });

  it("round-trips through getActivePlan with exercise fields that have no dedicated column", async () => {
    await seedAccount(701);
    await setActivePlan(env.DB, makePlan({ userId: 701 }));
    const plan = await getActivePlan(env.DB, 701);
    expect(plan?.split[0].exercises[0].isKeyLift).toBe(true);
  });
});

describe("v2Plans: version assignment — correlated MAX(version)+1 subquery, not a read-then-write", () => {
  it("two sequential setActivePlan calls for the same account get strictly increasing, non-colliding versions", async () => {
    await seedAccount(702);
    await setActivePlan(env.DB, makePlan({ userId: 702, methodology: "First" }));
    await setActivePlan(env.DB, makePlan({ userId: 702, methodology: "Second" }));
    const rows = await env.DB.prepare("SELECT version, active, methodology FROM v2_plans WHERE accountId = ? ORDER BY id ASC").bind(702).all<{ version: number; active: number; methodology: string }>();
    expect(rows.results.map((r) => r.version)).toEqual([1, 2]);
    expect(rows.results.map((r) => r.active)).toEqual([0, 1]);
    const active = await getActivePlan(env.DB, 702);
    expect(active?.methodology).toBe("Second");
  });

  it("saveDraftPlan's replacement (delete old draft, then insert) does not collide with the active plan's version", async () => {
    await seedAccount(703);
    await setActivePlan(env.DB, makePlan({ userId: 703 })); // version 1
    await saveDraftPlan(env.DB, makePlan({ userId: 703, status: "draft", active: false, methodology: "Draft A" }));
    await saveDraftPlan(env.DB, makePlan({ userId: 703, status: "draft", active: false, methodology: "Draft B" }));
    const draft = await getDraftPlan(env.DB, 703);
    expect(draft?.methodology).toBe("Draft B");
    const rows = await env.DB.prepare("SELECT id FROM v2_plans WHERE accountId = ? AND status = 'draft'").bind(703).all();
    expect(rows.results.length).toBe(1); // old draft replaced, not accumulated
  });
});

describe("v2Plans: updateActivePlanSplit / assignDraftPlan — delete+reinsert and row-promotion land atomically", () => {
  it("updateActivePlanSplit fully replaces the day/exercise rows for the active plan", async () => {
    await seedAccount(704);
    await setActivePlan(env.DB, makePlan({ userId: 704 }));
    await updateActivePlanSplit(env.DB, 704, [makeDay({ weekday: 3, muscleGroup: "Legs", exercises: [{ name: "Squat", sets: "5x5", startWeight: "100 kg", technique: "ATG" }] })]);
    const active = await getActivePlan(env.DB, 704);
    expect(active?.split.length).toBe(1);
    expect(active?.split[0].muscleGroup).toBe("Legs");
    expect(active?.split[0].exercises.map((e) => e.name)).toEqual(["Squat"]);
  });

  it("assignDraftPlan promotes the draft row in place and deactivates the old active plan in one pass", async () => {
    await seedAccount(705);
    await setActivePlan(env.DB, makePlan({ userId: 705, methodology: "Old" }));
    await saveDraftPlan(env.DB, makePlan({ userId: 705, status: "draft", active: false, methodology: "New" }));
    const draftBefore = await getDraftPlan(env.DB, 705);
    const ok = await assignDraftPlan(env.DB, 705);
    expect(ok).toBe(true);
    const active = await getActivePlan(env.DB, 705);
    expect(active?.methodology).toBe("New");
    expect(active?.id).toBe(draftBefore?.id);
    const activeCount = await env.DB.prepare("SELECT COUNT(*) AS c FROM v2_plans WHERE accountId = ? AND active = 1").bind(705).first<{ c: number }>();
    expect(activeCount?.c).toBe(1);
  });
});
