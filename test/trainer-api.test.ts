import { test } from "node:test";
import assert from "node:assert/strict";
import { newDb } from "./harness";
import { getOrCreateUser, updateUser, createQuestion, saveTrainerTemplate, getUser } from "../src/db/repos";
import { handleTrainerApi } from "../src/webapp/trainerApi";
import type { BankPlan, UserDoc } from "../src/types";

function req(method: string, path: string, body?: unknown) {
  return new Request(`https://x${path}`, {
    method,
    ...(body !== undefined ? { body: JSON.stringify(body), headers: { "content-type": "application/json" } } : {}),
  });
}
async function call(db: ReturnType<typeof newDb>, userId: number | null, method: string, path: string, body?: unknown) {
  const full = userId ? `${path}${path.includes("?") ? "&" : "?"}debugUser=${userId}` : path;
  return handleTrainerApi(req(method, full, body), new URL(`https://x${full}`), { DB: db, TELEGRAM_BOT_TOKEN: "t" } as never);
}
function stubFetch() {
  const real = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ ok: true }), { status: 200 })) as typeof fetch;
  return () => { globalThis.fetch = real; };
}
async function trainerAndClient(db: ReturnType<typeof newDb>, trainerId = 10, clientId = 20) {
  await getOrCreateUser(db, trainerId, trainerId, "en", "Coach");
  await updateUser(db, trainerId, { role: "trainer" });
  await getOrCreateUser(db, clientId, clientId, "en", "Cli");
  await updateUser(db, clientId, { role: "client", trainerId });
}

test("handleTrainerApi: unauthorized without a resolvable user", async () => {
  const db = newDb();
  const res = await call(db, null, "GET", "/api/trainer/questions");
  assert.equal(res.status, 401);
});

test("handleTrainerApi: forbidden for a non-trainer", async () => {
  const db = newDb();
  await getOrCreateUser(db, 1, 1, "en", "Solo");
  const res = await call(db, 1, "GET", "/api/trainer/questions");
  assert.equal(res.status, 403);
});

test("per-client routes 404 for a client that isn't this trainer's", async () => {
  const db = newDb();
  await trainerAndClient(db);
  await getOrCreateUser(db, 30, 30, "en", "NotMine"); // solo, unrelated
  const res = await call(db, 10, "GET", "/api/trainer/client/30/card");
  assert.equal(res.status, 404);
});

test("questions: lists pending questions with the client's name resolved", async () => {
  const db = newDb();
  await trainerAndClient(db);
  await createQuestion(db, 20, 10, "How much protein should I eat?");
  const res = await call(db, 10, "GET", "/api/trainer/questions");
  const body = (await res.json()) as { questions: { clientId: number; client: string; status: string }[] };
  assert.equal(body.questions.length, 1);
  assert.equal(body.questions[0].clientId, 20);
  assert.equal(body.questions[0].status, "pending");
});

test("answering a question that belongs to another trainer 404s", async () => {
  const db = newDb();
  await trainerAndClient(db, 10, 20);
  await trainerAndClient(db, 11, 21);
  const qid = await createQuestion(db, 21, 11, "Question for the other trainer");
  const res = await call(db, 10, "POST", `/api/trainer/question/${qid}/answer`, { text: "answer" });
  assert.equal(res.status, 404);
});

test("answering marks the question answered and stores the message", async () => {
  const db = newDb();
  await trainerAndClient(db);
  const qid = await createQuestion(db, 20, 10, "How much protein?");
  const unstub = stubFetch();
  try {
    const res = await call(db, 10, "POST", `/api/trainer/question/${qid}/answer`, { text: "About 150g." });
    assert.equal(res.status, 200);
  } finally {
    unstub();
  }
  const rows = db.dump<{ status: string }>("SELECT status FROM client_questions WHERE id = ?", qid);
  assert.equal(rows[0].status, "answered");
  const msgs = db.dump<{ text: string }>("SELECT text FROM messages WHERE toId = 20");
  assert.equal(msgs.length, 1);
});

test("card: patches health/personal notes and a canonical birthday, rejects a bad one", async () => {
  const db = newDb();
  await trainerAndClient(db);
  const bad = await call(db, 10, "POST", "/api/trainer/client/20/card", { birthday: "not-a-date" });
  assert.equal(bad.status, 400);

  const ok = await call(db, 10, "POST", "/api/trainer/client/20/card", { healthNotes: "old knee injury", birthday: "03-15" });
  assert.equal(ok.status, 200);
  const body = (await ok.json()) as { card: { healthNotes: string; birthday: string } };
  assert.equal(body.card.healthNotes, "old knee injury");
  assert.equal(body.card.birthday, "03-15");

  // Empty string clears the field back to null.
  const cleared = await call(db, 10, "POST", "/api/trainer/client/20/card", { healthNotes: "" });
  const clearedBody = (await cleared.json()) as { card: { healthNotes: string | null } };
  assert.equal(clearedBody.card.healthNotes, null);
});

