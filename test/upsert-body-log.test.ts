// upsertBodyLog — improvement #10 from the production-readiness list rewrote this from a
// SELECT-then-UPDATE/INSERT pair (a real race: two concurrent calls for the same (userId, date)
// could both read the same "existing" row, and the second write would clobber whatever the
// first one added) into a single atomic INSERT ... ON CONFLICT ... DO UPDATE using json_patch
// for the measurements merge. This test locks in the same merge/fallback semantics the old
// code had — insert, merge, preserve-when-omitted — through the new implementation.
import { test } from "node:test";
import assert from "node:assert/strict";
import { newDb } from "./harness";
import { bodyLogsByUser, getOrCreateUser, upsertBodyLog } from "../src/db/repos";

test("upsertBodyLog: creates a new row with weight + measurements", async () => {
  const db = newDb();
  await getOrCreateUser(db, 1, 1, "uk", "Ann");
  await upsertBodyLog(db, 1, "2026-01-01", { weight: 70, measurements: { waist: 80 } });
  const [log] = await bodyLogsByUser(db, 1);
  assert.equal(log.weight, 70);
  assert.deepEqual(log.measurements, { waist: 80 });
});

test("upsertBodyLog: a later call merges measurements instead of replacing them", async () => {
  const db = newDb();
  await getOrCreateUser(db, 1, 1, "uk", "Ann");
  await upsertBodyLog(db, 1, "2026-01-01", { measurements: { waist: 80, hips: 95 } });
  await upsertBodyLog(db, 1, "2026-01-01", { measurements: { waist: 78 } }); // hips untouched
  const [log] = await bodyLogsByUser(db, 1);
  assert.deepEqual(log.measurements, { waist: 78, hips: 95 });
});

test("upsertBodyLog: omitting weight/measurements on a later call preserves the existing value", async () => {
  const db = newDb();
  await getOrCreateUser(db, 1, 1, "uk", "Ann");
  await upsertBodyLog(db, 1, "2026-01-01", { weight: 70, measurements: { waist: 80 } });
  await upsertBodyLog(db, 1, "2026-01-01", {}); // no weight, no measurements in this call
  const [log] = await bodyLogsByUser(db, 1);
  assert.equal(log.weight, 70);
  assert.deepEqual(log.measurements, { waist: 80 });
});

test("upsertBodyLog: a new weight overwrites the old one outright (not merged, it's a scalar)", async () => {
  const db = newDb();
  await getOrCreateUser(db, 1, 1, "uk", "Ann");
  await upsertBodyLog(db, 1, "2026-01-01", { weight: 70 });
  await upsertBodyLog(db, 1, "2026-01-01", { weight: 69.5 });
  const [log] = await bodyLogsByUser(db, 1);
  assert.equal(log.weight, 69.5);
});
