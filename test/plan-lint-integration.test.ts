// setActivePlan/saveDraftPlan wiring: plan_lint's critical issues must block the write (not just
// be computed and ignored), and schemaVersion must round-trip through real (in-memory) D1.
// Companion to plan-lint.test.ts (pure rule logic) and plan-schema.test.ts (shape validation).
import { test } from "node:test";
import assert from "node:assert/strict";
import { newDb } from "./harness";
import { getActivePlan, getOrCreateUser, saveDraftPlan, setActivePlan } from "../src/db/repos";
import { PLAN_SCHEMA_VERSION, PlanValidationError } from "../src/domain/plan-schema";
import type { PlanDoc } from "../src/types";

function plan(userId: number, extra: Partial<PlanDoc> = {}): PlanDoc {
  return {
    userId, active: true, status: "active",
    split: [{ weekday: 1, muscleGroup: "Push", exercises: [{ name: "Bench", sets: "3x8", startWeight: "50", technique: "" }] }],
    nutrition: { calories: 2000, protein: 150, fats: 60, carbs: 200 },
    supplements: [], methodology: "", generatedAt: new Date(), schemaVersion: PLAN_SCHEMA_VERSION,
    ...extra,
  } as PlanDoc;
}

test("setActivePlan: persists and round-trips schemaVersion", async () => {
  const db = newDb();
  await getOrCreateUser(db, 1, 1, "uk", "Ann");
  await setActivePlan(db, plan(1));
  const p = await getActivePlan(db, 1);
  assert.equal(p?.schemaVersion, PLAN_SCHEMA_VERSION);
});

test("setActivePlan: rejects a plan with a critical plan_lint issue (duplicate exercise)", async () => {
  const db = newDb();
  await getOrCreateUser(db, 2, 2, "uk", "Bob");
  const p = plan(2, {
    split: [{
      weekday: 1,
      muscleGroup: "Push",
      exercises: [
        { name: "Bench", sets: "3x8", startWeight: "50", technique: "" },
        { name: "bench", sets: "3x8", startWeight: "50", technique: "" },
      ],
    }],
  });
  await assert.rejects(() => setActivePlan(db, p), PlanValidationError);
  assert.equal(await getActivePlan(db, 2), null); // rejected save must not have written anything
});

test("saveDraftPlan: rejects a plan with an invalid nutrition target", async () => {
  const db = newDb();
  await getOrCreateUser(db, 3, 3, "uk", "Cid");
  const p = plan(3, { nutrition: { calories: -100, protein: 150, fats: 60, carbs: 200 } });
  await assert.rejects(() => saveDraftPlan(db, p), PlanValidationError);
});

test("setActivePlan: a plan referencing an unknown catalog exerciseId is rejected", async () => {
  const db = newDb();
  await getOrCreateUser(db, 4, 4, "uk", "Dee");
  const p = plan(4, {
    split: [{ weekday: 1, muscleGroup: "Push", exercises: [{ name: "Bench", exerciseId: "does-not-exist", sets: "3x8", startWeight: "50", technique: "" }] }],
  });
  await assert.rejects(() => setActivePlan(db, p), PlanValidationError);
});
