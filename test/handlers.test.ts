// Handler-level integration tests against a real in-memory SQLite + fake context. These cover
// the layer where our session/routing bugs actually lived (silently dropped/leaked session
// fields, the exit guard) — see test/harness.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { newDb, makeCtx } from "./harness";
import { getOrCreateUser, updateUser, getUser } from "../src/adapters/d1/v2Users";
import { setActivePlan, getActivePlan } from "../src/adapters/d1/v2Plans";
import { applyTrainer, approveTrainer, updateTrainer, getTrainer, linkClient } from "../src/adapters/d1/v2Trainer";
import { saveTrainerTemplate } from "../src/adapters/d1/v2TrainerPrograms";
import { setMode } from "../src/adapters/telegram/context";
import { startAddExercise } from "../src/bot/todayEdit";
import { healPlanNamesForDisplay } from "../src/features/exercise/catalog";
import { moveExercise } from "../src/bot/planReorder";
import { startShareSelect, toggleShareClient, shareAssignToClients, shareLink, sharePublish, takeSharedProgram } from "../src/features/trainer/programSharing";
import { listPublicPrograms } from "../src/adapters/d1/v2TrainerPrograms";
import { upsertExercise, upsertExerciseTranslation } from "../src/adapters/d1/v2Catalog";
import type { PlanDoc, UserDoc } from "../src/types";

function plan(userId: number): PlanDoc {
  // A day for every weekday so the test works whatever "today" is.
  const split = [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
    weekday: weekday as PlanDoc["split"][number]["weekday"],
    muscleGroup: "Full body",
    exercises: [
      { name: "Bench Press", sets: "3 × 8-10", startWeight: "60 kg", technique: "press", muscles: "chest", isKeyLift: true },
      { name: "Row", sets: "3 × 10", startWeight: "50 kg", technique: "pull", muscles: "back", isKeyLift: false },
    ],
  }));
  return {
    userId,
    active: false,
    status: "active",
    split,
    nutrition: { calories: 2000, protein: 150, fats: 60, carbs: 200 },
    supplements: [],
    methodology: "double progression",
    generatedAt: new Date(),
  } as PlanDoc;
}

test("setMode carries context across a real DB round-trip and drops transient state", async () => {
  const db = newDb();
  const user = (await getOrCreateUser(db, 111, 111, "uk", "Ann")) as unknown as UserDoc;
  user.session = { mode: "log", editPlanOwner: 222, editPlanPrefix: "cl", logDraft: { weekday: 1, entries: [{ name: "X", setsDone: [{ weight: 1, reps: 1 }] }] } };
  await updateUser(db, 111, { session: user.session });
  const { ctx } = makeCtx(db, user as unknown as Record<string, unknown>);

  await setMode(ctx as never, "idle");

  const reloaded = await getUser(db, 111);
  assert.equal(reloaded?.session.mode, "idle");
  assert.equal(reloaded?.session.editPlanOwner, 222); // context survived
  assert.equal(reloaded?.session.editPlanPrefix, "cl");
  assert.equal(reloaded?.session.logDraft, undefined); // transient dropped
});

test("moveExercise reorders a day's exercises and persists the new order", async () => {
  const db = newDb();
  const user = (await getOrCreateUser(db, 114, 114, "uk", "Ord")) as unknown as UserDoc;
  const p = plan(114);
  p.active = true;
  await setActivePlan(db, p);
  await updateUser(db, 114, { session: { mode: "idle" } }); // self-edit (no editPlanOwner)
  const { ctx } = makeCtx(db, user as unknown as Record<string, unknown>);

  // Day for weekday 1 starts as [Bench Press, Row]; move the 2nd up → [Row, Bench Press].
  await moveExercise(ctx as never, 1 as never, 1 as never, "up" as never);

  const reloaded = await getActivePlan(db, 114);
  const day = reloaded?.split.find((d) => d.weekday === 1);
  assert.deepEqual(day?.exercises.map((e) => e.name), ["Row", "Bench Press"]);
  // Out-of-range move is a no-op (index 0 can't go up), order unchanged.
  await moveExercise(ctx as never, 1 as never, 0 as never, "up" as never);
  const again = await getActivePlan(db, 114);
  assert.deepEqual(again?.split.find((d) => d.weekday === 1)?.exercises.map((e) => e.name), ["Row", "Bench Press"]);
});

