// The AI-safety audit trail (roadmap item 7): db/repos/planChangeLog.ts's write + read.
import { test } from "node:test";
import assert from "node:assert/strict";
import { newDb } from "./harness";
import { getOrCreateUser, listPlanChanges, recordPlanChange } from "../src/db/repos";

test("recordPlanChange + listPlanChanges: round-trips source and summary, newest first", async () => {
  const db = newDb();
  await getOrCreateUser(db, 1, 1, "en", "Ann");
  await recordPlanChange(db, 1, "manual", "add: Bench Press");
  await recordPlanChange(db, 1, "ai_coach", "weight: Bench Press -> 60 kg");
  await recordPlanChange(db, 1, "injury_swap", "knee: Back Squat -> Leg Curl");

  const rows = await listPlanChanges(db, 1);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].source, "injury_swap"); // most recent first
  assert.equal(rows[2].source, "manual");
  assert.ok(rows.every((r) => r.createdAt instanceof Date));
});

test("listPlanChanges: scoped to the requesting user only", async () => {
  const db = newDb();
  await getOrCreateUser(db, 1, 1, "en", "Ann");
  await getOrCreateUser(db, 2, 2, "en", "Bob");
  await recordPlanChange(db, 1, "manual", "add: Bench Press");
  await recordPlanChange(db, 2, "manual", "add: Squat");

  const rows = await listPlanChanges(db, 1);
  assert.equal(rows.length, 1);
  assert.match(rows[0].summary, /Bench Press/);
});

test("listPlanChanges: respects the limit", async () => {
  const db = newDb();
  await getOrCreateUser(db, 1, 1, "en", "Ann");
  for (let i = 0; i < 5; i++) await recordPlanChange(db, 1, "manual", `edit ${i}`);
  const rows = await listPlanChanges(db, 1, 2);
  assert.equal(rows.length, 2);
});
