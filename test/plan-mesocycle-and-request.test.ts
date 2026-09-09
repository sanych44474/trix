// Two of the improvement #10 (production-readiness) atomicity fixes, previously uncovered:
// updatePlanMesocycle (rewritten from SELECT-then-UPDATE to a single json_set/json_remove
// UPDATE with no read at all) and createRequest (rewritten to run its cancel-then-insert pair
// through db.batch so a failure between the two can't leave a client with zero pending
// requests). Real in-memory D1 against the actual migrations.
import { test } from "node:test";
import assert from "node:assert/strict";
import { newDb } from "./harness";
import {
  createRequest,
  getActivePlan,
  getOrCreateUser,
  getRequest,
  pendingRequestsForTrainer,
  setActivePlan,
  updatePlanMesocycle,
} from "../src/db/repos";
import type { Mesocycle } from "../src/domain/mesocycle";
import type { PlanDoc } from "../src/types";

function plan(userId: number, extra: Partial<PlanDoc> = {}): PlanDoc {
  return {
    userId, active: true, status: "active",
    split: [{ weekday: 1, muscleGroup: "Push", exercises: [{ name: "Bench", sets: "3x8", startWeight: "50", technique: "" }] }],
    nutrition: { calories: 2000, protein: 150, fats: 60, carbs: 200 },
    supplements: [], methodology: "", generatedAt: new Date(),
    ...extra,
  } as unknown as PlanDoc;
}

test("updatePlanMesocycle: sets the mesocycle, preserving a sibling meta field", async () => {
  const db = newDb();
  await getOrCreateUser(db, 1, 1, "uk", "Ann");
  await setActivePlan(db, plan(1, { stepsTarget: 8000 }));

  const meso: Mesocycle = { phase: "hypertrophy", weekInBlock: 1, blockLength: 4 };
  await updatePlanMesocycle(db, 1, meso);

  const p = await getActivePlan(db, 1);
  assert.deepEqual(p?.mesocycle, meso);
  assert.equal(p?.stepsTarget, 8000);
});

test("updatePlanMesocycle: clearing (null) removes only the mesocycle key", async () => {
  const db = newDb();
  await getOrCreateUser(db, 1, 1, "uk", "Ann");
  const meso: Mesocycle = { phase: "peak", weekInBlock: 2, blockLength: 4 };
  await setActivePlan(db, plan(1, { stepsTarget: 8000, mesocycle: meso }));

  await updatePlanMesocycle(db, 1, null);

  const p = await getActivePlan(db, 1);
  assert.equal(p?.mesocycle, undefined);
  assert.equal(p?.stepsTarget, 8000);
});

test("updatePlanMesocycle: no active plan → no-op, does not throw", async () => {
  const db = newDb();
  await getOrCreateUser(db, 1, 1, "uk", "Ann");
  await assert.doesNotReject(() => updatePlanMesocycle(db, 1, { phase: "strength", weekInBlock: 1, blockLength: 4 }));
});

test("createRequest: cancels the client's prior pending request and creates exactly one new one", async () => {
  const db = newDb();
  await getOrCreateUser(db, 1, 1, "uk", "Ann"); // client
  await getOrCreateUser(db, 2, 2, "uk", "Coach A");
  await getOrCreateUser(db, 3, 3, "uk", "Coach B");

  const firstId = await createRequest(db, 1, 2, "please take me");
  const secondId = await createRequest(db, 1, 3); // client changes their mind, requests a different trainer

  const first = await getRequest(db, firstId);
  const second = await getRequest(db, secondId);
  assert.equal(first?.status, "cancelled");
  assert.equal(second?.status, "pending");
  assert.equal(second?.trainerId, 3);

  assert.deepEqual((await pendingRequestsForTrainer(db, 2)).map((r) => r.id), []);
  assert.deepEqual((await pendingRequestsForTrainer(db, 3)).map((r) => r.id), [secondId]);
});
