// Domain 7 (trainer relationships/requests/questions/templates/client cards/notes/messages/
// prospects) v2-native repo — src/adapters/d1/v2Trainer.ts. Exercises it directly against the
// same in-memory D1 harness the legacy repo tests use (test/harness.ts), which builds its schema
// from every migrations/*.sql file, including 0072/0077 (v2_trainers/v2_trainer_relationships/
// v2_trainer_requests/v2_trainer_questions/v2_trainer_templates/v2_client_cards/v2_client_notes/
// v2_client_note_history/v2_messages/v2_trainer_prospects/v2_shared_programs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { newDb } from "./harness";
import { getOrCreateUser, getUser } from "../src/adapters/d1/v2Users";
import {
  applyTrainer,
  approveTrainer,
  bumpSharedTaken,
  countByRole,
  countClientsOf,
  countPendingClientRequests,
  createProspect,
  createQuestion,
  createRequest,
  createSharedProgram,
  deleteProspect,
  deleteTrainerTemplate,
  getClientCard,
  getClientForTrainer,
  getClientNote,
  getProspect,
  getQuestion,
  getRequest,
  getSharedProgram,
  getTrainer,
  getTrainerByCode,
  getTrainerTemplate,
  insertMessage,
  linkClient,
  listClientNoteHistory,
  listClients,
  listMessages,
  listProspects,
  listPublicPrograms,
  listQuestionsForTrainer,
  listTrainerTemplates,
  listTrainerUsers,
  pendingRequestForClient,
  pendingRequestsAll,
  pendingRequestsForTrainer,
  pendingTrainerApplications,
  rejectTrainer,
  saveTrainerTemplate,
  setClientCard,
  setClientNote,
  setQuestionDraft,
  setQuestionStatus,
  setRequestStatus,
  setRole,
  unlinkClient,
  updateTrainer,
} from "../src/adapters/d1/v2Trainer";

const BANK_PLAN = {
  split: [],
  nutrition: { calories: 2000, protein: 150, fats: 60, carbs: 200 },
  supplements: [],
  methodology: "test",
};

// ---------- client notes / cards ----------

test("getClientNote/setClientNote: round-trips and archives the previous value", async () => {
  const db = newDb();
  await getOrCreateUser(db, 1, 1, "en"); // trainer
  await getOrCreateUser(db, 2, 2, "en"); // client
  assert.equal(await getClientNote(db, 1, 2), null);

  await setClientNote(db, 1, 2, "first note");
  assert.equal(await getClientNote(db, 1, 2), "first note");
  assert.deepEqual(await listClientNoteHistory(db, 1, 2), []); // nothing archived yet (no prior value)

  await setClientNote(db, 1, 2, "second note");
  assert.equal(await getClientNote(db, 1, 2), "second note");
  const history = await listClientNoteHistory(db, 1, 2, "note");
  assert.equal(history.length, 1);
  assert.equal(history[0].value, "first note");
});

test("getClientCard/setClientCard: partial patches preserve untouched fields, archive overwritten ones", async () => {
  const db = newDb();
  await getOrCreateUser(db, 3, 3, "en");
  await getOrCreateUser(db, 4, 4, "en");
  assert.equal(await getClientCard(db, 3, 4), null);

  await setClientCard(db, 3, 4, { healthNotes: "asthma", birthday: "05-10" });
  let card = await getClientCard(db, 3, 4);
  assert.equal(card!.healthNotes, "asthma");
  assert.equal(card!.birthday, "05-10");
  assert.equal(card!.personalNotes, null);

  await setClientCard(db, 3, 4, { healthNotes: "asthma, controlled" });
  card = await getClientCard(db, 3, 4);
  assert.equal(card!.healthNotes, "asthma, controlled");
  assert.equal(card!.birthday, "05-10"); // untouched field preserved

  const history = await listClientNoteHistory(db, 3, 4, "healthNotes");
  assert.equal(history.length, 1);
  assert.equal(history[0].value, "asthma");
});

// ---------- trainer profile lifecycle ----------

