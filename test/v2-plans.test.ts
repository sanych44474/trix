// Domain 3 (workout plans) v2-native repo — src/adapters/d1/v2Plans.ts. Exercises it against the
// same in-memory D1 harness the legacy repo tests use (test/harness.ts), which builds its schema
// from every migrations/*.sql file, including 0069/0070/0078 (v2_plans/v2_plan_days/
// v2_plan_exercises/v2_plan_adjustments/v2_plan_changes/v2_plan_bank).
import { test } from "node:test";
import assert from "node:assert/strict";
import { newDb } from "./harness";
import type { PlanDay, PlanDoc } from "../src/types";
import {
  assignDraftPlan,
  countActivePlans,
  countAdjustmentWeeksSince,
  deleteDraftPlan,
  getActivePlan,
  getDraftPlan,
  listActivePlans,
  listPlanBank,
  listPlanChanges,
  planStatusByUser,
  recentAdjustments,
  recordAdjustment,
  recordPlanChange,
  saveDraftPlan,
  setActivePlan,
  setProgressionRate,
  updateActivePlanSplit,
  updateDraftSplit,
  updatePlanMesocycle,
} from "../src/adapters/d1/v2Plans";

// v2_plans/v2_plan_adjustments/v2_plan_changes.accountId all FK to v2_accounts(id) — seed a
// minimal account row directly (this domain doesn't own v2_accounts; test/v2-users.test.ts
// exercises getOrCreateUser itself), same pattern as test/v2-catalog.test.ts's seedAccount.
function seedAccount(db: ReturnType<typeof newDb>, id: number): void {
  const now = new Date().toISOString();
  db.prepare(
    "INSERT INTO v2_accounts (id, legacyUserId, chatId, role, status, createdAt, updatedAt) VALUES (?, ?, ?, 'solo', 'active', ?, ?)",
  ).bind(id, id, id, now, now).run();
}