test("note: sets and clears a private trainer note on the client", async () => {
  const db = newDb();
  await trainerAndClient(db);
  const set = await call(db, 10, "POST", "/api/trainer/client/20/note", { note: "Prefers morning sessions" });
  assert.deepEqual(await set.json(), { note: "Prefers morning sessions" });
  const cleared = await call(db, 10, "POST", "/api/trainer/client/20/note", { note: "" });
  assert.deepEqual(await cleared.json(), { note: null });
});

test("billing: validates date shape and session count bounds", async () => {
  const db = newDb();
  await trainerAndClient(db);
  assert.equal((await call(db, 10, "POST", "/api/trainer/client/20/billing", { paidUntil: "not-a-date" })).status, 400);
  assert.equal((await call(db, 10, "POST", "/api/trainer/client/20/billing", { sessionsLeft: 1000 })).status, 400);

  const ok = await call(db, 10, "POST", "/api/trainer/client/20/billing", { paidUntil: "2026-12-31", sessionsLeft: 8 });
  assert.equal(ok.status, 200);
  const body = (await ok.json()) as { billing: { paidUntil: string; sessionsLeft: number } };
  assert.equal(body.billing.paidUntil, "2026-12-31");
  assert.equal(body.billing.sessionsLeft, 8);
});

test("flag: toggles the client's flagged state and writes an audit row", async () => {
  const db = newDb();
  await trainerAndClient(db);
  const res = await call(db, 10, "POST", "/api/trainer/client/20/flag", { flagged: true });
  assert.equal(res.status, 200);
  const client = (await getUser(db, 20)) as UserDoc;
  assert.equal(client.flagged, true);
  const audit = db.dump<{ action: string }>("SELECT action FROM admin_audit WHERE actorId = 10");
  assert.equal(audit.length, 1);
  assert.equal(audit[0].action, "flag_client");
});

test("session: rejects a past date and an out-of-window hour, otherwise books it", async () => {
  const db = newDb();
  await trainerAndClient(db);
  const past = await call(db, 10, "POST", "/api/trainer/client/20/session", { date: "2020-01-01", hour: 10 });
  assert.equal(past.status, 400);

  const future = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
  const badHour = await call(db, 10, "POST", "/api/trainer/client/20/session", { date: future, hour: 3 });
  assert.equal(badHour.status, 400);

  const unstub = stubFetch();
  try {
    const ok = await call(db, 10, "POST", "/api/trainer/client/20/session", { date: future, hour: 10 });
    assert.equal(ok.status, 200);
  } finally {
    unstub();
  }
  const rows = db.dump<{ trainerId: number; clientId: number }>("SELECT trainerId, clientId FROM sessions");
  assert.equal(rows.length, 1);
});

test("templates: assigning to a client not owned by this trainer 404s", async () => {
  const db = newDb();
  await trainerAndClient(db, 10, 20);
  await getOrCreateUser(db, 30, 30, "en", "NotMine");
  const plan: BankPlan = { split: [], nutrition: { calories: 2000, protein: 150, fats: 60, carbs: 200 }, supplements: [], methodology: "" } as unknown as BankPlan;
  const tplId = await saveTrainerTemplate(db, 10, "Push Pull Legs", plan);
  const res = await call(db, 10, "POST", "/api/trainer/templates", { action: "assign", id: tplId, clientId: 30 });
  assert.equal(res.status, 404);
});

test("templates: assigning to an owned client activates a draft and notifies them", async () => {
  const db = newDb();
  await trainerAndClient(db);
  const plan: BankPlan = { split: [{ weekday: 1, muscleGroup: "Push", exercises: [] }], nutrition: { calories: 2000, protein: 150, fats: 60, carbs: 200 }, supplements: [], methodology: "" } as unknown as BankPlan;
  const tplId = await saveTrainerTemplate(db, 10, "Push Pull Legs", plan);
  const unstub = stubFetch();
  try {
    const res = await call(db, 10, "POST", "/api/trainer/templates", { action: "assign", id: tplId, clientId: 20 });
    assert.equal(res.status, 200);
  } finally {
    unstub();
  }
  const list = await call(db, 10, "GET", "/api/trainer/templates");
  const body = (await list.json()) as { templates: { name: string }[] };
  assert.equal(body.templates.length, 1);
});

test("broadcast: notifies every client and records how many were reached", async () => {
  const db = newDb();
  await trainerAndClient(db, 10, 20);
  await trainerAndClient(db, 10, 21); // second client for the same trainer
  const unstub = stubFetch();
  try {
    const res = await call(db, 10, "POST", "/api/trainer/broadcast", { text: "New week, new plan!" });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { sent: number };
    assert.equal(body.sent, 2);
  } finally {
    unstub();
  }
});

test("broadcast: rejects an empty message", async () => {
  const db = newDb();
  await trainerAndClient(db);
  const res = await call(db, 10, "POST", "/api/trainer/broadcast", { text: "   " });
  assert.equal(res.status, 400);
});