test("applyTrainer/getTrainer/approveTrainer/rejectTrainer/updateTrainer: full profile round-trip", async () => {
  const db = newDb();
  await getOrCreateUser(db, 10, 10, "en");
  await applyTrainer(db, 10, {
    name: "Coach Ann", bio: "Strength coach", specialization: "strength", tags: ["strength", "rehab"],
    certifications: "NASM", experienceYears: 5, approach: "progressive overload", priceOnline: 50,
    priceOffline: 80, currency: "USD", city: "Kyiv", contact: "@ann", languages: ["uk", "en"],
    photoFileId: "file123", profileComplete: true,
  });
  let t = await getTrainer(db, 10);
  assert.equal(t!.status, "pending");
  assert.equal(t!.name, "Coach Ann");
  assert.deepEqual(t!.tags, ["strength", "rehab"]);
  assert.deepEqual(t!.languages, ["uk", "en"]);
  assert.equal(t!.priceOnline, 50);
  assert.equal(t!.currency, "USD");
  assert.equal(t!.profileComplete, true);
  assert.equal(t!.maxClients, undefined);
  assert.equal(t!.isInstructor, false);

  await approveTrainer(db, 10, "CODE123");
  t = await getTrainer(db, 10);
  assert.equal(t!.status, "approved");
  assert.equal(t!.inviteCode, "CODE123");
  assert.ok(t!.approvedAt);
  const u = await getUser(db, 10);
  assert.equal(u!.role, "trainer");

  const byCode = await getTrainerByCode(db, "CODE123");
  assert.equal(byCode!.trainerId, 10);

  await updateTrainer(db, 10, { maxClients: 5, isInstructor: true, accepting: false });
  t = await getTrainer(db, 10);
  assert.equal(t!.maxClients, 5);
  assert.equal(t!.isInstructor, true);
  assert.equal(t!.accepting, false);

  await rejectTrainer(db, 10);
  t = await getTrainer(db, 10);
  assert.equal(t!.status, "rejected");
  // A rejected trainer's invite code no longer resolves.
  assert.equal(await getTrainerByCode(db, "CODE123"), null);
});

test("pendingTrainerApplications lists pending trainers by createdAt", async () => {
  const db = newDb();
  await getOrCreateUser(db, 20, 20, "en");
  await applyTrainer(db, 20, { name: "Pending Coach" });
  const apps = await pendingTrainerApplications(db);
  // node:sqlite's .all() returns null-prototype row objects (a harness quirk, not real D1
  // behavior) -- compare extracted fields rather than deepEqual against a plain-object literal.
  assert.deepEqual(apps.map((a) => ({ trainerId: a.trainerId, name: a.name })), [{ trainerId: 20, name: "Pending Coach" }]);
});

// ---------- linkClient/unlinkClient: relationship-consistency invariant ----------

test("linkClient: sets the client role + a single active relationship row", async () => {
  const db = newDb();
  await getOrCreateUser(db, 30, 30, "en"); // client
  await getOrCreateUser(db, 31, 31, "en"); // trainer
  await linkClient(db, 30, 31);

  const u = await getUser(db, 30);
  assert.equal(u!.role, "client");
  assert.equal(u!.trainerId, 31);

  const clients = await listClients(db, 31);
  assert.deepEqual(clients.map((c) => c._id), [30]);
  assert.equal(await countClientsOf(db, 31), 1);
});

test("linkClient: re-linking to a different trainer leaves exactly one active row, never two", async () => {
  const db = newDb();
  await getOrCreateUser(db, 40, 40, "en"); // client
  await getOrCreateUser(db, 41, 41, "en"); // trainer A
  await getOrCreateUser(db, 42, 42, "en"); // trainer B

  await linkClient(db, 40, 41);
  await linkClient(db, 40, 42);

  const u = await getUser(db, 40);
  assert.equal(u!.trainerId, 42); // now trainer B

  const rows = db.dump<{ trainerId: number; status: string }>(
    "SELECT trainerId, status FROM v2_trainer_relationships WHERE clientId = ?", 40,
  );
  assert.equal(rows.length, 1); // old edge to trainer A is gone, not just marked inactive
  assert.equal(rows[0].trainerId, 42);

  assert.equal(await countClientsOf(db, 41), 0);
  assert.equal(await countClientsOf(db, 42), 1);
});

