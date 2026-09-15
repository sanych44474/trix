import { test } from "node:test";
import assert from "node:assert/strict";
import { newDb } from "./harness";
import {
  dueNotifications, enqueueNotification, getOrCreateUser, markPermanentFailure, markRetry, markSent, pruneNotificationOutbox,
} from "../src/db/repos";

test("enqueueNotification: a fresh enqueue returns an id and is due immediately", async () => {
  const db = newDb();
  await getOrCreateUser(db, 1, 1, "en", "Ann");
  const id = await enqueueNotification(db, { userId: 1, chatId: 1, kind: "reminder", idempotencyKey: "k1", payload: { text: "hi" } });
  assert.ok(typeof id === "number");
  const due = await dueNotifications(db, new Date().toISOString());
  assert.equal(due.length, 1);
  assert.equal(due[0].payload.text, "hi");
});

test("enqueueNotification: a duplicate (userId, idempotencyKey) is absorbed, returns null", async () => {
  const db = newDb();
  await getOrCreateUser(db, 1, 1, "en", "Ann");
  const id1 = await enqueueNotification(db, { userId: 1, chatId: 1, kind: "reminder", idempotencyKey: "same", payload: { text: "first" } });
  const id2 = await enqueueNotification(db, { userId: 1, chatId: 1, kind: "reminder", idempotencyKey: "same", payload: { text: "second, ignored" } });
  assert.ok(typeof id1 === "number");
  assert.equal(id2, null);
  const due = await dueNotifications(db, new Date().toISOString());
  assert.equal(due.length, 1);
  assert.equal(due[0].payload.text, "first"); // the second enqueue never landed
});

test("dueNotifications: excludes rows whose nextAttemptAt is still in the future", async () => {
  const db = newDb();
  await getOrCreateUser(db, 1, 1, "en", "Ann");
  const id = await enqueueNotification(db, { userId: 1, chatId: 1, kind: "reminder", idempotencyKey: "k1", payload: { text: "hi" } });
  await markRetry(db, id!, 1, new Date(Date.now() + 3_600_000), "network error");
  const due = await dueNotifications(db, new Date().toISOString());
  assert.equal(due.length, 0);
  const dueLater = await dueNotifications(db, new Date(Date.now() + 3_700_000).toISOString());
  assert.equal(dueLater.length, 1);
});

test("markSent: removes the row from future due queries (status != pending)", async () => {
  const db = newDb();
  await getOrCreateUser(db, 1, 1, "en", "Ann");
  const id = await enqueueNotification(db, { userId: 1, chatId: 1, kind: "reminder", idempotencyKey: "k1", payload: { text: "hi" } });
  await markSent(db, id!);
  const due = await dueNotifications(db, new Date().toISOString());
  assert.equal(due.length, 0);
});

test("markPermanentFailure: terminal, never resurfaces as due", async () => {
  const db = newDb();
  await getOrCreateUser(db, 1, 1, "en", "Ann");
  const id = await enqueueNotification(db, { userId: 1, chatId: 1, kind: "reminder", idempotencyKey: "k1", payload: { text: "hi" } });
  await markPermanentFailure(db, id!, "blocked", "403 forbidden");
  const due = await dueNotifications(db, new Date().toISOString());
  assert.equal(due.length, 0);
});

test("dueNotifications: orders oldest first", async () => {
  const db = newDb();
  await getOrCreateUser(db, 1, 1, "en", "Ann");
  await enqueueNotification(db, { userId: 1, chatId: 1, kind: "reminder", idempotencyKey: "a", payload: { text: "first" } });
  await enqueueNotification(db, { userId: 1, chatId: 1, kind: "reminder", idempotencyKey: "b", payload: { text: "second" } });
  const due = await dueNotifications(db, new Date().toISOString());
  assert.deepEqual(due.map((r) => r.payload.text), ["first", "second"]);
});

test("pruneNotificationOutbox: only deletes old non-pending rows, never a pending one", async () => {
  const db = newDb();
  await getOrCreateUser(db, 1, 1, "en", "Ann");
  const sentId = await enqueueNotification(db, { userId: 1, chatId: 1, kind: "reminder", idempotencyKey: "sent", payload: { text: "old, sent" } });
  await markSent(db, sentId!);
  await enqueueNotification(db, { userId: 1, chatId: 1, kind: "reminder", idempotencyKey: "pending", payload: { text: "still pending" } });

  await pruneNotificationOutbox(db, new Date(Date.now() + 3_600_000).toISOString()); // "before" is in the future -> everything old enough
  const remaining = await dueNotifications(db, new Date().toISOString());
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].payload.text, "still pending"); // the pending row survives regardless of age
});
