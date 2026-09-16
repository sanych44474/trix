import assert from "node:assert/strict";
import test from "node:test";
import { handleV2Api } from "../src/webapp/v2Api";
import { getOrCreateUser, updateUser } from "../src/adapters/d1/v2Users";
import { newDb } from "./harness";
import type { Env } from "../src/types";

const TRAINER = 8001;
const CLIENT = 8002;
const OUTSIDER = 8003;
const STRANGER = 8004; // a second trainer, to prove rows are scoped

const testEnv = (db: unknown) => ({ DB: db, TELEGRAM_BOT_TOKEN: "test" } as unknown as Env);
let key = 0;
const nextKey = () => `sched-test-${String(++key).padStart(4, "0")}`;

async function seed() {
  const db = newDb();
  for (const [id, name] of [[TRAINER, "Coach"], [CLIENT, "Athlete"], [OUTSIDER, "Nobody"], [STRANGER, "Rival"]] as const) {
    await getOrCreateUser(db, id, id, "en", name);
  }
  await updateUser(db, TRAINER, { role: "trainer" });
  await updateUser(db, STRANGER, { role: "trainer" });
  await updateUser(db, CLIENT, { role: "client", trainerId: TRAINER });
  return db;
}

const post = (db: unknown, who: number, path: string, body: unknown) =>
  handleV2Api(
    new Request(`https://example.test${path}?debugUser=${who}`, { method: "POST", headers: { "Idempotency-Key": nextKey() }, body: JSON.stringify(body) }),
    new URL(`https://example.test${path}?debugUser=${who}`),
    testEnv(db),
  );

const get = (db: unknown, who: number, path: string) =>
  handleV2Api(new Request(`https://example.test${path}${path.includes("?") ? "&" : "?"}debugUser=${who}`), new URL(`https://example.test${path}${path.includes("?") ? "&" : "?"}debugUser=${who}`), testEnv(db));

const soon = () => new Date(Date.now() + 86_400_000).toISOString();

test("sessions: a trainer can schedule, complete and read back a session", async () => {
  const db = await seed();
  const created = await post(db, TRAINER, "/api/v2/trainer/sessions", { action: "create", clientId: CLIENT, startsAt: soon(), durationMin: 45, price: 500 });
  assert.equal(created.status, 200);
  const { data } = await created.json() as { data: { id: number } };

  const listed = await get(db, TRAINER, "/api/v2/trainer/sessions");
  const body = await listed.json() as { data: { sessions: Array<{ id: number; clientName: string; status: string; price: number | null; durationMin: number }> } };
  assert.equal(body.data.sessions.length, 1);
  assert.equal(body.data.sessions[0].clientName, "Athlete");
  assert.equal(body.data.sessions[0].status, "planned");
  assert.equal(body.data.sessions[0].durationMin, 45);

  assert.equal((await post(db, TRAINER, "/api/v2/trainer/sessions", { action: "status", id: data.id, status: "done" })).status, 200);
  const after = await (await get(db, TRAINER, "/api/v2/trainer/sessions")).json() as { data: { sessions: Array<{ status: string }> } };
  assert.equal(after.data.sessions[0].status, "done");
});

test("sessions: a trainer cannot schedule someone else's client", async () => {
  const db = await seed();
  const res = await post(db, TRAINER, "/api/v2/trainer/sessions", { action: "create", clientId: OUTSIDER, startsAt: soon(), price: 500 });
  assert.equal(res.status, 404);
});

test("sessions: another trainer cannot touch a session that isn't theirs", async () => {
  const db = await seed();
  const created = await post(db, TRAINER, "/api/v2/trainer/sessions", { action: "create", clientId: CLIENT, startsAt: soon(), price: 500 });
  const { data } = await created.json() as { data: { id: number } };
  // Guessing the row id must not be enough -- every write is scoped by trainerId in the adapter.
  assert.equal((await post(db, STRANGER, "/api/v2/trainer/sessions", { action: "status", id: data.id, status: "cancelled" })).status, 404);
  assert.equal((await post(db, STRANGER, "/api/v2/trainer/sessions", { action: "delete", id: data.id })).status, 404);
  const mine = await (await get(db, TRAINER, "/api/v2/trainer/sessions")).json() as { data: { sessions: Array<{ status: string }> } };
  assert.equal(mine.data.sessions[0].status, "planned", "the other trainer's call must not have changed anything");
});

test("sessions: a client cannot reach the trainer schedule routes", async () => {
  const db = await seed();
  assert.equal((await get(db, CLIENT, "/api/v2/trainer/sessions")).status, 403);
  assert.equal((await get(db, CLIENT, "/api/v2/trainer/finance")).status, 403);
});

test("finance: only completed sessions bill, and payments net off the balance", async () => {
  const db = await seed();
  const done = await post(db, TRAINER, "/api/v2/trainer/sessions", { action: "create", clientId: CLIENT, startsAt: soon(), price: 500 });
  const doneId = (await done.json() as { data: { id: number } }).data.id;
  await post(db, TRAINER, "/api/v2/trainer/sessions", { action: "create", clientId: CLIENT, startsAt: soon(), price: 500 }); // stays planned
  await post(db, TRAINER, "/api/v2/trainer/sessions", { action: "status", id: doneId, status: "done" });

  let fin = await (await get(db, TRAINER, "/api/v2/trainer/finance")).json() as {
    data: { ledgers: Array<{ clientName: string; billed: number; paid: number; balance: number; sessionsDone: number; sessionsPlanned: number }>; totals: { billed: number; balance: number } };
  };
  assert.equal(fin.data.ledgers.length, 1);
  assert.equal(fin.data.ledgers[0].clientName, "Athlete");
  assert.equal(fin.data.ledgers[0].sessionsDone, 1);
  assert.equal(fin.data.ledgers[0].sessionsPlanned, 1);
  assert.equal(fin.data.ledgers[0].billed, 500, "a planned session must not be billed as earned");
  assert.equal(fin.data.ledgers[0].balance, 500);

  assert.equal((await post(db, TRAINER, "/api/v2/trainer/finance", { action: "pay", clientId: CLIENT, amount: 300 })).status, 200);
  fin = await (await get(db, TRAINER, "/api/v2/trainer/finance")).json() as typeof fin;
  assert.equal(fin.data.ledgers[0].paid, 300);
  assert.equal(fin.data.ledgers[0].balance, 200);
  assert.equal(fin.data.totals.billed, 500);
});

test("finance: rejects a payment for a client who isn't yours, and a nonsense amount", async () => {
  const db = await seed();
  assert.equal((await post(db, TRAINER, "/api/v2/trainer/finance", { action: "pay", clientId: OUTSIDER, amount: 100 })).status, 404);
  assert.equal((await post(db, TRAINER, "/api/v2/trainer/finance", { action: "pay", clientId: CLIENT, amount: -5 })).status, 400);
  assert.equal((await post(db, TRAINER, "/api/v2/trainer/finance", { action: "pay", clientId: CLIENT, amount: 0 })).status, 400);
});
