// Roadmap item 0: a trainer coaching a client (editPlanOwner set) must have the AI grounded in
// the CLIENT's plan/history/profile, not the trainer's own — the exact bug router.ts used to
// work around by blocking free text entirely (see the removed edit_use_buttons path). aiJSON
// itself isn't mocked anywhere in this suite, so these test the DB-only pieces that changed:
// coachContext's data source and coachEditWeekday's target resolution.
import { test } from "node:test";
import assert from "node:assert/strict";
import { newDb, makeCtx } from "./harness";
import { coachContext, coachEditWeekday } from "../src/bot/coach";
import { setEditOwner } from "../src/bot";
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

test("coachEditWeekday: resolves against the CLIENT's plan when the trainer is editing that client", async () => {
  const db = newDb();
  await getOrCreateUser(db, 11, 11, "en", "Coach");
  await applyTrainer(db, 11, { name: "Coach" });
  await approveTrainer(db, 11, "code11");
  const trainer = (await getOrCreateUser(db, 11, 11, "en", "Coach")) as unknown as UserDoc;
  await getOrCreateUser(db, 21, 21, "en", "Client");
  await linkClient(db, 21, 11);

  // Trainer's own plan trains weekday 3; the client's trains weekday 5 — if this resolves
  // against the wrong owner, the returned weekday will betray it.
  await setActivePlan(db, { ...plan(11, "Trainer Lift"), split: [{ weekday: 3, muscleGroup: "Push", exercises: [{ name: "Trainer Lift", sets: "3x8", startWeight: "50kg", technique: "" }] }] });
  await setActivePlan(db, { ...plan(21, "Client Lift"), split: [{ weekday: 5, muscleGroup: "Push", exercises: [{ name: "Client Lift", sets: "3x8", startWeight: "50kg", technique: "" }] }] });

  const { ctx } = makeCtx(db, trainer as unknown as Record<string, unknown>);
  await setEditOwner(ctx as never, 21, "cl");

  const weekday = await coachEditWeekday(ctx as never);
  assert.equal(weekday, 5);
});
