// The save response carries the rep drop-off hints (the same rule the Mini App summary uses), so
// Android shows them without re-implementing it. Covered through the real save path.
import { test } from "node:test";
import assert from "node:assert/strict";
import { newDb } from "./harness";
import { saveWorkout } from "../src/webapp/workout";
import { getOrCreateUser } from "../src/adapters/d1/v2Users";
import type { Env, UserDoc } from "../src/types";

type Entries = Parameters<typeof saveWorkout>[2];

async function lifter(id: number) {
  const db = newDb();
  const user = (await getOrCreateUser(db, id, id, "en", "Lifter")) as unknown as UserDoc;
  const env = { DB: db, TELEGRAM_BOT_TOKEN: "test" } as unknown as Env;
  return { user, env };
}

const steep = (name: string) => ({
  name,
  sets: [{ reps: 10, weight: 100 }, { reps: 8, weight: 100 }, { reps: 5, weight: 100 }],
});

test("a save with 10/8/5 reps at one weight returns the drop-off", async () => {
  const { user, env } = await lifter(9101);
  const result = await saveWorkout(env, user, [steep("Bench Press")] as Entries, "2026-01-05");
  assert.deepEqual(result.dropoffs, [{ name: "Bench Press", reps: [10, 8, 5] }]);
});

test("a save with steady reps has no dropoffs key at all", async () => {
  const { user, env } = await lifter(9102);
  const steady = [{ name: "Bench Press", sets: [{ reps: 10, weight: 80 }, { reps: 10, weight: 80 }, { reps: 9, weight: 80 }] }];
  const result = await saveWorkout(env, user, steady as Entries, "2026-01-05");
  assert.equal("dropoffs" in result, false);
});

test("a save with only two working sets has no dropoffs key", async () => {
  const { user, env } = await lifter(9103);
  const two = [{ name: "Squat", sets: [{ reps: 10, weight: 100 }, { reps: 5, weight: 100 }] }];
  const result = await saveWorkout(env, user, two as Entries, "2026-01-05");
  assert.equal("dropoffs" in result, false);
});

test("at most two dropoffs are returned, worst first", async () => {
  const { user, env } = await lifter(9104);
  const mild = [{ name: "Row", sets: [{ reps: 10, weight: 60 }, { reps: 9, weight: 60 }, { reps: 6, weight: 60 }] }];
  const entries = [...mild, steep("Bench Press"), { name: "Squat", sets: [{ reps: 10, weight: 120 }, { reps: 6, weight: 120 }, { reps: 3, weight: 120 }] }];
  const result = await saveWorkout(env, user, entries as Entries, "2026-01-05");
  assert.deepEqual(result.dropoffs?.map((d) => d.name), ["Squat", "Bench Press"]);
});
