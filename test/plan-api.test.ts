import { test } from "node:test";
import assert from "node:assert/strict";
import { newDb } from "./harness";
import { getOrCreateUser } from "../src/adapters/d1/v2Users";
import { setActivePlan } from "../src/adapters/d1/v2Plans";
import { upsertExercise } from "../src/adapters/d1/v2Catalog";
import { handlePlanApi } from "../src/webapp/planApi";
import type { Env, PlanDoc } from "../src/types";

function env(db: ReturnType<typeof newDb>): Env {
  return { DB: db, ALLOW_DEBUG_USER: "1", TELEGRAM_BOT_TOKEN: "test" } as unknown as Env;
}

function plan(userId: number): PlanDoc {
  return {
    userId,
    active: true,
    status: "active",
    split: [{
      weekday: 1,
      muscleGroup: "Push",
      sessionType: "strength",
      durationMin: 45,
      warmUp: ["5 min bike"],
      coolDown: ["stretch"],
      exercises: [
        { name: "Bench Press", sets: "4 × 8–10", startWeight: "50 kg", technique: "controlled", metric: "reps" },
        { name: "Lat Pulldown", sets: "3 × 10", startWeight: "40 kg", technique: "full ROM", metric: "reps" },
      ],
    }],
    nutrition: { calories: 2200, protein: 160, fats: 70, carbs: 220 },
    supplements: [],
    methodology: "Linear progression",
    generatedAt: new Date("2026-01-01T00:00:00.000Z"),
    schemaVersion: 1,
  };
}

