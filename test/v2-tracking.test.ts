// Domain 6 (tracking: measurements/wellbeing/water/steps/injuries/progress photos) v2-native
// repo — src/adapters/d1/v2Tracking.ts. Exercises it against the same in-memory D1 harness the
// legacy repo tests use (test/harness.ts), which builds its schema from every migrations/*.sql
// file, including 0069-0072/0076 (v2_accounts/v2_measurements/v2_wellbeing/v2_water_logs/
// v2_step_logs/v2_injuries/v2_progress_photos). Rows are keyed by v2_accounts.id, so every test
// seeds its user via v2Users.getOrCreateUser first, same as test/v2-users.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { newDb } from "./harness";
import { getOrCreateUser } from "../src/adapters/d1/v2Users";
import {
  addProgressPhoto,
  addWater,
  appendInjuryCheckin,
  bodyLogsByUser,
  createInjury,
  dailyCheckinsSince,
  extendInjury,
  getActiveInjuryByArea,
  getDailyCheckin,
  getInjury,
  getProgressPhoto,
  getStepLog,
  getWater,
  listActiveInjuries,
  listInjuriesDue,
  listProgressPhotos,
  markInjuryAsked,
  recordDailyCheckin,
  resolveInjury,
  saveBaselineBody,
  setWater,
  stepLogsSince,
  updateInjury,
  upsertBodyLog,
  upsertStepLog,
  waterLogsSince,
} from "../src/adapters/d1/v2Tracking";

async function seedUser(db: ReturnType<typeof newDb>, id: number) {
  await getOrCreateUser(db, id, id, "en");
}

// ---------- body logs / measurements ----------

test("saveBaselineBody: INSERT OR IGNORE — first call lands, a second call for the same date is a no-op", async () => {
  const db = newDb();
  await seedUser(db, 1);
  await saveBaselineBody(db, 1, "2026-01-01", 80, { waist: 90 });
  await saveBaselineBody(db, 1, "2026-01-01", 999, { waist: 1 }); // ignored — row already exists
  const logs = await bodyLogsByUser(db, 1);
  assert.equal(logs.length, 1);
  assert.equal(logs[0].weight, 80);
  assert.deepEqual(logs[0].measurements, { waist: 90 });
});

test("saveBaselineBody: no measurements -> measurements stays undefined (not an empty object)", async () => {
  const db = newDb();
  await seedUser(db, 2);
  await saveBaselineBody(db, 2, "2026-01-01", 70, undefined);
  const logs = await bodyLogsByUser(db, 2);
  assert.equal(logs[0].weight, 70);
  assert.equal(logs[0].measurements, undefined);
});

test("upsertBodyLog: atomic UPSERT — weight COALESCEs, measurements json_patch-merges instead of clobbering", async () => {
  const db = newDb();
  await seedUser(db, 3);
  await upsertBodyLog(db, 3, "2026-02-01", { weight: 75, measurements: { waist: 80, chest: 100 } });
  await upsertBodyLog(db, 3, "2026-02-01", { measurements: { waist: 78 } }); // weight omitted, partial measurements patch
  const logs = await bodyLogsByUser(db, 3);
  assert.equal(logs.length, 1);
  assert.equal(logs[0].weight, 75); // COALESCE kept the old weight
  assert.deepEqual(logs[0].measurements, { waist: 78, chest: 100 }); // merge-patch, not overwrite
});

test("upsertBodyLog: an update with no measurements at all leaves the stored value untouched", async () => {
  const db = newDb();
  await seedUser(db, 4);
  await upsertBodyLog(db, 4, "2026-02-01", { weight: 60, measurements: { hips: 95 } });
  await upsertBodyLog(db, 4, "2026-02-01", { weight: 61 });
  const logs = await bodyLogsByUser(db, 4);
  assert.equal(logs[0].weight, 61);
  assert.deepEqual(logs[0].measurements, { hips: 95 });
});

test("bodyLogsByUser: ordered by date ascending", async () => {
  const db = newDb();
  await seedUser(db, 5);
  await saveBaselineBody(db, 5, "2026-03-02", 1, undefined);
  await saveBaselineBody(db, 5, "2026-03-01", 2, undefined);
  const logs = await bodyLogsByUser(db, 5);
  assert.deepEqual(logs.map((l) => l.date), ["2026-03-01", "2026-03-02"]);
});

// ---------- step logs ----------

test("upsertStepLog / getStepLog: UPSERT overwrites steps for the same date", async () => {
  const db = newDb();
  await seedUser(db, 10);
  assert.equal(await getStepLog(db, 10, "2026-01-01"), null);
  await upsertStepLog(db, 10, "2026-01-01", 4000);
  await upsertStepLog(db, 10, "2026-01-01", 9000);
  assert.equal(await getStepLog(db, 10, "2026-01-01"), 9000);
});

