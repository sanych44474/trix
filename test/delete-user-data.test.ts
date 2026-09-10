// deleteUserData (GDPR-style /deleteme wipe) — bug-hunt pass found it missed several
// user/trainer-identifying tables added after the function was first written, and left a
// deleted trainer's clients pointing at a now-nonexistent trainerId forever. Real in-memory D1
// against the actual migrations, same pattern as trainer-notes.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { newDb } from "./harness";
import {
  createProspect,
  createSharedProgram,
  deleteUserData,
  getOrCreateUser,
  getProspect,
  getSharedProgram,
  getTrainerTemplate,
  getUser,
  getUserFoodCorrection,
  linkClient,
  listClientNoteHistory,
  putUserFoodCorrection,
  saveTrainerTemplate,
  setActivePlan,
  setClientNote,
} from "../src/db/repos";
import type { BankPlan, PlanDoc } from "../src/types";

const bankPlan: BankPlan = {
  split: [{ weekday: 1, muscleGroup: "Push", exercises: [{ name: "Bench", sets: "3x8", startWeight: "50", technique: "" }] }],
  nutrition: { calories: 2000, protein: 150, fats: 60, carbs: 200 },
  supplements: [],
  methodology: "",
};

test("deleteUserData: unlinks the deleted trainer's remaining clients instead of orphaning them", async () => {
  const db = newDb();
  await getOrCreateUser(db, 1, 1, "uk", "Coach");
  await getOrCreateUser(db, 2, 2, "uk", "Ann");
  await linkClient(db, 2, 1);
  const plan: PlanDoc = {
    userId: 2, active: true, authoredBy: 1,
    split: bankPlan.split, nutrition: bankPlan.nutrition, supplements: [], methodology: "",
    generatedAt: new Date(),
  } as unknown as PlanDoc;
  await setActivePlan(db, plan);

  await deleteUserData(db, 1);

  const client = await getUser(db, 2);
  assert.equal(client?.role, "solo");
  assert.equal(client?.trainerId, undefined);
});

test("deleteUserData: clears authoredBy on plans the deleted trainer wrote (attribution only, not a live FK)", async () => {
  const db = newDb();
  await getOrCreateUser(db, 1, 1, "uk", "Coach");
  await getOrCreateUser(db, 2, 2, "uk", "Ann");
  await linkClient(db, 2, 1);
  const plan: PlanDoc = {
    userId: 2, active: true, authoredBy: 1,
    split: bankPlan.split, nutrition: bankPlan.nutrition, supplements: [], methodology: "",
    generatedAt: new Date(),
  } as unknown as PlanDoc;
  await setActivePlan(db, plan);

  await deleteUserData(db, 1);

  const row = await db.prepare("SELECT authoredBy FROM plans WHERE userId = ?").bind(2).first<{ authoredBy: number | null }>();
  assert.equal(row?.authoredBy, null);
});

test("deleteUserData: removes trainer_templates, shared_programs, trainer_prospects and client_note_history rows", async () => {
  const db = newDb();
  await getOrCreateUser(db, 1, 1, "uk", "Coach");
  await getOrCreateUser(db, 2, 2, "uk", "Ann");
  await linkClient(db, 2, 1);
  const tplId = await saveTrainerTemplate(db, 1, "Push day", bankPlan);
  await createSharedProgram(db, "shr1", 1, "Shared push", bankPlan, false);
  await createProspect(db, "prosp1", 1, "Future client");
  await setClientNote(db, 1, 2, "first note");
  await setClientNote(db, 1, 2, "second note"); // archives "first note" into client_note_history

  assert.notEqual(await getTrainerTemplate(db, 1, tplId), null);
  assert.notEqual(await getSharedProgram(db, "shr1"), null);
  assert.notEqual(await getProspect(db, "prosp1"), null);
  assert.equal((await listClientNoteHistory(db, 1, 2)).length, 1);

  await deleteUserData(db, 1);

  assert.equal(await getTrainerTemplate(db, 1, tplId), null);
  assert.equal(await getSharedProgram(db, "shr1"), null);
  assert.equal(await getProspect(db, "prosp1"), null);
  assert.deepEqual(await listClientNoteHistory(db, 1, 2), []);
});

test("deleteUserData: removes the deleted user's scheduler_dryrun_log rows, and only those", async () => {
  const db = newDb();
  await getOrCreateUser(db, 1, 1, "uk", "Ann");
  await db
    .prepare("INSERT INTO scheduler_dryrun_log (source, entityId, kind, detail, createdAt) VALUES ('user', 1, 'send', '{}', '2026-01-01')")
    .run();
  // A squad row whose entityId (a chat id) collides numerically with this user's id must
  // survive — source is what disambiguates them, not entityId alone.
  await db
    .prepare("INSERT INTO scheduler_dryrun_log (source, entityId, kind, detail, createdAt) VALUES ('squad', 1, 'send', '{}', '2026-01-01')")
    .run();

  await deleteUserData(db, 1);

  const remaining = await db.prepare("SELECT source, entityId FROM scheduler_dryrun_log").all<{ source: string; entityId: number }>();
  assert.deepEqual(remaining.results.map((r) => [r.source, r.entityId]), [["squad", 1]]);
});

test("deleteUserData: removes the deleted user's own food_corrections", async () => {
  const db = newDb();
  await getOrCreateUser(db, 1, 1, "uk", "Ann");
  await putUserFoodCorrection(db, 1, "banana", { kcal: 90, protein: 1, fats: 0, carbs: 23 });
  assert.notEqual(await getUserFoodCorrection(db, 1, "banana"), null);

  await deleteUserData(db, 1);

  assert.equal(await getUserFoodCorrection(db, 1, "banana"), null);
});