test("unlinkClient: clears the edge, reverts role, and deactivates the client's active plan", async () => {
  const db = newDb();
  await getOrCreateUser(db, 50, 50, "en");
  await getOrCreateUser(db, 51, 51, "en");
  await linkClient(db, 50, 51);
  db.raw.exec(`INSERT INTO v2_plans (accountId, version, schemaVersion, status, source, active, nutrition, createdAt, updatedAt)
    VALUES (50, 1, 1, 'active', 'ai', 1, '{}', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`);

  await unlinkClient(db, 50);

  const u = await getUser(db, 50);
  assert.equal(u!.role, "solo");
  assert.equal(u!.trainerId, undefined);
  assert.equal(await countClientsOf(db, 51), 0);

  const plan = db.dump<{ active: number }>("SELECT active FROM v2_plans WHERE accountId = 50")[0];
  assert.equal(plan.active, 0);
});

test("getClientForTrainer: only returns the user when the edge AND role both match", async () => {
  const db = newDb();
  await getOrCreateUser(db, 60, 60, "en"); // client
  await getOrCreateUser(db, 61, 61, "en"); // trainer
  await getOrCreateUser(db, 62, 62, "en"); // unrelated trainer
  await linkClient(db, 60, 61);

  assert.equal((await getClientForTrainer(db, 61, 60))!._id, 60);
  assert.equal(await getClientForTrainer(db, 62, 60), null);
  assert.equal(await getClientForTrainer(db, 61, 999), null);
});

test("listTrainerUsers / countByRole", async () => {
  const db = newDb();
  await getOrCreateUser(db, 70, 70, "en");
  await getOrCreateUser(db, 71, 71, "en");
  await setRole(db, 70, "trainer");
  assert.deepEqual((await listTrainerUsers(db)).map((u) => u._id), [70]);
  assert.equal(await countByRole(db, "trainer"), 1);
  assert.equal(await countByRole(db, "solo"), 1);
});

// ---------- requests (pairing handshake) ----------

test("createRequest: a second request from the same client cancels the first", async () => {
  const db = newDb();
  await getOrCreateUser(db, 80, 80, "en"); // client
  await getOrCreateUser(db, 81, 81, "en"); // trainer A
  await getOrCreateUser(db, 82, 82, "en"); // trainer B

  const id1 = await createRequest(db, 80, 81, "hi");
  const id2 = await createRequest(db, 80, 82);

  const r1 = await getRequest(db, id1);
  const r2 = await getRequest(db, id2);
  assert.equal(r1!.status, "cancelled");
  assert.equal(r2!.status, "pending");
  assert.equal(await countPendingClientRequests(db), 1);

  const pendingForClient = await pendingRequestForClient(db, 80);
  assert.equal(pendingForClient!.id, id2);

  const pendingForTrainer = await pendingRequestsForTrainer(db, 82);
  assert.deepEqual(pendingForTrainer.map((r) => r.id), [id2]);

  const all = await pendingRequestsAll(db);
  assert.deepEqual(all.map((r) => r.id), [id2]);

  await setRequestStatus(db, id2, "accepted");
  await linkClient(db, 80, 82);
  const u = await getUser(db, 80);
  assert.equal(u!.trainerId, 82);
});

// ---------- questions ----------

