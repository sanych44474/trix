import { test } from "node:test";
import assert from "node:assert/strict";
import { newDb } from "./harness";
import { getOrCreateUser, getUser } from "../src/adapters/d1/v2Users";
import { getActivePlan, setActivePlan } from "../src/adapters/d1/v2Plans";
import { listPlanChanges } from "../src/adapters/d1/v2PlanHistory";
import { upsertExercise, upsertExerciseTranslation } from "../src/adapters/d1/v2Catalog";
import { applyPlanEdit, MAX_EX_PER_DAY, PlanEditError, type PlanEdit } from "../src/features/plan/planEdits";
import type { Env, PlanDoc, PlanExercise, UserDoc } from "../src/types";

function env(db: ReturnType<typeof newDb>): Env {
  return { DB: db, ALLOW_DEBUG_USER: "1", TELEGRAM_BOT_TOKEN: "test" } as unknown as Env;
}

function exercise(name: string, extra: Partial<PlanExercise> = {}): PlanExercise {
  return { name, sets: "3 × 8–12", startWeight: "40 kg", technique: "controlled", metric: "reps", ...extra };
}

function plan(userId: number, exercises: PlanExercise[] = [exercise("Bench Press", { startWeight: "50 kg" }), exercise("Lat Pulldown")]): PlanDoc {
  return {
    userId,
    active: true,
    status: "active",
    split: [{ weekday: 1, muscleGroup: "Push", sessionType: "strength", durationMin: 45, warmUp: [], coolDown: [], exercises }],
    nutrition: { calories: 2200, protein: 160, fats: 70, carbs: 220 },
    supplements: [],
    methodology: "Linear progression",
    generatedAt: new Date("2026-01-01T00:00:00.000Z"),
    schemaVersion: 1,
  } as unknown as PlanDoc;
}

/** Seed an owner (id 1) with an active plan and return what the module needs to apply edits. */
async function fixture(db: ReturnType<typeof newDb>, lang: "en" | "uk" = "en", exercises?: PlanExercise[]) {
  const owner: UserDoc = await getOrCreateUser(db, 1, 1, lang, "Ann");
  await setActivePlan(db, plan(1, exercises));
  const stored = await getActivePlan(db, 1);
  assert.ok(stored);
  return { owner, env: env(db), plan: stored };
}

async function apply(db: ReturnType<typeof newDb>, edit: PlanEdit, opts: { actorId?: number; expectedVersion?: string } = {}) {
  const { owner, env: e, plan: p } = await fixture(db);
  return applyPlanEdit({ env: e, owner, actorId: opts.actorId ?? 1, plan: p, expectedVersion: opts.expectedVersion }, edit);
}

test("weight: a typed weight is kept to the nearest 0.5 kg, not snapped to 2.5 kg (bot and app share the rule)", async () => {
  const db = newDb();
  const { owner, env: e, plan: p } = await fixture(db);
  const set = (value: string) => applyPlanEdit({ env: e, owner, actorId: 1, plan: p }, { kind: "weight", weekday: 1, index: 0, value });

  assert.equal((await set("82.3")).split[0].exercises[0].startWeight, "82.5 kg");
  assert.equal((await set("3")).split[0].exercises[0].startWeight, "3 kg");
  assert.equal((await set("80,7")).split[0].exercises[0].startWeight, "80.5 kg");
  // Unparseable input is stored as typed (trimmed), not rounded to a number.
  assert.equal((await set("bodyweight")).split[0].exercises[0].startWeight, "bodyweight");
});

test("history: every applied edit writes a plan-history row, and a trainer's edit is logged as 'trainer'", async () => {
  const db = newDb();
  const { owner, env: e, plan: p } = await fixture(db);
  await applyPlanEdit({ env: e, owner, actorId: 1, plan: p }, { kind: "weight", weekday: 1, index: 0, value: "60" });
  await applyPlanEdit({ env: e, owner, actorId: 1, plan: p }, { kind: "move", weekday: 1, index: 1, dir: "up" });
  await applyPlanEdit({ env: e, owner, actorId: 99, plan: p }, { kind: "sets", weekday: 1, index: 0, value: "5x5" });

  const log = await listPlanChanges(db, 1, 10);
  const newest = log.map((c) => `${c.source}|${c.summary}`);
  assert.ok(newest.includes("manual|weight: Bench Press -> 60 kg"), newest.join("\n"));
  assert.ok(newest.includes("manual|reordered: Lat Pulldown"), newest.join("\n"));
  assert.ok(newest.some((s) => s.startsWith("trainer|sets: Bench Press")), newest.join("\n"));
});