test("startAddExercise preserves the edit prefix (regression: owner editing a client)", async () => {
  const db = newDb();
  const user = (await getOrCreateUser(db, 112, 112, "uk", "T")) as unknown as UserDoc;
  user.session = { mode: "idle", editPlanOwner: 999, editPlanPrefix: "ou" };
  await updateUser(db, 112, { session: user.session });
  const { ctx } = makeCtx(db, user as unknown as Record<string, unknown>);

  await startAddExercise(ctx as never, 3 as never);

  const s = (await getUser(db, 112))!.session;
  assert.equal(s.mode, "add_exercise");
  assert.equal(s.targetId, 3);
  assert.equal(s.editPlanOwner, 999);
  assert.equal(s.editPlanPrefix, "ou"); // was silently lost before the switchMode refactor
});

// Set up an instructor (owner-granted) with N clients and a saved template. Returns ids + tid.
async function setupInstructor(db: ReturnType<typeof newDb>, tid = 200, clientIds = [201, 202]) {
  const trainer = (await getOrCreateUser(db, tid, tid, "uk", "Coach")) as unknown as UserDoc;
  trainer.role = "trainer";
  await updateUser(db, tid, { role: "trainer" });
  await applyTrainer(db, tid, { name: "Coach" });
  await approveTrainer(db, tid, `code${tid}`);
  await updateTrainer(db, tid, { isInstructor: true });
  for (const id of clientIds) {
    const c = (await getOrCreateUser(db, id, id, "uk", `C${id}`)) as unknown as UserDoc;
    await updateUser(db, id, { role: "client", trainerId: tid, onboarded: true, profile: { ...c.profile, sex: "male", weightKg: 80, trainingWeekdays: [1, 3, 5] } });
    await linkClient(db, id, tid);
  }
  const templateId = await saveTrainerTemplate(db, tid, "Upper/Lower", {
    split: plan(0).split, nutrition: { calories: 2500, protein: 180, fats: 70, carbs: 250 },
    supplements: [], methodology: "double progression",
  });
  return { trainer, templateId };
}

test("instructor assigns a program to SELECTED clients only (not all)", async () => {
  const db = newDb();
  const { trainer, templateId } = await setupInstructor(db, 200, [201, 202]);
  assert.equal((await getTrainer(db, 200))?.isInstructor, true);
  const { ctx } = makeCtx(db, trainer as unknown as Record<string, unknown>);

  await startShareSelect(ctx as never, templateId);
  await toggleShareClient(ctx as never, 201); // pick ONLY 201
  await shareAssignToClients(ctx as never);

  assert.ok(await getActivePlan(db, 201), "selected client 201 got the plan");
  assert.equal(await getActivePlan(db, 202), null, "unselected client 202 did NOT");
  assert.equal(ctx.user.session.shareTemplate, undefined, "share selection cleared after assign");
});

test("non-instructor trainer cannot share", async () => {
  const db = newDb();
  const trainer = (await getOrCreateUser(db, 210, 210, "uk", "Plain")) as unknown as UserDoc;
  trainer.role = "trainer";
  await updateUser(db, 210, { role: "trainer" });
  await applyTrainer(db, 210, { name: "Plain" });
  await approveTrainer(db, 210, "code210"); // approved but NOT instructor
  const { ctx, sent } = makeCtx(db, trainer as unknown as Record<string, unknown>);
  await startShareSelect(ctx as never, 999);
  assert.ok(sent.some((m) => m.text.includes("інструктор")), "blocked with the not-allowed message");
});

test("share by link → shared_programs row; a solo user takes it as their plan", async () => {
  const db = newDb();
  const { trainer, templateId } = await setupInstructor(db, 220, []);
  const { ctx } = makeCtx(db, trainer as unknown as Record<string, unknown>);
  await shareLink(ctx as never, templateId);
  const rows = db.dump<{ code: string; isPublic: number }>("SELECT code, isPublic FROM v2_shared_programs WHERE ownerId = 220");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].isPublic, 0);

  // A solo user opens the link and takes it.
  const solo = (await getOrCreateUser(db, 221, 221, "uk", "Solo")) as unknown as UserDoc;
  await updateUser(db, 221, { profile: { ...solo.profile, sex: "male", weightKg: 75, trainingWeekdays: [1, 3, 5] } });
  const solo2 = (await getUser(db, 221))!;
  const { ctx: sctx } = makeCtx(db, solo2 as unknown as Record<string, unknown>);
  await takeSharedProgram(sctx as never, rows[0].code);
  assert.ok(await getActivePlan(db, 221), "solo user got the shared program as active plan");
});