test("stepLogsSince: filters by cutoff, ascending order", async () => {
  const db = newDb();
  await seedUser(db, 11);
  await upsertStepLog(db, 11, "2026-01-01", 1000);
  await upsertStepLog(db, 11, "2026-01-05", 5000);
  await upsertStepLog(db, 11, "2026-01-10", 9000);
  const since = await stepLogsSince(db, 11, "2026-01-05");
  assert.deepEqual(since.map((s) => s.date), ["2026-01-05", "2026-01-10"]);
  assert.equal(since[0].steps, 5000);
  assert.ok(since[0].createdAt instanceof Date);
});

// ---------- water logs ----------

test("addWater: increments in place, floored at 0, and returns the new total", async () => {
  const db = newDb();
  await seedUser(db, 20);
  assert.equal(await addWater(db, 20, "2026-01-01", 500), 500);
  assert.equal(await addWater(db, 20, "2026-01-01", 300), 800);
  assert.equal(await addWater(db, 20, "2026-01-01", -2000), 0); // MAX(0, ...) floor
});

test("setWater: absolute overwrite, floored at 0", async () => {
  const db = newDb();
  await seedUser(db, 21);
  await addWater(db, 21, "2026-01-01", 1000);
  await setWater(db, 21, "2026-01-01", 200);
  assert.equal(await getWater(db, 21, "2026-01-01"), 200);
  await setWater(db, 21, "2026-01-01", -50);
  assert.equal(await getWater(db, 21, "2026-01-01"), 0);
});

test("getWater: no row yet -> null (caller distinguishes from an explicit 0)", async () => {
  const db = newDb();
  await seedUser(db, 22);
  assert.equal(await getWater(db, 22, "2026-01-01"), null);
});

test("waterLogsSince: filters by cutoff, ascending", async () => {
  const db = newDb();
  await seedUser(db, 23);
  await setWater(db, 23, "2026-01-01", 100);
  await setWater(db, 23, "2026-01-03", 300);
  const since = await waterLogsSince(db, 23, "2026-01-02");
  // node:sqlite rows come back null-prototype — compare fields, not the whole object (same
  // "plain passthrough, not remapped" shape as legacy tracking.ts's waterLogsSince).
  assert.equal(since.length, 1);
  assert.equal(since[0].date, "2026-01-03");
  assert.equal(since[0].ml, 300);
});

// ---------- wellbeing / daily check-ins ----------

test("recordDailyCheckin / getDailyCheckin: UPSERT overwrites all three scores for the same date", async () => {
  const db = newDb();
  await seedUser(db, 30);
  assert.equal(await getDailyCheckin(db, 30, "2026-01-01"), null);
  await recordDailyCheckin(db, 30, "2026-01-01", 3, 4, 2);
  await recordDailyCheckin(db, 30, "2026-01-01", 5, 5, 1);
  const checkin = await getDailyCheckin(db, 30, "2026-01-01");
  assert.equal(checkin!.energy, 5);
  assert.equal(checkin!.sleep, 5);
  assert.equal(checkin!.stress, 1);
});

test("dailyCheckinsSince: filters by cutoff, ordered by date", async () => {
  const db = newDb();
  await seedUser(db, 31);
  await recordDailyCheckin(db, 31, "2026-01-01", 1, 1, 1);
  await recordDailyCheckin(db, 31, "2026-01-05", 2, 2, 2);
  const since = await dailyCheckinsSince(db, 31, "2026-01-03");
  assert.deepEqual(since.map((c) => c.date), ["2026-01-05"]);
});

// ---------- injuries ----------

test("createInjury / getInjury / listActiveInjuries / getActiveInjuryByArea round-trip", async () => {
  const db = newDb();
  await seedUser(db, 40);
  const id = await createInjury(db, { userId: 40, area: "knee", severity: "mild", checkAfter: "2026-02-01", swaps: [] });
  assert.ok(id > 0);
  const inj = await getInjury(db, id);
  assert.equal(inj!.userId, 40);
  assert.equal(inj!.area, "knee");
  assert.equal(inj!.status, "active");
  assert.deepEqual(inj!.checkinsHistory, []);
  assert.equal(inj!.lastAskedAt, null);

  const active = await listActiveInjuries(db, 40);
  assert.equal(active.length, 1);
  assert.equal(active[0].id, id);

  const byArea = await getActiveInjuryByArea(db, 40, "knee");
  assert.equal(byArea!.id, id);
  assert.equal(await getActiveInjuryByArea(db, 40, "shoulder"), null);
});

