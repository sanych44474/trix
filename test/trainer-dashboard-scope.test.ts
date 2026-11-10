// The trainer dashboard used to read every user's workout logs (21 days), every active plan with
// its days and exercises, every nutrition day and a GROUP BY over all plans, then keep the
// trainer's clients in JS. Its cost grew with the whole user base on every open. Each of those
// reads is now limited to the trainer's own clients.
import { test } from "node:test";
import assert from "node:assert/strict";
import { newDb } from "./harness";
import { getOrCreateUser, getUser, updateUser } from "../src/adapters/d1/v2Users";
import { linkClient } from "../src/adapters/d1/v2Trainer";
import { setActivePlan } from "../src/adapters/d1/v2Plans";
import { upsertWorkoutLog } from "../src/adapters/d1/v2Workouts";
import { buildDashboardPayload } from "../src/adapters/d1/dashboardReader";
import { localParts } from "../src/domain/localTime";
import type { PlanDoc, UserDoc, Weekday } from "../src/types";

const plan = (userId: number, weekday: number) => ({
  userId, active: true, status: "active",
  split: [{ weekday, muscleGroup: "Push", exercises: [{ name: "Bench Press", sets: "3 × 8", startWeight: "40 kg", technique: "" }] }],
  nutrition: { calories: 2000, protein: 150, fats: 60, carbs: 200 }, supplements: [], methodology: "",
  generatedAt: new Date("2026-01-01T00:00:00.000Z"), schemaVersion: 1,
}) as unknown as PlanDoc;

test("trainer dashboard: per-user tables are read for the trainer's clients only", async () => {
  const db = newDb();
  const { date: today, weekday } = localParts("UTC");
  await getOrCreateUser(db, 900, 900, "en", "Coach");
  await updateUser(db, 900, { role: "trainer" });
  for (const id of [901, 902]) {
    await getOrCreateUser(db, id, id, "en", `Client ${id}`);
    await linkClient(db, id, 900);
    await updateUser(db, id, { role: "client", trainerId: 900 });
    await setActivePlan(db, plan(id, weekday));
    await upsertWorkoutLog(db, id, today, weekday as Weekday, [{ name: "Bench Press", skipped: false, setsDone: [{ weight: 40, reps: 8 }] }], true);
  }
  // Somebody else's data the trainer's dashboard has no business reading.
  await getOrCreateUser(db, 950, 950, "en", "Stranger");
  await setActivePlan(db, plan(950, weekday));
  await upsertWorkoutLog(db, 950, today, weekday as Weekday, [{ name: "Squat", skipped: false, setsDone: [{ weight: 100, reps: 5 }] }], true);

  const seen: string[] = [];
  const realPrepare = db.prepare.bind(db);
  (db as { prepare: typeof db.prepare }).prepare = ((sql: string) => { seen.push(sql); return realPrepare(sql); }) as typeof db.prepare;

  const payload = await buildDashboardPayload(db, (await getUser(db, 900)) as UserDoc);
  assert.deepEqual(payload.trainer?.clients.map((c) => c.id).sort(), [901, 902]);

  const unscoped = seen.filter((sql) =>
    /FROM v2_(workout_sessions|plans|nutrition_days)\b/.test(sql) &&
    !/accountId\s*(=|IN)/i.test(sql),
  );
  assert.deepEqual(unscoped, [], "every per-user read names the accounts it wants");
});