test("publish to library → appears in the public list", async () => {
  const db = newDb();
  const { trainer, templateId } = await setupInstructor(db, 230, []);
  const { ctx } = makeCtx(db, trainer as unknown as Record<string, unknown>);
  await sharePublish(ctx as never, templateId);
  const pub = await listPublicPrograms(db, 10);
  assert.equal(pub.length, 1);
  assert.equal(pub[0].name, "Upper/Lower");
});

test("render self-heal localizes English exercise names on view and persists", async () => {
  const db = newDb();
  const u = (await getOrCreateUser(db, 301, 301, "uk", "Heal")) as unknown as UserDoc;
  await updateUser(db, 301, { onboarded: true });
  // Seed a catalog exercise + its UK translation. A translation WITH instructions is a full cache
  // hit, so exerciseInfoEntry returns the localized name without any AI call.
  const exId = "abc123def456";
  await upsertExercise(db, { id: exId, name: "Dumbbell Bench Press", muscle: "chest", difficulty: "beginner", equipments: [], instructions: "Press up.", safetyInfo: "" } as never);
  await upsertExerciseTranslation(db, exId, "uk", { name: "Жим гантелей лежачи", instructions: "Тисни вгору.", safetyInfo: "" } as never);
  // An active plan that stored the ENGLISH name (as a pre-fix template/shared assign would).
  const p = plan(301);
  p.split[0].exercises[0] = { name: "Dumbbell Bench Press", exerciseId: exId, sets: "3 × 8-12", startWeight: "20 kg", technique: "Press up.", muscles: "chest" } as never;
  await setActivePlan(db, p);

  const stored = (await getActivePlan(db, 301))!;
  const { ctx } = makeCtx(db, u as unknown as Record<string, unknown>);
  await healPlanNamesForDisplay(ctx as never, stored, "uk");

  assert.equal(stored.split[0].exercises[0].name, "Жим гантелей лежачи");
  assert.equal(stored.split[0].exercises[0].canonicalName, "Dumbbell Bench Press"); // English kept for matching
  const reloaded = (await getActivePlan(db, 301))!;
  assert.equal(reloaded.split[0].exercises[0].name, "Жим гантелей лежачи"); // persisted, not just display
});

// --- routing tables (callback + text-mode) ---
// The route tables replaced two giant if-chains; these tests pin the order-sensitive cases
// (specific prefix before its shorter parent, exact key beating a covering prefix).

// The private chat is retired (ADR-0012): only the app sign-in, the bot's own asks and the owner's
// tools are routed; every athlete and trainer button routes nowhere.
test("callback routing: the kept routes resolve, the retired chat's buttons route nowhere", async () => {
  const { cbRouteFor } = await import("../src/bot/callbackRoutes");
  for (const [data, route] of [
    ["tglogin:ok:abc", "tglogin:ok:"], ["pp:yes", "pp:yes"], ["inact:stay", "inact:stay"],
    ["share:tog:body", "share:tog:"], ["share:skip", "share:skip"], ["support:50", "support:"],
    ["orep:users", "orep:"], ["ou:5:block", "ou:"], ["trainer:approve:7", "trainer:approve:"],
    ["clean:del:5", "clean:del:"], ["fbr:12", "fbr:"], ["vid:set:1:0", "vid:set:"], ["menu:open", "menu:open"],
  ] as const) assert.equal(cbRouteFor(data), route, data);
  for (const data of ["set:body", "logpast:menu", "wt:open:2", "sw:1:0", "cl:5:card", "menu:plan", "nope:xyz"]) {
    assert.equal(cbRouteFor(data), null, data);
  }
});

test("text routing: only the bot's own asks and the owner's tools take typed text", async () => {
  const { MODE_TEXT_HANDLERS } = await import("../src/bot/textRoutes");
  assert.deepEqual(Object.keys(MODE_TEXT_HANDLERS).sort(), ["announce", "feedback_reply", "inact_feedback", "poll_price", "poll_wish", "video_url"]);
});
