// Real handler against a real in-memory DB — same pattern as handlers.test.ts, using the
// ?debugUser dev bypass in miniAppUser (active whenever env.WORKER_URL is unset) instead of a
// signed Telegram initData header, so these exercise the actual handler code, not a mock.
import { test } from "node:test";
import assert from "node:assert/strict";
import { newDb } from "./harness";
import { getOrCreateUser, setActivePlan, updateUser, upsertWorkoutLog } from "../src/db/repos";
import { handleBuddyApi } from "../src/webapp/buddyApi";
import type { PlanDoc, UserDoc, WorkoutLogDoc } from "../src/types";

function req(url: string) {
  return new Request(`https://x${url}`);
}

test("handleBuddyApi: unauthorized without a resolvable user", async () => {
  const db = newDb();
  const res = await handleBuddyApi(req("/api/buddy"), new URL("https://x/api/buddy"), { DB: db } as never);
  assert.equal(res.status, 401);
});

test("handleBuddyApi: no buddyId set → { buddy: null }, no error", async () => {
  const db = newDb();
  await getOrCreateUser(db, 1, 1, "uk", "Ann");
  const url = new URL("https://x/api/buddy?debugUser=1");
  const res = await handleBuddyApi(req(url.pathname + url.search), url, { DB: db } as never);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { buddy: null });
});

test("handleBuddyApi: buddyId points at a user that no longer exists → { buddy: null }", async () => {
  const db = newDb();
  const me = (await getOrCreateUser(db, 1, 1, "uk", "Ann")) as unknown as UserDoc;
  await updateUser(db, 1, { profile: { ...me.profile, buddyId: 999 } });
  const url = new URL("https://x/api/buddy?debugUser=1");
  const res = await handleBuddyApi(req(url.pathname + url.search), url, { DB: db } as never);
  assert.deepEqual(await res.json(), { buddy: null });
});

test("handleBuddyApi: paired buddy returns level, streak and this-week sessions", async () => {
  const db = newDb();
  const me = (await getOrCreateUser(db, 1, 1, "uk", "Ann")) as unknown as UserDoc;
  const mate = (await getOrCreateUser(db, 2, 2, "uk", "Bo")) as unknown as UserDoc;
  await updateUser(db, 1, { profile: { ...me.profile, buddyId: 2 } });

  const plan: PlanDoc = {
    userId: 2,
    active: true,
    split: [{ weekday: 1, muscleGroup: "Push", exercises: [{ name: "Bench", sets: "3x8", startWeight: "50", technique: "" }] }],
    nutrition: { calories: 2000, protein: 150, fats: 60, carbs: 200 },
    supplements: [],
    methodology: "",
    generatedAt: new Date(),
  } as unknown as PlanDoc;
  await setActivePlan(db, plan);

  const today = new Date().toISOString().slice(0, 10);
  await upsertWorkoutLog(
    db, 2, today, 1,
    [{ name: "Bench", setsDone: [{ reps: 8, weight: 50 }], skipped: false }] as unknown as WorkoutLogDoc["exercises"],
    true,
  );

  const url = new URL("https://x/api/buddy?debugUser=1");
  const res = await handleBuddyApi(req(url.pathname + url.search), url, { DB: db } as never);
  const body = (await res.json()) as { buddy: Record<string, unknown> };
  assert.equal(body.buddy.name, mate.profile.name);
  assert.equal(body.buddy.weekWorkouts, 1);
  assert.equal(body.buddy.myWeekWorkouts, 0);
  assert.equal((body.buddy.week as unknown[]).length, 1);
  assert.equal((body.buddy.plan as unknown[]).length, 1);
});
