// Roadmap item 0: a trainer coaching a client (editPlanOwner set) must have the AI grounded in
// the CLIENT's plan/history/profile, not the trainer's own — the exact bug router.ts used to
// work around by blocking free text entirely (see the removed edit_use_buttons path). aiJSON
// itself isn't mocked anywhere in this suite, so these test the DB-only pieces that changed:
// coachContext's data source and coachEditWeekday's target resolution.
import { test } from "node:test";
import assert from "node:assert/strict";
import { newDb, makeCtx } from "./harness";
import { coachContext } from "../src/features/coach/coachContext";
import { setEditOwner } from "../src/adapters/telegram/context";
import { getOrCreateUser } from "../src/adapters/d1/v2Users";
import { applyTrainer, approveTrainer, linkClient } from "../src/adapters/d1/v2Trainer";
import { setActivePlan } from "../src/adapters/d1/v2Plans";
import type { PlanDoc, UserDoc } from "../src/types";

function plan(userId: number, exerciseName: string): PlanDoc {
  return {
    userId, active: true, status: "active",
    split: [{ weekday: 1, muscleGroup: "Push", exercises: [{ name: exerciseName, sets: "3x8", startWeight: "50kg", technique: "" }] }],
    nutrition: { calories: 2200, protein: 160, fats: 70, carbs: 220 },
    supplements: [], methodology: "", generatedAt: new Date(), schemaVersion: 1,
  };
}

test("coachContext: grounds in the CLIENT's plan/nutrition when a trainer is editing that client, not the trainer's own", async () => {
  const db = newDb();
  await getOrCreateUser(db, 10, 10, "en", "Coach");
  await applyTrainer(db, 10, { name: "Coach" });
  await approveTrainer(db, 10, "code10");
  const trainer = (await getOrCreateUser(db, 10, 10, "en", "Coach")) as unknown as UserDoc;
  const client = (await getOrCreateUser(db, 20, 20, "en", "Client")) as unknown as UserDoc;
  await linkClient(db, 20, 10);

  await setActivePlan(db, plan(10, "Trainer's Own Exercise"));
  await setActivePlan(db, plan(20, "Client's Exercise"));

  const { ctx } = makeCtx(db, trainer as unknown as Record<string, unknown>);
  await setEditOwner(ctx as never, 20, "cl");

  const context = await coachContext(ctx as never, client);
  assert.match(context, /Client's Exercise/);
  assert.doesNotMatch(context, /Trainer's Own Exercise/);
});
