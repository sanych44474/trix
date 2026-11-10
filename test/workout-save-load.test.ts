// The save response carries the session volume (bodyweight moves included) and the kcal estimate,
// so the Mini App and Android show the same numbers. Covered through the real save path.
import { test } from "node:test";
import assert from "node:assert/strict";
import { newDb } from "./harness";
import { saveWorkout } from "../src/webapp/workout";
import { getOrCreateUser, getUser, updateUser } from "../src/adapters/d1/v2Users";
import type { Env, UserDoc } from "../src/types";

type Entries = Parameters<typeof saveWorkout>[2];

async function lifter(id: number, weightKg?: number) {
  const db = newDb();
  await getOrCreateUser(db, id, id, "en", "Lifter");
  if (weightKg) {
    const u = (await getUser(db, id)) as UserDoc;
    await updateUser(db, id, { profile: { ...u.profile, weightKg } });
  }
  const user = (await getUser(db, id)) as UserDoc;
  return { user, env: { DB: db, TELEGRAM_BOT_TOKEN: "test" } as unknown as Env };
}

const session = [
  { name: "Bench Press", sets: [{ reps: 8, weight: 80 }], rpe: 9 },
  { name: "Pull-up", sets: [{ reps: 10, weight: 0 }] },
] as Entries;

test("save: pull-ups at 0 kg add the body weight to the volume, and the kcal estimate comes back", async () => {
  const { user, env } = await lifter(9201, 80);
  const result = await saveWorkout(env, user, session, "2026-01-05", { durationSec: 3600 });
  assert.equal(result.volumeKg, 640 + 800);
  assert.equal(result.kcal, 480, "6 MET (RPE 9) × 80 kg × 1 h");
});

test("save: no body weight in the profile, volume counts only what was logged and there is no kcal key", async () => {
  const { user, env } = await lifter(9202);
  const result = await saveWorkout(env, user, session, "2026-01-05", { durationSec: 3600 });
  assert.equal(result.volumeKg, 640);
  assert.equal("kcal" in result, false);
});
