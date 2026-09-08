// JSON export (Phase 5, item 3) — same underlying data as buildExportMd, serialized for
// portability instead of prose. Real in-memory D1, same pattern as trainer-notes.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { newDb } from "./harness";
import { getOrCreateUser, upsertWorkoutLog } from "../src/db/repos";
import { buildExportJson } from "../src/bot/exportData";
import type { UserDoc } from "../src/types";

test("buildExportJson: no activity at all -> null", async () => {
  const db = newDb();
  const user = (await getOrCreateUser(db, 1, 1, "uk", "Ann")) as unknown as UserDoc;
  assert.equal(await buildExportJson(db, user), null);
});

test("buildExportJson: includes profile + the seeded workout, valid JSON", async () => {
  const db = newDb();
  const user = (await getOrCreateUser(db, 1, 1, "en", "Ann")) as unknown as UserDoc;
  await upsertWorkoutLog(db, 1, "2026-09-01", 2, [{ name: "Squat", setsDone: [{ weight: 60, reps: 8 }], skipped: false }], true);
  const json = await buildExportJson(db, user);
  assert.ok(json);
  const parsed = JSON.parse(json as string);
  assert.equal(parsed.profile.name, "Ann");
  assert.equal(parsed.workouts.length, 1);
  assert.equal(parsed.workouts[0].date, "2026-09-01");
  assert.equal(parsed.workouts[0].exercises[0].name, "Squat");
  assert.ok(parsed.exportedAt);
});
