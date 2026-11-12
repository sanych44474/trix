// The athlete's progression limits through the real routes: saved in Settings, applied to today's
// target in the logger payload.
import { test } from "node:test";
import assert from "node:assert/strict";
import { newDb } from "./harness";
import { getOrCreateUser, getUser } from "../src/adapters/d1/v2Users";
import { setActivePlan } from "../src/adapters/d1/v2Plans";
import { upsertWorkoutLog } from "../src/adapters/d1/v2Workouts";
import { handleV2Api } from "../src/webapp/v2Api";
import { buildWorkoutTodayPayload } from "../src/webapp/workout";
import { localParts } from "../src/domain/localTime";
import type { Env, PlanDoc, UserDoc, Weekday } from "../src/types";

const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;

async function setup() {
  const db = newDb();
  await getOrCreateUser(db, 1, 1, "en", "Denys");
  const user = (await getUser(db, 1)) as UserDoc;
  const { date, weekday } = localParts(user.profile.timezone);
  await setActivePlan(db, {
    userId: 1, active: true, status: "active",
    split: [{ weekday: weekday as Weekday, muscleGroup: "Chest", exercises: [{ name: "Dumbbell Press", sets: "3 × 8–12", startWeight: "30 kg", technique: "", metric: "reps", muscles: "chest", role: "primary" }] }],
    nutrition: { calories: 2000, protein: 150, fats: 60, carbs: 200 }, supplements: [], methodology: "", generatedAt: new Date(), schemaVersion: 1,
  } as unknown as PlanDoc);
  // Last session, a week back: 3 x 12 at the 30 kg ceiling, RPE 8.
  const last = new Date(Date.parse(`${date}T00:00:00Z`) - 7 * 86_400_000).toISOString().slice(0, 10);
  await upsertWorkoutLog(db, 1, last, weekday as Weekday, [{ name: "Dumbbell Press", skipped: false, rpe: 8, setsDone: [{ weight: 30, reps: 12 }, { weight: 30, reps: 12 }, { weight: 30, reps: 12 }] }], true);
  const env = { DB: db, ALLOW_DEBUG_USER: "1", TELEGRAM_BOT_TOKEN: "t" } as unknown as Env;
  let n = 0;
  const post = async (body: unknown) => {
    const req = new Request("https://example.test/api/v2/settings?debugUser=1", { method: "POST", headers: { "content-type": "application/json", "Idempotency-Key": `prefs-${++n}-padding` }, body: JSON.stringify(body) });
    return handleV2Api(req, new URL(req.url), env, ctx);
  };
  const get = async () => {
    const req = new Request("https://example.test/api/v2/settings?debugUser=1");
    return ((await (await handleV2Api(req, new URL(req.url), env, ctx)).json()) as { data: { progression: { auto: boolean; caps: Array<{ exercise: string; kg: number }> } } }).data.progression;
  };
  const today = async () => {
    const u = (await getUser(db, 1)) as UserDoc;
    const p = await buildWorkoutTodayPayload(db, u, undefined, "t");
    return p.exercises[0];
  };
  return { db, post, get, today };
}

test("settings: a ceiling is saved, listed, applied to today's target and shown on the exercise", async () => {
  const { post, get, today } = await setup();
  assert.deepEqual(await get(), { auto: true, caps: [] });
  const before = await today();
  assert.deepEqual([before.target?.w, before.target?.step], [32, "load"], "without a ceiling the app proposes more weight");

  const res = await post({ action: "progression", exercise: "  Dumbbell Press ", capKg: 30 });
  assert.equal(res.status, 200, await res.clone().text());
  assert.deepEqual(await get(), { auto: true, caps: [{ exercise: "dumbbell press", kg: 30 }] });
  const after = await today();
  assert.equal(after.capKg, 30);
  assert.deepEqual([after.target?.w, after.target?.r, after.target?.step], [30, 13, "reps"], "same weight, one more rep");
  assert.equal(after.weightKg, 30);

  await post({ action: "progression", exercise: "dumbbell press", capKg: null });
  assert.deepEqual(await get(), { auto: true, caps: [] });
  assert.equal((await today()).target?.w, 32);
});

test("settings: automatic progression off holds today's target; on again restores it", async () => {
  const { post, get, today } = await setup();
  await post({ action: "progression", auto: false });
  assert.equal((await get()).auto, false);
  const held = await today();
  assert.deepEqual([held.target?.w, held.target?.r, held.target?.step], [30, 12, "hold"]);
  await post({ action: "progression", auto: true });
  assert.equal((await get()).auto, true);
  assert.equal((await today()).target?.step, "load");
});

test("settings: bad progression input is refused and changes nothing", async () => {
  const { post, get } = await setup();
  assert.equal((await post({ action: "progression", exercise: "Row", capKg: -4 })).status, 400);
  assert.equal((await post({ action: "progression", exercise: "Row", capKg: 5000 })).status, 400);
  assert.equal((await post({ action: "progression" })).status, 400);
  assert.deepEqual(await get(), { auto: true, caps: [] });
});
