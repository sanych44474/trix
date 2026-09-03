// Handler-level integration tests against a real in-memory SQLite + fake context. These cover
// the layer where our session/routing bugs actually lived (silently dropped/leaked session
// fields, the exit guard) — see test/harness.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { newDb, makeCtx } from "./harness";
import { getOrCreateUser, updateUser, getUser, setActivePlan, applyTrainer, approveTrainer, updateTrainer, getTrainer, linkClient, saveTrainerTemplate, getActivePlan } from "../src/db/repos";
import { setMode, startAddExercise, cmdLog, logPickExercise, handleLogDraftInput, guardLogExit, onLogExit, healPlanNamesForDisplay, setEntryRpe, logFinish, routeUserText, moveExercise } from "../src/bot";
import { startShareSelect, toggleShareClient, shareAssignToClients, shareLink, sharePublish, cmdLibrary, takeSharedProgram } from "../src/bot/trainer";
import { listPublicPrograms, getSharedProgram, upsertExercise, upsertExerciseTranslation } from "../src/db/repos";
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

test("non-onboarded client answering the wizard is pulled back into onboarding (regression: reply routed to trainer)", async () => {
  const db = newDb();
  const user = (await getOrCreateUser(db, 113, 113, "uk", "Maksym")) as unknown as UserDoc;
  // Reproduce the field report: a not-yet-onboarded CLIENT whose session drifted into
  // "msg_trainer" (tapped "message trainer", never sent). Sex already answered, so the next
  // wizard step is age. They type "32" — it must advance onboarding, not go to the trainer.
  user.role = "client";
  user.trainerId = 999;
  user.onboarded = false;
  user.profile = { ...user.profile, sex: "male" };
  user.session = { mode: "msg_trainer" };
  await updateUser(db, 113, { role: "client", trainerId: 999, onboarded: false, profile: user.profile, session: user.session });
  const { ctx, sent } = makeCtx(db, user as unknown as Record<string, unknown>);

  await routeUserText(ctx as never, "32");

  const reloaded = await getUser(db, 113);
  assert.equal(reloaded?.session.mode, "onboarding"); // pulled back into the wizard
  assert.equal(reloaded?.profile.age, 32); // the answer was applied
  // Nothing was sent to the trainer (999); the reply is the wizard, to the user themself.
  assert.equal(sent.some((s) => s.to === 999), false);
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

test("exit guard: leaving an unsaved log asks, and Discard clears the draft then navigates on", async () => {
  const db = newDb();
  const user = (await getOrCreateUser(db, 113, 113, "uk", "Log")) as unknown as UserDoc;
  user.onboarded = true;
  await updateUser(db, 113, { onboarded: true });
  await setActivePlan(db, plan(113));
  const { ctx, sent } = makeCtx(db, user as unknown as Record<string, unknown>);

  await cmdLog(ctx as never);
  await logPickExercise(ctx as never, 0);
  const consumed = await handleLogDraftInput(ctx as never, "80 8"); // one-line entry
  assert.equal(consumed, true);
  assert.equal(ctx.user.session.logDraft?.entries.length, 1);

  // Navigate away → guard intercepts and records the destination.
  const guarded = await guardLogExit(ctx as never, "menu:nutrition");
  assert.equal(guarded, true);
  assert.equal(ctx.user.session.pendingExitResume, "menu:nutrition");
  assert.ok(sent.some((m) => m.hasKb)); // the Save/Discard/Continue prompt was shown

  // Discard → draft gone, no workout persisted, and we land in the requested section.
  await onLogExit(ctx as never, "drop");
  const s = (await getUser(db, 113))!.session;
  assert.equal(s.mode, "nutrition"); // resumed the intended destination
  assert.equal(s.logDraft, undefined);
  assert.equal(s.pendingExitResume, undefined);
  const logs = db.dump("SELECT * FROM workout_logs WHERE userId = 113");
  assert.equal(logs.length, 0); // discarded, nothing saved
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
  const rows = db.dump<{ code: string; isPublic: number }>("SELECT code, isPublic FROM shared_programs WHERE ownerId = 220");
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
  p.split[0].exercises[0] = { name: "Dumbbell Bench Press", exerciseId: exId, sets: "3 × 8-12", startWeight: "20 kg", muscles: "chest" } as never;
  await setActivePlan(db, p);

  const stored = (await getActivePlan(db, 301))!;
  const { ctx } = makeCtx(db, u as unknown as Record<string, unknown>);
  await healPlanNamesForDisplay(ctx as never, stored, "uk");

  assert.equal(stored.split[0].exercises[0].name, "Жим гантелей лежачи");
  assert.equal(stored.split[0].exercises[0].canonicalName, "Dumbbell Bench Press"); // English kept for matching
  const reloaded = (await getActivePlan(db, 301))!;
  assert.equal(reloaded.split[0].exercises[0].name, "Жим гантелей лежачи"); // persisted, not just display
});

test("per-set RPE tap is captured on the draft and persisted onto the logged exercise", async () => {
  const db = newDb();
  const user = (await getOrCreateUser(db, 302, 302, "uk", "Rpe")) as unknown as UserDoc;
  await updateUser(db, 302, { onboarded: true });
  await setActivePlan(db, plan(302));
  const { ctx } = makeCtx(db, user as unknown as Record<string, unknown>);

  await cmdLog(ctx as never);
  await logPickExercise(ctx as never, 0);
  await handleLogDraftInput(ctx as never, "80 8");
  await setEntryRpe(ctx as never, 0, 85); // "hard (1-2 left)" → RPE 8.5
  assert.equal(ctx.user.session.logDraft?.entries[0].rpe, 8.5);

  await logFinish(ctx as never);
  const logs = db.dump<{ exercises: string }>("SELECT * FROM workout_logs WHERE userId = 302");
  assert.equal(logs.length, 1);
  assert.equal(JSON.parse(logs[0].exercises)[0].rpe, 8.5); // flowed into the saved log for autoregulation
});

test("exit guard: Save persists the workout before navigating on", async () => {
  const db = newDb();
  const user = (await getOrCreateUser(db, 114, 114, "uk", "Log2")) as unknown as UserDoc;
  user.onboarded = true;
  await updateUser(db, 114, { onboarded: true });
  await setActivePlan(db, plan(114));
  const { ctx } = makeCtx(db, user as unknown as Record<string, unknown>);

  await cmdLog(ctx as never);
  await logPickExercise(ctx as never, 0);
  await handleLogDraftInput(ctx as never, "80 8,7,6"); // 3 sets, varying reps
  await guardLogExit(ctx as never, "menu:nutrition");
  await onLogExit(ctx as never, "save");

  const logs = db.dump<{ exercises: string; completed: number }>("SELECT * FROM workout_logs WHERE userId = 114");
  assert.equal(logs.length, 1);
  assert.equal(logs[0].completed, 1);
  const ex = JSON.parse(logs[0].exercises);
  assert.equal(ex[0].setsDone.length, 3); // per-set reps preserved (8/7/6)
  assert.deepEqual(ex[0].setsDone.map((s: { reps: number }) => s.reps), [8, 7, 6]);
});

// --- routing tables (callback + text-mode) ---
// The route tables replaced two giant if-chains; these tests pin the order-sensitive cases
// (specific prefix before its shorter parent, exact key beating a covering prefix).

test("callback routing: exact keys beat covering prefixes; specific prefixes beat parents", async () => {
  const { cbRouteFor } = await import("../src/bot");
  // exact beats prefix
  assert.equal(cbRouteFor("set:compete"), "set:compete");
  assert.equal(cbRouteFor("set:body"), "set:");
  assert.equal(cbRouteFor("logpast:menu"), "logpast:menu");
  assert.equal(cbRouteFor("logpast:2026-01-01"), "logpast:");
  assert.equal(cbRouteFor("wt:open"), "wt:open");
  // specific prefix beats its parent
  assert.equal(cbRouteFor("pday:delok:3"), "pday:delok:");
  assert.equal(cbRouteFor("pday:del:3"), "pday:del:");
  assert.equal(cbRouteFor("wt:open:2"), "wt:open:");
  assert.equal(cbRouteFor("wt:Bench"), "wt:");
  assert.equal(cbRouteFor("st:open:1"), "st:open:");
  assert.equal(cbRouteFor("st:Bench"), "st:");
  assert.equal(cbRouteFor("sw:custom:1:0"), "sw:custom:");
  assert.equal(cbRouteFor("sw:1:0"), "sw:");
  // near-miss lookalikes must not collide
  assert.equal(cbRouteFor("std"), "std");
  assert.equal(cbRouteFor("swc:1:0:abc"), "swc:");
  assert.equal(cbRouteFor("clean:del:5"), "clean:del:");
  assert.equal(cbRouteFor("cl:5:card"), "cl:");
  // unknown data routes nowhere (falls to MENU_MAP in the dispatcher)
  assert.equal(cbRouteFor("nope:xyz"), null);
});

test("text routing: every mode is classified exactly once (no overlap)", async () => {
  const { MODE_TEXT_HANDLERS, COACH_TEXT_MODES } = await import("../src/bot");
  for (const m of COACH_TEXT_MODES) {
    assert.ok(!(m in MODE_TEXT_HANDLERS), `mode "${m}" is both a text handler and a coach fallthrough`);
  }
});
