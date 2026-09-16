// schedulerOutbox.ts's delivery mechanics (roadmap item 3) — enqueueAndDeliver (the immediate,
// low-latency path scheduler.ts's `send` closure calls) and deliverDueNotifications (the retry
// sweep, called once per cron tick from runScheduleInner). No existing test exercises
// scheduler.ts's processUser at all, so this is the only coverage this delivery path has.
import { test } from "node:test";
import assert from "node:assert/strict";
import { GrammyError } from "grammy";
import { newDb } from "./harness";
import { deliverDueNotifications, enqueueAndDeliver, type OutboxSender } from "../src/schedulerOutbox";
import { dueNotifications, markRetry } from "../src/adapters/d1/v2Notifications";
import { getOrCreateUser, getUser } from "../src/adapters/d1/v2Users";
import type { Env } from "../src/types";

function grammyErr(errorCode: number, retryAfterSeconds?: number): GrammyError {
  return new GrammyError(
    "Bad Request",
    { ok: false, error_code: errorCode, description: "x", parameters: retryAfterSeconds ? { retry_after: retryAfterSeconds } : undefined },
    "sendMessage",
    {},
  );
}

function fakeSender(behavior: (chatId: number, text: string) => void): OutboxSender {
  return { api: { sendMessage: (async (chatId: number, text: string) => { behavior(chatId, text); return {} as never; }) as never } };
}

function fakeEnv(db: ReturnType<typeof newDb>): Env {
  return { DB: db } as unknown as Env;
}

test("enqueueAndDeliver: a successful send marks the row sent and returns 'sent'", async () => {
  const db = newDb();
  await getOrCreateUser(db, 1, 1, "en", "Ann");
  const sent: { chatId: number; text: string }[] = [];
  const sender = fakeSender((chatId, text) => sent.push({ chatId, text }));

  const result = await enqueueAndDeliver(fakeEnv(db), sender, { userId: 1, chatId: 1, kind: "reminder", idempotencyKey: "k1", text: "hello" });

  assert.equal(result, "sent");
  assert.deepEqual(sent, [{ chatId: 1, text: "hello" }]);
  const due = await dueNotifications(db, new Date().toISOString());
  assert.equal(due.length, 0); // sent, not pending
});

test("enqueueAndDeliver: a duplicate idempotencyKey does not attempt a second send", async () => {
  const db = newDb();
  await getOrCreateUser(db, 1, 1, "en", "Ann");
  let sendCount = 0;
  const sender = fakeSender(() => { sendCount++; });

  await enqueueAndDeliver(fakeEnv(db), sender, { userId: 1, chatId: 1, kind: "reminder", idempotencyKey: "same", text: "first" });
  const result2 = await enqueueAndDeliver(fakeEnv(db), sender, { userId: 1, chatId: 1, kind: "reminder", idempotencyKey: "same", text: "second" });

  assert.equal(result2, "duplicate");
  assert.equal(sendCount, 1);
});

test("enqueueAndDeliver: a 403 marks the row blocked AND flips user.botBlocked", async () => {
  const db = newDb();
  await getOrCreateUser(db, 1, 1, "en", "Ann");
  const sender = fakeSender(() => { throw grammyErr(403); });

  const result = await enqueueAndDeliver(fakeEnv(db), sender, { userId: 1, chatId: 1, kind: "reminder", idempotencyKey: "k1", text: "hi" });

  assert.equal(result, "blocked");
  const user = await getUser(db, 1);
  assert.equal(user?.botBlocked, true);
  const due = await dueNotifications(db, new Date().toISOString());
  assert.equal(due.length, 0); // terminal, not retried
});

test("enqueueAndDeliver: a 429 schedules a retry instead of losing the notification", async () => {
  const db = newDb();
  await getOrCreateUser(db, 1, 1, "en", "Ann");
  const sender = fakeSender(() => { throw grammyErr(429, 60); });

  const result = await enqueueAndDeliver(fakeEnv(db), sender, { userId: 1, chatId: 1, kind: "reminder", idempotencyKey: "k1", text: "hi" });

  assert.equal(result, "retrying");
  const dueNow = await dueNotifications(db, new Date().toISOString());
  assert.equal(dueNow.length, 0); // not due yet (60s backoff)
  const dueLater = await dueNotifications(db, new Date(Date.now() + 65_000).toISOString());
  assert.equal(dueLater.length, 1); // still there, not lost
});

test("deliverDueNotifications: sweeps a row a previous attempt backed off, once it's due", async () => {
  const db = newDb();
  await getOrCreateUser(db, 1, 1, "en", "Ann");
  const sender1 = fakeSender(() => { throw grammyErr(500); }); // transient
  await enqueueAndDeliver(fakeEnv(db), sender1, { userId: 1, chatId: 1, kind: "reminder", idempotencyKey: "k1", text: "hi" });
  const [row] = await dueNotifications(db, new Date(Date.now() + 3_600_000).toISOString());
  assert.ok(row); // confirms the first attempt actually backed off rather than being lost
  // Force it due right now instead of waiting out the real backoff in the test.
  await markRetry(db, row.id, row.attempts, new Date(), "forced due for the test");

  const sent: string[] = [];
  const sender2 = fakeSender((_chatId, text) => sent.push(text));
  const result = await deliverDueNotifications(fakeEnv(db), sender2);

  assert.equal(result.sent, 1);
  assert.deepEqual(sent, ["hi"]);
});

test("deliverDueNotifications: a persistently-failing send becomes permanent_failure after MAX_DELIVERY_ATTEMPTS, not retried forever", async () => {
  const db = newDb();
  await getOrCreateUser(db, 1, 1, "en", "Ann");
  const alwaysFails = fakeSender(() => { throw grammyErr(500); });
  await enqueueAndDeliver(fakeEnv(db), alwaysFails, { userId: 1, chatId: 1, kind: "reminder", idempotencyKey: "k1", text: "hi" });

  // Drive it through every remaining attempt, forcing each retry due immediately (real backoff
  // would take up to an hour by the last one — not something a unit test should wait for).
  for (let i = 0; i < 6; i++) {
    const [row] = await dueNotifications(db, new Date(Date.now() + 3_600_000).toISOString());
    if (!row) break;
    await markRetry(db, row.id, row.attempts, new Date(), "forced due for the test");
    await deliverDueNotifications(fakeEnv(db), alwaysFails);
  }

  const stillDue = await dueNotifications(db, new Date(Date.now() + 3_600_000).toISOString());
  assert.equal(stillDue.length, 0); // gave up, not stuck retrying forever
});
