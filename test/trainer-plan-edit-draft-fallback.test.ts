// Bug report: "тренер не может редактировать план клиента" — viewing a client's plan (cc_plan)
// already fell back from active to draft (clientCardAction's "plan" branch), but entering the
// editor (cc_edit -> showPlanEditPicker / showPlanEditDay) only ever looked at getActivePlan.
// A client with a draft-only or orphaned plan (e.g. after leaving and rejoining a trainer --
// unlinkClient sets active=0 but not status='draft', so the old row satisfies neither selector)
// could be VIEWED but never EDITED, with a misleading "no plan" dead end. Real in-memory D1 + fake
// ctx, same pattern as prospect-invite.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { newDb, makeCtx } from "./harness";
import { getOrCreateUser, getUser, updateUser } from "../src/adapters/d1/v2Users";
import { linkClient } from "../src/adapters/d1/v2Trainer";
import { getActivePlan, saveDraftPlan, setActivePlan } from "../src/adapters/d1/v2Plans";
import { clientCardAction, showPlanEditDay, showPlanEditPicker } from "../src/features/trainer/trainer";
import type { PlanDoc, UserDoc, Weekday } from "../src/types";

function plan(userId: number, exerciseName: string): PlanDoc {
  return {
    userId, active: true, status: "active",
    split: [{ weekday: 3 as Weekday, muscleGroup: "Push", exercises: [{ name: exerciseName, sets: "3x8", startWeight: "40kg", technique: "" }] }],
    nutrition: { calories: 2200, protein: 160, fats: 70, carbs: 220 },
    supplements: [], methodology: "", generatedAt: new Date(), schemaVersion: 1,
  } as unknown as PlanDoc;
}

async function pairedClient(db: ReturnType<typeof newDb>, trainerId: number, clientId: number, name: string): Promise<UserDoc> {
  await getOrCreateUser(db, trainerId, trainerId, "en", "Coach");
  await updateUser(db, trainerId, { role: "trainer" });
  await getOrCreateUser(db, clientId, clientId, "en", name);
  await linkClient(db, clientId, trainerId);
  await updateUser(db, clientId, { role: "client", trainerId });
  return (await getUser(db, clientId)) as UserDoc;
}

test("showPlanEditPicker: a draft-only client (no active plan) gets an Assign offer, not a dead-end 'no plan' message", async () => {
  const db = newDb();
  const trainer = await pairedClient(db, 700, 701, "Maxim").then(() => getUser(db, 700)) as unknown as UserDoc;
  await saveDraftPlan(db, plan(701, "Bench Press"));
  const { ctx, sent } = makeCtx(db, trainer as unknown as Record<string, unknown>);

  await showPlanEditPicker(ctx as never, 701, "cl", "Maxim");

  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /Maxim/, "the offer should name the client");
  assert.equal(sent[0].hasKb, true, "an Assign button must be offered, not a bare dead-end message");
});

test("showPlanEditPicker: an orphaned plan (active=0, status still 'active' -- the leave/rejoin case) is treated the same as draft-only", async () => {
  const db = newDb();
  const trainer = await pairedClient(db, 710, 711, "Maxim").then(() => getUser(db, 710)) as unknown as UserDoc;
  await setActivePlan(db, plan(711, "Deadlift")); // becomes active
  // Simulate unlinkClient's own UPDATE (v2Trainer.ts) rather than a full leave/rejoin ceremony:
  // active flips to 0, status stays 'active' -- satisfies neither getActivePlan nor getDraftPlan.
  await db.prepare("UPDATE v2_plans SET active = 0 WHERE accountId = ? AND active = 1").bind(711).run();
  await saveDraftPlan(db, plan(711, "Front Squat")); // trainer generated a fresh draft afterward
  const { ctx, sent } = makeCtx(db, trainer as unknown as Record<string, unknown>);

  await showPlanEditPicker(ctx as never, 711, "cl", "Maxim");

  assert.equal(sent[0].hasKb, true);
  assert.equal(await getActivePlan(db, 711), null, "confirms the orphan really is invisible to getActivePlan");
});

test("showPlanEditPicker: a client with NO plan at all still gets the plain 'no plan' message (no regression)", async () => {
  const db = newDb();
  const trainer = await pairedClient(db, 720, 721, "NoPlanClient").then(() => getUser(db, 720)) as unknown as UserDoc;
  const { ctx, sent } = makeCtx(db, trainer as unknown as Record<string, unknown>);

  await showPlanEditPicker(ctx as never, 721, "cl", "NoPlanClient");

  assert.equal(sent.length, 1);
  assert.equal(sent[0].hasKb, false, "nothing to assign, so no Assign button");
});

test("showPlanEditPicker: a client WITH an active plan opens the normal day picker (no regression)", async () => {
  const db = newDb();
  const trainer = await pairedClient(db, 730, 731, "NormalClient").then(() => getUser(db, 730)) as unknown as UserDoc;
  await setActivePlan(db, plan(731, "Squat"));
  const { ctx, sent } = makeCtx(db, trainer as unknown as Record<string, unknown>);

  await showPlanEditPicker(ctx as never, 731, "cl", "NormalClient");

  assert.equal(sent.length, 1);
  assert.equal(sent[0].hasKb, true); // the day-picker keyboard, not the assign-offer
  assert.doesNotMatch(sent[0].text, /no plan|has a draft/i);
});

test("showPlanEditDay: a stale eday button (direct entry) on a draft-only client also offers Assign instead of a generic error", async () => {
  const db = newDb();
  const trainer = await pairedClient(db, 740, 741, "Maxim").then(() => getUser(db, 740)) as unknown as UserDoc;
  await saveDraftPlan(db, plan(741, "Row"));
  const { ctx, sent } = makeCtx(db, trainer as unknown as Record<string, unknown>);

  await showPlanEditDay(ctx as never, 741, "cl", 3 as Weekday);

  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /Maxim/);
  assert.equal(sent[0].hasKb, true);
});

test("end-to-end: tapping Assign on a draft-only client activates the plan, after which the editor opens normally", async () => {
  const db = newDb();
  const trainer = await pairedClient(db, 750, 751, "Maxim").then(() => getUser(db, 750)) as unknown as UserDoc;
  await saveDraftPlan(db, plan(751, "Overhead Press"));
  const { ctx, sent } = makeCtx(db, trainer as unknown as Record<string, unknown>);

  // First: confirm we're in the broken-before-fix state (no active plan yet).
  assert.equal(await getActivePlan(db, 751), null);

  // Tap the Assign button the fallback message offers -- same action clientCardAction("assign") runs.
  await clientCardAction(ctx as never, 751, "assign");
  assert.notEqual(await getActivePlan(db, 751), null, "assign must activate the draft");

  // Now the editor works normally, no more fallback needed.
  sent.length = 0;
  await showPlanEditPicker(ctx as never, 751, "cl", "Maxim");
  assert.equal(sent[0].hasKb, true);
  assert.doesNotMatch(sent[0].text, /has a draft plan/);
});