test("history: a no-op edit (move past the edge) is not written to the log", async () => {
  const db = newDb();
  const result = await apply(db, { kind: "move", weekday: 1, index: 0, dir: "up" });
  assert.equal(result.summary, "");
  assert.equal((await listPlanChanges(db, 1, 10)).length, 0);
});

test("cap: a day holds at most MAX_EX_PER_DAY exercises on add and restore, and a refused add changes nothing", async () => {
  const db = newDb();
  const full = Array.from({ length: MAX_EX_PER_DAY }, (_, i) => exercise(`Move ${i + 1}`));
  const { owner, env: e, plan: p } = await fixture(db, "en", full);

  await assert.rejects(
    applyPlanEdit({ env: e, owner, actorId: 1, plan: p }, { kind: "add", weekday: 1, name: "Incline Press" }),
    (err: unknown) => err instanceof PlanEditError && err.code === "full",
  );
  await assert.rejects(
    applyPlanEdit({ env: e, owner, actorId: 1, plan: p }, { kind: "restore", weekday: 1, index: 0, exercise: exercise("Extra") }),
    (err: unknown) => err instanceof PlanEditError && err.code === "full",
  );
  const stored = await getActivePlan(db, 1);
  assert.equal(stored?.split[0].exercises.length, MAX_EX_PER_DAY);
  assert.equal((await listPlanChanges(db, 1, 10)).length, 0);
});

test("day add/remove: the owner's training weekdays follow the plan, in the module", async () => {
  const db = newDb();
  const { owner, env: e, plan: p } = await fixture(db);
  const added = await applyPlanEdit({ env: e, owner, actorId: 1, plan: p }, { kind: "dayadd", weekday: 3, group: "chest" });
  assert.deepEqual(added.split.map((d) => d.weekday), [1, 3]);
  assert.deepEqual((await getUser(db, 1))?.profile.trainingWeekdays, [1, 3]);
  assert.equal((await getUser(db, 1))?.profile.daysPerWeek, 2);

  const after = await getActivePlan(db, 1);
  await applyPlanEdit({ env: e, owner, actorId: 1, plan: after! }, { kind: "daydel", weekday: 3 });
  assert.deepEqual((await getUser(db, 1))?.profile.trainingWeekdays, [1]);
});

test("version: an edit against a replaced plan is refused as stale and leaves the plan untouched", async () => {
  const db = newDb();
  await assert.rejects(
    apply(db, { kind: "weight", weekday: 1, index: 0, value: "70" }, { expectedVersion: "2020-01-01T00:00:00.000Z" }),
    (err: unknown) => err instanceof PlanEditError && err.code === "stale",
  );
  const stored = await getActivePlan(db, 1);
  assert.equal(stored?.split[0].exercises[0].startWeight, "50 kg");
});

test("translation: a catalog swap for a Ukrainian owner uses the catalog translation", async () => {
  const db = newDb();
  await upsertExercise(db, { id: "incline-press", name: "Incline Press", muscle: "chest", equipments: ["barbell"], instructions: "Keep the shoulder blades set.", safetyInfo: "Controlled range." });
  await upsertExerciseTranslation(db, "incline-press", "uk", { name: "Жим на похилій лаві", instructions: "Тримайте лопатки.", safetyInfo: "" });
  const { owner, env: e, plan: p } = await fixture(db, "uk");
  const result = await applyPlanEdit({ env: e, owner, actorId: 1, plan: p }, { kind: "swap", weekday: 1, index: 0, name: "Incline Press", catalogId: "incline-press" });
  const swapped = result.split[0].exercises[0];
  assert.equal(swapped.name, "Жим на похилій лаві");
  assert.equal(swapped.sets, "3 × 8–12", "a swap keeps the slot's rep scheme");
  assert.equal(swapped.startWeight, "50 kg", "a swap keeps the slot's load");
});
