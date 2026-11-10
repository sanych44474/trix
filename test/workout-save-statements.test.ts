// The workout save writes a session's exercises and sets in a few multi-row statements and one
// batch. It used to send one INSERT per set, in batches of 50: a big session took ~40 statements
// (D1's free plan allows 50 queries per invocation, and the save does other reads and writes) and,
// past 50, was split over two transactions, so a failure in the second left half a workout stored.
import { test } from "node:test";
import assert from "node:assert/strict";
import { newDb } from "./harness";
import { getOrCreateUser } from "../src/adapters/d1/v2Users";
import { getWorkoutLog, upsertWorkoutLog } from "../src/adapters/d1/v2Workouts";

function counting(db: ReturnType<typeof newDb>) {
  const stats = { prepared: 0, batches: 0 };
  const prepare = db.prepare.bind(db);
  const batch = db.batch.bind(db);
  db.prepare = ((sql: string) => { stats.prepared++; return prepare(sql); }) as typeof db.prepare;
  db.batch = (async (s: Parameters<typeof batch>[0]) => { stats.batches++; return batch(s); }) as typeof db.batch;
  return stats;
}

const big = Array.from({ length: 10 }, (_, e) => ({
  name: `Exercise ${e + 1}`,
  skipped: false,
  rpe: e % 2 ? 8 : undefined,
  setsDone: Array.from({ length: 5 }, (_, s) => ({ weight: 50 + s * 2.5, reps: 10 - s, ...(s === 4 ? { rpe: 9 } : {}) })),
}));

test("save: a 10-exercise, 50-set session is a handful of statements in one batch, and reads back intact", async () => {
  const db = newDb();
  await getOrCreateUser(db, 1, 1, "en", "Ann");
  const stats = counting(db);
  await upsertWorkoutLog(db, 1, "2026-11-10", 2, big, true, "notes", { durationSec: 3600 });
  assert.ok(stats.prepared <= 10, `prepared ${stats.prepared} statements`);
  assert.equal(stats.batches, 1, "one transaction");
  const log = await getWorkoutLog(db, 1, "2026-11-10");
  assert.equal(log?.exercises.length, 10);
  assert.deepEqual(log?.exercises[3].setsDone.map((s) => [s.weight, s.reps]), [[50, 10], [52.5, 9], [55, 8], [57.5, 7], [60, 6]]);
  assert.equal(log?.exercises[1].rpe, 8);
  assert.equal(log?.exercises[0].setsDone[4].rpe, 9);
});

test("save: saving the day again replaces its exercises, not appends", async () => {
  const db = newDb();
  await getOrCreateUser(db, 1, 1, "en", "Ann");
  await upsertWorkoutLog(db, 1, "2026-11-10", 2, big, true);
  await upsertWorkoutLog(db, 1, "2026-11-10", 2, big.slice(0, 2), true);
  const log = await getWorkoutLog(db, 1, "2026-11-10");
  assert.equal(log?.exercises.length, 2);
  assert.equal(log?.exercises[1].setsDone.length, 5);
});
