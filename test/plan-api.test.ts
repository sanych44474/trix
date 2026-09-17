import { test } from "node:test";
import assert from "node:assert/strict";
import { newDb } from "./harness";
import { getOrCreateUser } from "../src/adapters/d1/v2Users";
import { setActivePlan } from "../src/adapters/d1/v2Plans";
import { upsertExercise } from "../src/adapters/d1/v2Catalog";
import { handlePlanApi } from "../src/webapp/planApi";
import type { Env, PlanDoc } from "../src/types";

function env(db: ReturnType<typeof newDb>): Env {
  return { DB: db, TELEGRAM_BOT_TOKEN: "test" } as unknown as Env;
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