test("updateInjury: re-reports an existing injury, resetting lastAskedAt/resolvedAt/status", async () => {
  const db = newDb();
  await seedUser(db, 41);
  const id = await createInjury(db, { userId: 41, area: "back", severity: "mild", checkAfter: "2026-02-01", swaps: [] });
  await markInjuryAsked(db, id, "2026-01-15");
  await resolveInjury(db, id);
  await updateInjury(db, id, { area: "back", severity: "strong", checkAfter: "2026-03-01", swaps: [] });
  const inj = await getInjury(db, id);
  assert.equal(inj!.status, "active");
  assert.equal(inj!.severity, "strong");
  assert.equal(inj!.checkAfter, "2026-03-01");
  assert.equal(inj!.lastAskedAt, null);
  assert.equal(inj!.resolvedAt, null);
});

test("markInjuryAsked / listInjuriesDue: due when checkAfter has passed and not already asked today", async () => {
  const db = newDb();
  await seedUser(db, 42);
  const id = await createInjury(db, { userId: 42, area: "ankle", severity: "mild", checkAfter: "2026-01-01", swaps: [] });
  let due = await listInjuriesDue(db, 42, "2026-01-05");
  assert.deepEqual(due.map((i) => i.id), [id]);

  await markInjuryAsked(db, id, "2026-01-05");
  due = await listInjuriesDue(db, 42, "2026-01-05"); // already asked today -> excluded
  assert.deepEqual(due, []);

  due = await listInjuriesDue(db, 42, "2026-01-06"); // a new day -> due again
  assert.deepEqual(due.map((i) => i.id), [id]);
});

test("extendInjury: pushes checkAfter out and clears lastAskedAt", async () => {
  const db = newDb();
  await seedUser(db, 43);
  const id = await createInjury(db, { userId: 43, area: "wrist", severity: "mild", checkAfter: "2026-01-01", swaps: [] });
  await markInjuryAsked(db, id, "2026-01-01");
  await extendInjury(db, id, "2026-01-08");
  const inj = await getInjury(db, id);
  assert.equal(inj!.checkAfter, "2026-01-08");
  assert.equal(inj!.lastAskedAt, null);
});

test("resolveInjury: flips status to recovered, stamps resolvedAt, drops out of listActiveInjuries", async () => {
  const db = newDb();
  await seedUser(db, 44);
  const id = await createInjury(db, { userId: 44, area: "hip", severity: "strong", checkAfter: "2026-01-01", swaps: [] });
  await resolveInjury(db, id);
  const inj = await getInjury(db, id);
  assert.equal(inj!.status, "recovered");
  assert.ok(inj!.resolvedAt);
  assert.deepEqual(await listActiveInjuries(db, 44), []);
});

test("appendInjuryCheckin: appends pain-score history, sorted by date, idempotent per date", async () => {
  const db = newDb();
  await seedUser(db, 45);
  const id = await createInjury(db, { userId: 45, area: "knee", severity: "mild", checkAfter: "2026-01-01", swaps: [] });
  await appendInjuryCheckin(db, id, { date: "2026-01-10", score: 6 });
  await appendInjuryCheckin(db, id, { date: "2026-01-05", score: 8 });
  await appendInjuryCheckin(db, id, { date: "2026-01-10", score: 3 }); // same date -> replaces, not duplicates
  const inj = await getInjury(db, id);
  assert.deepEqual(inj!.checkinsHistory, [
    { date: "2026-01-05", score: 8 },
    { date: "2026-01-10", score: 3 },
  ]);
});

test("appendInjuryCheckin: missing injury id is a silent no-op", async () => {
  const db = newDb();
  await appendInjuryCheckin(db, 999999, { date: "2026-01-01", score: 5 });
  assert.equal(await getInjury(db, 999999), null);
});

// ---------- progress photos ----------

test("addProgressPhoto / listProgressPhotos / getProgressPhoto round-trip, newest first", async () => {
  const db = newDb();
  await seedUser(db, 50);
  await addProgressPhoto(db, 50, "file-1");
  await new Promise((r) => setTimeout(r, 5));
  await addProgressPhoto(db, 50, "file-2");
  const photos = await listProgressPhotos(db, 50);
  assert.equal(photos.length, 2);
  assert.equal(photos[0].fileId, "file-2"); // most recent first
  assert.equal(photos[1].fileId, "file-1");
  assert.equal(photos[0].userId, 50);

  const one = await getProgressPhoto(db, photos[0].id);
  assert.equal(one!.fileId, "file-2");
});

test("listProgressPhotos: respects the limit parameter", async () => {
  const db = newDb();
  await seedUser(db, 51);
  for (let i = 0; i < 5; i++) await addProgressPhoto(db, 51, `f${i}`);
  const photos = await listProgressPhotos(db, 51, 2);
  assert.equal(photos.length, 2);
});

test("getProgressPhoto: missing id returns null", async () => {
  const db = newDb();
  assert.equal(await getProgressPhoto(db, 999999), null);
});
