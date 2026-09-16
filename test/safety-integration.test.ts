// Item 7's concrete enforcement point: applyCatalogExerciseChoice (bot.ts) is the single place
// an add/swap (AI-coach or manual — both funnel through the same exercise-confirmation flow)
// actually writes into the plan. A direct conflict with an active injury must block the write
// and leave the plan unchanged, not just be computed and ignored.
import { test } from "node:test";
import assert from "node:assert/strict";
import { newDb, makeCtx } from "./harness";
import { applyCatalogExerciseChoice, type PendingExercise } from "../src/bot";
import { getOrCreateUser } from "../src/adapters/d1/v2Users";
import { getActivePlan, listPlanChanges, setActivePlan } from "../src/adapters/d1/v2Plans";
import { createInjury } from "../src/adapters/d1/v2Tracking";
import { upsertExercise } from "../src/adapters/d1/v2Catalog";
import type { CatalogExercise, PlanDoc, UserDoc } from "../src/types";

function plan(userId: number): PlanDoc {
  return {
    userId, active: true, status: "active",
    split: [{ weekday: 1, muscleGroup: "Legs", exercises: [{ name: "Leg Extension", sets: "3x10", startWeight: "40kg", technique: "Extend." }] }],
    nutrition: { calories: 2000, protein: 150, fats: 60, carbs: 200 },
    supplements: [], methodology: "", generatedAt: new Date(), schemaVersion: 1,
  };
}

async function ctxFor(db: ReturnType<typeof newDb>, id: number) {
  const u = (await getOrCreateUser(db, id, id, "en", "Ann")) as unknown as UserDoc;
  return makeCtx(db, u as unknown as Record<string, unknown>);
}

test("applyCatalogExerciseChoice: a direct injury conflict blocks the swap and leaves the plan unchanged", async () => {
  const db = newDb();
  const { ctx } = await ctxFor(db, 1);
  await setActivePlan(db, plan(1));
  await createInjury(db, { userId: 1, area: "knee", severity: "strong", checkAfter: "2099-01-01", swaps: [] });
  const catalog: CatalogExercise = { id: "squat-1", name: "Barbell Squat", muscle: "quadriceps", equipments: [], instructions: "Squat down.", safetyInfo: "" };
  const pending: PendingExercise = { action: "swap", weekday: 1, index: 0, query: "squat", englishQuery: "squat", catalogId: catalog.id, source: "ai_coach" };

  await applyCatalogExerciseChoice(ctx as never, pending, catalog);

  const after = await getActivePlan(db, 1);
  assert.equal(after?.split[0].exercises[0].name, "Leg Extension"); // unchanged
  const changes = await listPlanChanges(db, 1);
  assert.equal(changes.length, 0); // blocked, so nothing was logged either
});

test("applyCatalogExerciseChoice: a non-conflicting swap applies and is logged with its source", async () => {
  const db = newDb();
  const { ctx } = await ctxFor(db, 2);
  await setActivePlan(db, plan(2));
  await createInjury(db, { userId: 2, area: "shoulder", severity: "strong", checkAfter: "2099-01-01", swaps: [] });
  await upsertExercise(db, { id: "curl-1", name: "Bicep Curl", muscle: "biceps", equipments: [], instructions: "Curl.", safetyInfo: "" } as never);
  const catalog: CatalogExercise = { id: "curl-1", name: "Bicep Curl", muscle: "biceps", equipments: [], instructions: "Curl.", safetyInfo: "" };
  const pending: PendingExercise = { action: "swap", weekday: 1, index: 0, query: "curl", englishQuery: "curl", catalogId: catalog.id, source: "ai_coach" };

  await applyCatalogExerciseChoice(ctx as never, pending, catalog);

  const after = await getActivePlan(db, 2);
  assert.equal(after?.split[0].exercises[0].canonicalName, "Bicep Curl");
  const changes = await listPlanChanges(db, 2);
  assert.equal(changes.length, 1);
  assert.equal(changes[0].source, "ai_coach");
  assert.match(changes[0].summary, /Leg Extension -> Bicep Curl/);
});