test("createQuestion/getQuestion/setQuestionStatus/setQuestionDraft/listQuestionsForTrainer", async () => {
  const db = newDb();
  await getOrCreateUser(db, 90, 90, "en");
  await getOrCreateUser(db, 91, 91, "en");
  const id = await createQuestion(db, 90, 91, "How much protein?");
  let q = await getQuestion(db, id);
  assert.equal(q!.status, "pending");
  assert.equal(q!.aiDraft, undefined);

  await setQuestionDraft(db, id, "Aim for 1.6-2.2g/kg");
  q = await getQuestion(db, id);
  assert.equal(q!.aiDraft, "Aim for 1.6-2.2g/kg");

  await setQuestionStatus(db, id, "answered");
  q = await getQuestion(db, id);
  assert.equal(q!.status, "answered");

  const list = await listQuestionsForTrainer(db, 91);
  assert.deepEqual(list.map((x) => x.id), [id]);
});

// ---------- messages ----------

test("insertMessage/listMessages: oldest first, both directions", async () => {
  const db = newDb();
  await getOrCreateUser(db, 100, 100, "en"); // trainer
  await getOrCreateUser(db, 101, 101, "en"); // client
  await insertMessage(db, 100, 101, "Hey, how's it going?");
  await new Promise((r) => setTimeout(r, 2));
  await insertMessage(db, 101, 100, "Great, thanks!");

  const thread = await listMessages(db, 100, 101);
  assert.equal(thread.length, 2);
  assert.equal(thread[0].text, "Hey, how's it going?");
  assert.equal(thread[1].text, "Great, thanks!");
  assert.equal(thread[1].fromId, 101);
});

// ---------- templates ----------

test("saveTrainerTemplate/listTrainerTemplates/getTrainerTemplate/deleteTrainerTemplate", async () => {
  const db = newDb();
  await getOrCreateUser(db, 110, 110, "en");
  const id = await saveTrainerTemplate(db, 110, "Push/Pull/Legs", BANK_PLAN);
  assert.ok(id > 0);

  const list = await listTrainerTemplates(db, 110);
  assert.deepEqual(list.map((t) => t.name), ["Push/Pull/Legs"]);

  const full = await getTrainerTemplate(db, 110, id);
  assert.equal(full!.name, "Push/Pull/Legs");
  assert.deepEqual(full!.plan, BANK_PLAN);

  assert.equal(await deleteTrainerTemplate(db, 110, id), true);
  assert.equal(await getTrainerTemplate(db, 110, id), null);
  assert.equal(await deleteTrainerTemplate(db, 110, id), false); // already gone
});

// ---------- prospects ----------

test("createProspect/getProspect/deleteProspect/listProspects: single-use claim gate", async () => {
  const db = newDb();
  await getOrCreateUser(db, 120, 120, "en");
  await createProspect(db, "PROSPECT1", 120, "Jane");
  const prospect = await getProspect(db, "PROSPECT1");
  assert.equal(prospect!.trainerId, 120);
  assert.equal(prospect!.name, "Jane");
  assert.deepEqual((await listProspects(db, 120)).map((p) => p.code), ["PROSPECT1"]);

  assert.equal(await deleteProspect(db, "PROSPECT1"), true);
  assert.equal(await deleteProspect(db, "PROSPECT1"), false); // already claimed
  assert.equal(await getProspect(db, "PROSPECT1"), null);
});

// ---------- shared programs ----------

test("createSharedProgram/getSharedProgram/listPublicPrograms/bumpSharedTaken", async () => {
  const db = newDb();
  await getOrCreateUser(db, 130, 130, "en");
  await createSharedProgram(db, "SHARE1", 130, "12-week strength", BANK_PLAN, true);
  await createSharedProgram(db, "SHARE2", 130, "private link plan", BANK_PLAN, false);

  const got = await getSharedProgram(db, "SHARE1");
  assert.equal(got!.name, "12-week strength");
  assert.deepEqual(got!.plan, BANK_PLAN);

  const publicList = await listPublicPrograms(db);
  assert.deepEqual(publicList.map((p) => p.code), ["SHARE1"]); // SHARE2 not public

  await bumpSharedTaken(db, "SHARE1");
  const afterBump = await getSharedProgram(db, "SHARE1"); // still resolvable — bump only touches takenCount
  assert.equal(afterBump!.name, "12-week strength");
  const listed = await listPublicPrograms(db);
  assert.equal(listed[0].takenCount, 1);
});
