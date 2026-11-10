// Handler-level integration tests against a real in-memory SQLite + fake context. These cover
// the layer where our session/routing bugs actually lived (silently dropped/leaked session
// fields, the exit guard) — see test/harness.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { newDb, makeCtx } from "./harness";
import { getOrCreateUser, updateUser, getUser } from "../src/adapters/d1/v2Users";
import { setActivePlan, getActivePlan } from "../src/adapters/d1/v2Plans";
import { setMode } from "../src/adapters/telegram/context";
import { healPlanNamesForDisplay } from "../src/features/exercise/catalog";
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