async function call(
  db: ReturnType<typeof newDb>,
  userId: number,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<Response> {
  const request = new Request(`https://example.test${path}${path.includes("?") ? "&" : "?"}debugUser=${userId}`, {
    method,
    headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return handlePlanApi(request, new URL(request.url), env(db));
}

test("plan editor: catalog search and add/move/link/swap/video/delete round-trip through the API", async () => {
  const db = newDb();
  await getOrCreateUser(db, 1, 1, "en", "Ann");
  await setActivePlan(db, plan(1));
  await upsertExercise(db, {
    id: "incline-press",
    name: "Incline Press",
    muscle: "chest",
    equipments: ["barbell"],
    instructions: "Keep the shoulder blades set.",
    safetyInfo: "Use a controlled range.",
  });

  const catalog = await call(db, 1, "GET", "/api/plan/catalog?q=incline");
  assert.equal(catalog.status, 200);
  assert.deepEqual(await catalog.json(), { items: [{ id: "incline-press", name: "Incline Press", muscle: "chest" }] });

  const initial = await call(db, 1, "GET", "/api/plan");
  assert.equal(initial.status, 200);
  let current = await initial.json() as { version: string; days: PlanDoc["split"] };
  const edit = async (body: Record<string, unknown>) => {
    const response = await call(db, 1, "POST", "/api/plan", body, { "if-match": `"${current.version}"` });
    assert.equal(response.status, 200);
    current = await response.json() as typeof current;
  };

  await edit({ weekday: 1, index: -1, action: "add", name: "Cable Curl" });
  assert.equal(current.days[0].exercises.length, 3);
  await edit({ weekday: 1, index: 2, action: "move", dir: "up", expectName: "Cable Curl" });
  assert.equal(current.days[0].exercises[1].name, "Cable Curl");
  await edit({ weekday: 1, index: 0, action: "link", expectName: "Bench Press" });
  assert.equal(current.days[0].exercises[0].ssGroup, current.days[0].exercises[1].ssGroup);
  await edit({ weekday: 1, index: 1, action: "swap", name: "Incline Press", catalogId: "incline-press", expectName: "Cable Curl" });
  assert.equal(current.days[0].exercises[1].name, "Incline Press");
  await edit({ weekday: 1, index: 0, action: "video", value: "https://youtu.be/dQw4w9WgXcQ", expectName: "Bench Press" });
  assert.match(current.days[0].exercises[0].videoUrl ?? "", /dQw4w9WgXcQ/);
  await edit({ weekday: 1, index: 2, action: "del", expectName: current.days[0].exercises[2].name });
  assert.equal(current.days[0].exercises.length, 2);
});

// Regression: the Mini App's plan editor builds EVERY edit body through one shared helper
// (`edit()` in apps/mini-app/src/App.tsx), which serializes the payload field as `value`. The
// swap/add branch used to read `body.name` only, so every catalog swap and every add-exercise
// from the app 400'd -- reported as "a trainer picks a replacement exercise from the list and
// can't apply it to a client", but it broke a solo user's own plan the same way. The test below
// deliberately posts the payload the way the CLIENT builds it (value + catalogId, no `name`),
// not the way the handler happened to read it -- the pre-existing test above hand-writes `name`
// and so stayed green against a body the app never sends.
test("plan editor: swap and add accept the Mini App's `value` payload, not just `name`", async () => {
  const db = newDb();
  await getOrCreateUser(db, 1, 1, "en", "Ann");
  await setActivePlan(db, plan(1));
  await upsertExercise(db, {
    id: "incline-press",
    name: "Incline Press",
    muscle: "chest",
    equipments: ["barbell"],
    instructions: "Keep the shoulder blades set.",
    safetyInfo: "Use a controlled range.",
  });

  let current = await (await call(db, 1, "GET", "/api/plan")).json() as { version: string; days: PlanDoc["split"] };

  // Mirrors App.tsx's edit(): { weekday, index, action, value, expectName, ...extra }.
  const clientEdit = async (
    weekday: number,
    index: number,
    action: string,
    value: string,
    expectName?: string,
    extra: Record<string, unknown> = {},
  ) => {
    const response = await call(
      db,
      1,
      "POST",
      "/api/plan",
      { weekday, index, action, value, ...(expectName ? { expectName } : {}), ...extra },
      { "if-match": `"${current.version}"` },
    );
    assert.equal(response.status, 200, `${action} should not be rejected: ${await response.clone().text()}`);
    current = await response.json() as typeof current;
  };

  // Catalog tap: App.tsx sends the picked exercise's name as `value` plus its catalogId.
  await clientEdit(1, 1, "swap", "Incline Press", "Lat Pulldown", { catalogId: "incline-press" });
  assert.equal(current.days[0].exercises[1].name, "Incline Press");

  // Free-text swap: same helper, no catalogId.
  await clientEdit(1, 0, "swap", "Floor Press", "Bench Press");
  assert.equal(current.days[0].exercises[0].name, "Floor Press");

  // Add-exercise field: index -1, name carried in `value`.
  await clientEdit(1, -1, "add", "Cable Curl");
  assert.equal(current.days[0].exercises.length, 3);
  assert.equal(current.days[0].exercises[2].name, "Cable Curl");

  // A genuinely empty value must still be rejected -- the fix widens which field is read, it
  // does not weaken the length guard.
  const empty = await call(
    db,
    1,
    "POST",
    "/api/plan",
    { weekday: 1, index: -1, action: "add", value: " " },
    { "if-match": `"${current.version}"` },
  );
  assert.equal(empty.status, 400);
});

// The bot's editor has always written to the plan change log; the Mini App's never did, so the
// same edit left an audit trail in chat and none in the app. The log also had no reader anywhere
// in src/ -- it is now returned with the plan.
test("plan editor: Mini App edits are recorded in the change log and returned with the plan", async () => {
  const db = newDb();
  await getOrCreateUser(db, 1, 1, "en", "Ann");
  await setActivePlan(db, plan(1));

  const fresh = await (await call(db, 1, "GET", "/api/plan")).json() as { version: string; changes: Array<{ source: string; summary: string }> };
  assert.deepEqual(fresh.changes, [], "a plan with no edits yet has an empty history");

  const edited = await call(
    db,
    1,
    "POST",
    "/api/plan",
    { weekday: 1, index: 0, action: "weight", value: "60", expectName: "Bench Press" },
    { "if-match": `"${fresh.version}"` },
  );
  assert.equal(edited.status, 200);
  const result = await edited.json() as { changes: Array<{ source: string; summary: string }> };
  assert.equal(result.changes.length, 1, "the edit response carries the refreshed log");
  assert.equal(result.changes[0].source, "manual", "a user editing their own plan is 'manual'");
  assert.match(result.changes[0].summary, /Bench Press/);

  const reread = await (await call(db, 1, "GET", "/api/plan")).json() as { changes: Array<{ source: string }> };
  assert.equal(reread.changes.length, 1, "GET /plan surfaces the same log");
});

test("plan editor: a trainer's edit to a client's plan is logged as 'trainer', against the client", async () => {
  const db = newDb();
  await getOrCreateUser(db, 1, 1, "en", "Coach");
  await getOrCreateUser(db, 2, 2, "en", "Client");
  const { updateUser } = await import("../src/adapters/d1/v2Users");
  await updateUser(db, 1, { role: "trainer" });
  await updateUser(db, 2, { role: "client", trainerId: 1 });
  await setActivePlan(db, plan(2));

  const clientPlan = await (await call(db, 1, "GET", "/api/plan?clientId=2")).json() as { version: string };
  const edited = await call(
    db,
    1,
    "POST",
    "/api/plan",
    { clientId: 2, weekday: 1, index: 0, action: "sets", value: "5 × 5", expectName: "Bench Press" },
    { "if-match": `"${clientPlan.version}"` },
  );
  assert.equal(edited.status, 200, `trainer edit should succeed: ${await edited.clone().text()}`);
  const result = await edited.json() as { changes: Array<{ source: string }> };
  assert.equal(result.changes[0].source, "trainer", "so the client can tell who changed their plan");

  // The row belongs to the CLIENT's history, not the trainer's own.
  const coachOwn = await db.prepare("SELECT COUNT(*) AS n FROM v2_plan_changes WHERE accountId = 1").first<{ n: number }>();
  assert.equal(coachOwn?.n, 0);
  const clientOwn = await db.prepare("SELECT COUNT(*) AS n FROM v2_plan_changes WHERE accountId = 2").first<{ n: number }>();
  assert.equal(clientOwn?.n, 1);
});

// Whole-day editing: the Mini App could only edit exercises INSIDE existing days, while the bot
// could add and remove whole training days. These mirror src/bot/planDays.ts and share its
// DAY_GROUPS table, so a day added from either surface comes out the same.
test("plan days: add a whole day from a muscle group, and delete one", async () => {
  const db = newDb();
  await getOrCreateUser(db, 1, 1, "en", "Ann");
  await setActivePlan(db, plan(1));
  await upsertExercise(db, {
    id: "bench", name: "Bench Press", muscle: "chest", equipments: ["barbell"],
    instructions: "Set the shoulder blades.", safetyInfo: "Use a spotter.",
  });

  let current = await (await call(db, 1, "GET", "/api/plan")).json() as { version: string; days: Array<{ weekday: number }> };
  assert.equal(current.days.length, 1, "fixture starts with one day");

  const added = await call(db, 1, "POST", "/api/plan", { action: "dayadd", weekday: 3, group: "chest" }, { "if-match": `"${current.version}"` });
  assert.equal(added.status, 200, `dayadd should succeed: ${await added.clone().text()}`);
  current = await added.json() as typeof current;
  assert.deepEqual(current.days.map((d) => d.weekday), [1, 3], "days stay sorted by weekday");

  // The owner's training weekdays must follow the plan, or reminders fire on a day with no
  // session (and stay silent on the new one).
  const row = await db.prepare("SELECT profile FROM v2_profiles WHERE accountId = 1").first<{ profile: string }>();
  assert.deepEqual(JSON.parse(row?.profile ?? "{}").trainingWeekdays, [1, 3]);

  // Same weekday twice is a conflict, not a duplicate day.
  const dup = await call(db, 1, "POST", "/api/plan", { action: "dayadd", weekday: 3, group: "back" }, { "if-match": `"${current.version}"` });
  assert.equal(dup.status, 409);

  const removed = await call(db, 1, "POST", "/api/plan", { action: "daydel", weekday: 3 }, { "if-match": `"${current.version}"` });
  assert.equal(removed.status, 200);
  current = await removed.json() as typeof current;
  assert.deepEqual(current.days.map((d) => d.weekday), [1]);

  // Deleting the only remaining day would leave a plan with no training days at all.
  const lastOne = await call(db, 1, "POST", "/api/plan", { action: "daydel", weekday: 1 }, { "if-match": `"${current.version}"` });
  assert.equal(lastOne.status, 400);
});

test("plan mesocycle: GET reflects null until started, POST toggles it, and it needs no weekday/index", async () => {
  const db = newDb();
  await getOrCreateUser(db, 1, 1, "en", "Ann");
  await setActivePlan(db, plan(1));

  const before = await (await call(db, 1, "GET", "/api/plan")).json() as { mesocycle: unknown };
  assert.equal(before.mesocycle, null);

  const started = await call(db, 1, "POST", "/api/plan", { action: "meso", on: true });
  assert.equal(started.status, 200);
  assert.deepEqual(await started.json(), { ok: true });

  const after = await (await call(db, 1, "GET", "/api/plan")).json() as { mesocycle: { phase: string; weekInBlock: number; blockLength: number } };
  assert.deepEqual(after.mesocycle, { phase: "hypertrophy", weekInBlock: 1, blockLength: 4 });

  const stopped = await call(db, 1, "POST", "/api/plan", { action: "meso", on: false });
  assert.equal(stopped.status, 200);
  const cleared = await (await call(db, 1, "GET", "/api/plan")).json() as { mesocycle: unknown };
  assert.equal(cleared.mesocycle, null);
});

test("plan mesocycle: a trainer can toggle it for a client via clientId, scoped correctly", async () => {
  const db = newDb();
  await getOrCreateUser(db, 10, 10, "en", "Coach");
  const { updateUser } = await import("../src/adapters/d1/v2Users");
  await updateUser(db, 10, { role: "trainer" });
  await getOrCreateUser(db, 11, 11, "en", "Client");
  await updateUser(db, 11, { role: "client", trainerId: 10 });
  await setActivePlan(db, plan(11));

  const res = await call(db, 10, "POST", "/api/plan", { action: "meso", on: true, clientId: 11 });
  assert.equal(res.status, 200);
  const clientPlan = await (await call(db, 11, "GET", "/api/plan")).json() as { mesocycle: { phase: string } | null };
  assert.equal(clientPlan.mesocycle?.phase, "hypertrophy");
});