function makeDay(overrides: Partial<PlanDay> = {}): PlanDay {
  return {
    weekday: overrides.weekday ?? 1,
    muscleGroup: overrides.muscleGroup ?? "Push",
    sessionType: overrides.sessionType ?? "strength",
    durationMin: overrides.durationMin ?? 45,
    warmUp: overrides.warmUp ?? ["5 min bike"],
    coolDown: overrides.coolDown ?? ["stretch"],
    exercises: overrides.exercises ?? [
      {
        name: "Bench Press",
        sets: "4 x 8-10",
        startWeight: "50 kg",
        technique: "controlled",
        metric: "reps",
        isKeyLift: true,
        rpe: "8",
        movementPattern: "push",
      },
      {
        name: "Lat Pulldown",
        sets: "3 x 10",
        startWeight: "40 kg",
        technique: "full ROM",
      },
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
    supplements: overrides.supplements ?? [{ name: "Creatine", dose: "5g", when: "daily", effect: "strength" }],
    methodology: overrides.methodology ?? "Linear progression",
    generatedAt: overrides.generatedAt ?? new Date("2026-01-01T00:00:00.000Z"),
    schemaVersion: overrides.schemaVersion ?? 1,
    stepsTarget: overrides.stepsTarget,
    restDayNutrition: overrides.restDayNutrition,
    movementAudit: overrides.movementAudit,
    deloadInterval: overrides.deloadInterval,
    mesocycle: overrides.mesocycle,
  };
}

// ---------- setActivePlan / getActivePlan round-trip ----------

test("setActivePlan/getActivePlan: full round-trip, including fields with no dedicated column", async () => {
  const db = newDb();
  seedAccount(db, 1);
  const plan = makePlan({
    userId: 1,
    stepsTarget: 8000,
    movementAudit: "Balanced push/pull",
    deloadInterval: 5,
    restDayNutrition: { calories: 1900, protein: 160, fats: 60, carbs: 150 },
  });
  await setActivePlan(db, plan);
  const back = await getActivePlan(db, 1);
  assert.ok(back);
  assert.equal(back!.userId, 1);
  assert.equal(back!.active, true);
  assert.equal(back!.status, "active");
  assert.equal(back!.methodology, "Linear progression");
  assert.deepEqual(back!.nutrition, plan.nutrition);
  assert.deepEqual(back!.supplements, plan.supplements);
  assert.equal(back!.stepsTarget, 8000);
  assert.equal(back!.movementAudit, "Balanced push/pull");
  assert.equal(back!.deloadInterval, 5);
  assert.deepEqual(back!.restDayNutrition, plan.restDayNutrition);
  assert.equal(back!.split.length, 1);
  const day = back!.split[0];
  assert.equal(day.weekday, 1);
  assert.equal(day.muscleGroup, "Push");
  assert.equal(day.sessionType, "strength");
  assert.equal(day.durationMin, 45);
  assert.deepEqual(day.warmUp, ["5 min bike"]);
  assert.deepEqual(day.coolDown, ["stretch"]);
  assert.equal(day.exercises.length, 2);
  const bench = day.exercises[0];
  assert.equal(bench.name, "Bench Press");
  assert.equal(bench.isKeyLift, true); // no dedicated column — round-trips via meta
  assert.equal(bench.rpe, "8");
  assert.equal(bench.movementPattern, "push");
});

test("setActivePlan: deactivates the previous active plan and assigns increasing versions", async () => {
  const db = newDb();
  seedAccount(db, 2);
  await setActivePlan(db, makePlan({ userId: 2 }));
  await setActivePlan(db, makePlan({ userId: 2, methodology: "Undulating" }));
  const rows = db.dump<{ id: number; active: number; version: number; methodology: string }>(
    "SELECT id, active, version, methodology FROM v2_plans WHERE accountId = ? ORDER BY id ASC", 2,
  );
  assert.equal(rows.length, 2);
  assert.equal(rows[0].active, 0);
  assert.equal(rows[1].active, 1);
  assert.deepEqual(rows.map((r) => r.version), [1, 2]);
  const active = await getActivePlan(db, 2);
  assert.equal(active!.methodology, "Undulating");
});

test("getActivePlan: no plan returns null", async () => {
  const db = newDb();
  assert.equal(await getActivePlan(db, 999), null);
});

test("setActivePlan: rejects a plan that fails plan_lint (empty split)", async () => {
  const db = newDb();
  await assert.rejects(() => setActivePlan(db, makePlan({ userId: 3, split: [] })));
});

// ---------- draft plan lifecycle ----------

test("saveDraftPlan/getDraftPlan: trainer draft round-trips, doesn't touch the active plan", async () => {
  const db = newDb();
  seedAccount(db, 4);
  await setActivePlan(db, makePlan({ userId: 4 }));
  await saveDraftPlan(db, makePlan({ userId: 4, status: "draft", active: false, authoredBy: 99, methodology: "Trainer draft" }));
  const draft = await getDraftPlan(db, 4);
  assert.ok(draft);
  assert.equal(draft!.status, "draft");
  assert.equal(draft!.active, false);
  assert.equal(draft!.authoredBy, 99);
  const active = await getActivePlan(db, 4);
  assert.equal(active!.methodology, "Linear progression");
});

test("saveDraftPlan: replaces any prior draft (delete-then-insert)", async () => {
  const db = newDb();
  seedAccount(db, 5);
  await saveDraftPlan(db, makePlan({ userId: 5, status: "draft", active: false, methodology: "First draft" }));
  await saveDraftPlan(db, makePlan({ userId: 5, status: "draft", active: false, methodology: "Second draft" }));
  const rows = db.dump<{ id: number }>("SELECT id FROM v2_plans WHERE accountId = ? AND status = 'draft'", 5);
  assert.equal(rows.length, 1);
  const draft = await getDraftPlan(db, 5);
  assert.equal(draft!.methodology, "Second draft");
});

test("assignDraftPlan: promotes the existing draft row in place (same id), deactivates the old active plan", async () => {
  const db = newDb();
  seedAccount(db, 6);
  await setActivePlan(db, makePlan({ userId: 6, methodology: "Old active" }));
  await saveDraftPlan(db, makePlan({ userId: 6, status: "draft", active: false, methodology: "New draft" }));
  const draftBefore = await getDraftPlan(db, 6);
  const ok = await assignDraftPlan(db, 6);
  assert.equal(ok, true);
  const active = await getActivePlan(db, 6);
  assert.equal(active!.methodology, "New draft");
  assert.equal(active!.id, draftBefore!.id); // same row promoted, not a new one
  assert.equal(await getDraftPlan(db, 6), null);
});

test("assignDraftPlan: no draft returns false", async () => {
  const db = newDb();
  assert.equal(await assignDraftPlan(db, 7), false);
});

test("deleteDraftPlan: discards the draft without touching the active plan", async () => {
  const db = newDb();
  seedAccount(db, 8);
  await setActivePlan(db, makePlan({ userId: 8 }));
  await saveDraftPlan(db, makePlan({ userId: 8, status: "draft", active: false }));
  assert.equal(await deleteDraftPlan(db, 8), true);
  assert.equal(await getDraftPlan(db, 8), null);
  assert.ok(await getActivePlan(db, 8));
  assert.equal(await deleteDraftPlan(db, 8), false); // already gone
});

// ---------- split edits ----------

test("updateActivePlanSplit / updateDraftSplit: replace the split's days+exercises", async () => {
  const db = newDb();
  seedAccount(db, 9);
  await setActivePlan(db, makePlan({ userId: 9 }));
  const newSplit = [makeDay({ weekday: 2, muscleGroup: "Legs", exercises: [{ name: "Squat", sets: "5x5", startWeight: "100 kg", technique: "ATG" }] })];
  await updateActivePlanSplit(db, 9, newSplit);
  const active = await getActivePlan(db, 9);
  assert.equal(active!.split.length, 1);
  assert.equal(active!.split[0].weekday, 2);
  assert.equal(active!.split[0].muscleGroup, "Legs");
  assert.equal(active!.split[0].exercises[0].name, "Squat");

  await saveDraftPlan(db, makePlan({ userId: 9, status: "draft", active: false }));
  await updateDraftSplit(db, 9, newSplit);
  const draft = await getDraftPlan(db, 9);
  assert.equal(draft!.split[0].muscleGroup, "Legs");
});

test("updateActivePlanSplit: no active plan is a silent no-op", async () => {
  const db = newDb();
  await updateActivePlanSplit(db, 10, [makeDay()]); // no throw
});

// ---------- bulk / status queries ----------

test("listActivePlans / countActivePlans / planStatusByUser", async () => {
  const db = newDb();
  seedAccount(db, 20);
  seedAccount(db, 21);
  seedAccount(db, 22);
  await setActivePlan(db, makePlan({ userId: 20 }));
  await setActivePlan(db, makePlan({ userId: 21 }));
  await saveDraftPlan(db, makePlan({ userId: 21, status: "draft", active: false }));
  await saveDraftPlan(db, makePlan({ userId: 22, status: "draft", active: false }));

  assert.equal(await countActivePlans(db), 2);
  const list = await listActivePlans(db);
  assert.deepEqual(list.map((p) => p.userId).sort(), [20, 21]);

  const status = await planStatusByUser(db);
  assert.deepEqual(status.get(20), { active: true, draft: false });
  assert.deepEqual(status.get(21), { active: true, draft: true });
  assert.deepEqual(status.get(22), { active: false, draft: true });
});

test("listPlanBank: empty table (unseeded) returns []", async () => {
  const db = newDb();
  assert.deepEqual(await listPlanBank(db), []);
});

// ---------- plan adjustments ----------

test("recordAdjustment / countAdjustmentWeeksSince / recentAdjustments", async () => {
  const db = newDb();
  seedAccount(db, 30);
  await recordAdjustment(db, 30, 1, JSON.stringify({ bump: "5%" }));
  await new Promise((r) => setTimeout(r, 2));
  await recordAdjustment(db, 30, 2, JSON.stringify({ bump: "2.5%" }));
  const past = new Date(Date.now() - 3_600_000).toISOString();
  assert.equal(await countAdjustmentWeeksSince(db, 30, past), 2);
  const recent = await recentAdjustments(db, 30);
  assert.equal(recent.length, 2);
  assert.equal(recent[0].week, 2); // most recent first
  assert.deepEqual(JSON.parse(recent[0].changes), { bump: "2.5%" });
});

// ---------- progression rate + mesocycle ----------

test("setProgressionRate writes v2_accounts.progressionRate directly", async () => {
  const db = newDb();
  const now = new Date().toISOString();
  db.raw.exec(`INSERT INTO v2_accounts (id, legacyUserId, chatId, role, status, createdAt, updatedAt) VALUES (40, 40, 40, 'solo', 'active', '${now}', '${now}')`);
  await setProgressionRate(db, 40, "fast");
  const row = db.dump<{ progressionRate: string }>("SELECT progressionRate FROM v2_accounts WHERE id = ?", 40)[0];
  assert.equal(row.progressionRate, "fast");
});

test("updatePlanMesocycle: sets and clears the dedicated mesocycle column on the active plan", async () => {
  const db = newDb();
  seedAccount(db, 41);
  await setActivePlan(db, makePlan({ userId: 41 }));
  await updatePlanMesocycle(db, 41, { block: "hypertrophy", week: 1 } as unknown as PlanDoc["mesocycle"]);
  let active = await getActivePlan(db, 41);
  assert.deepEqual(active!.mesocycle, { block: "hypertrophy", week: 1 });
  await updatePlanMesocycle(db, 41, null);
  active = await getActivePlan(db, 41);
  assert.equal(active!.mesocycle, undefined);
});

// ---------- plan change log ----------

test("recordPlanChange / listPlanChanges", async () => {
  const db = newDb();
  seedAccount(db, 50);
  await recordPlanChange(db, 50, "manual", "Swapped bench for incline press");
  await recordPlanChange(db, 50, "injury_swap", "Removed overhead press (shoulder)");
  const changes = await listPlanChanges(db, 50);
  assert.equal(changes.length, 2);
  assert.equal(changes[0].source, "injury_swap"); // most recent first
  assert.equal(changes[1].source, "manual");
});
