import { test } from "node:test";
import assert from "node:assert/strict";
import { newDb } from "./harness";
import { getOrCreateUser, getUser, updateUser } from "../src/adapters/d1/v2Users";
import { handleBroadcastBatch, queueAnnouncement, queueReleaseBroadcast, type BroadcastMessage } from "../src/features/owner/broadcastQueue";
import { latestRelease } from "../src/releaseNotes";
import type { Env } from "../src/types";

async function setup(ids: number[]) {
  const db = newDb();
  for (const id of ids) {
    await getOrCreateUser(db, id, id * 10, "en", `U${id}`);
    await updateUser(db, id, { onboarded: true });
  }
  return { db, env: { DB: db, TELEGRAM_BOT_TOKEN: "test" } as unknown as Env };
}

function fakeQueue() {
  const sent: BroadcastMessage[] = [];
  return { sent, queue: { sendBatch: async (msgs: Array<{ body: BroadcastMessage }>) => { sent.push(...msgs.map((m) => m.body)); } } as unknown as Queue<BroadcastMessage> };
}

function fakeBatch(bodies: BroadcastMessage[]) {
  const log: string[] = [];
  const messages = bodies.map((body, i) => ({
    body,
    ack: () => log.push(`ack:${i}`),
    retry: (o?: { delaySeconds?: number }) => log.push(`retry:${i}:${o?.delaySeconds}`),
  }));
  return { log, batch: { messages } as unknown as MessageBatch<BroadcastMessage> };
}

/** Telegram stub: answers each sendMessage by chat id with the given status (200 by default). */
function stubTelegram(status: Record<number, { code: number; retryAfter?: number }> = {}) {
  const real = globalThis.fetch;
  const chats: number[] = [];
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    const chatId = JSON.parse(String(init?.body)).chat_id as number;
    chats.push(chatId);
    const s = status[chatId];
    if (!s) return Response.json({ ok: true, result: {} });
    return Response.json({ ok: false, error_code: s.code, description: "err", ...(s.retryAfter ? { parameters: { retry_after: s.retryAfter } } : {}) }, { status: s.code });
  }) as typeof fetch;
  return { chats, restore: () => { globalThis.fetch = real; } };
}

test("queueReleaseBroadcast queues everyone still owed the note, and only them", async () => {
  const { db, env } = await setup([1, 2, 3]);
  const version = latestRelease().version;
  await updateUser(db, 2, { reminders: { releaseSent: version } });
  await updateUser(db, 3, { botBlocked: true });
  const { sent, queue } = fakeQueue();
  const r = await queueReleaseBroadcast(env, queue, 1);
  assert.equal(r.queued, 1);
  assert.deepEqual(sent, [{ kind: "release", userId: 1, version }]);
});

test("queueAnnouncement queues every reachable onboarded user", async () => {
  const { db, env } = await setup([1, 2]);
  await updateUser(db, 2, { blocked: true });
  const { sent, queue } = fakeQueue();
  assert.equal((await queueAnnouncement(env, queue, 1, "hi")).queued, 1);
  assert.deepEqual(sent, [{ kind: "announce", userId: 1, text: "hi" }]);
});

test("consumer: release sent once and marked, already-sent skipped, 403 flags the user", async () => {
  const { db, env } = await setup([1, 2, 3]);
  const version = latestRelease().version;
  await updateUser(db, 2, { reminders: { releaseSent: version } });
  const tg = stubTelegram({ 30: { code: 403 } });
  try {
    const { log, batch } = fakeBatch([1, 2, 3].map((userId) => ({ kind: "release", userId, version })));
    await handleBroadcastBatch(batch, env);
    assert.deepEqual(log, ["ack:0", "ack:1", "ack:2"]);
    assert.deepEqual(tg.chats, [10, 30]); // user 2 already had it
    assert.equal((await getUser(db, 1))?.reminders?.releaseSent, version);
    assert.equal((await getUser(db, 3))?.botBlocked, true);
  } finally {
    tg.restore();
  }
});

test("consumer: a rate limit retries that message and holds the rest of the batch", async () => {
  const { env } = await setup([1, 2, 3]);
  const tg = stubTelegram({ 10: { code: 429, retryAfter: 7 } });
  try {
    const { log, batch } = fakeBatch([1, 2, 3].map((userId) => ({ kind: "announce", userId, text: "x" })));
    await handleBroadcastBatch(batch, env);
    assert.deepEqual(log, ["retry:0:7", "retry:1:7", "retry:2:7"]);
    assert.deepEqual(tg.chats, [10]);
  } finally {
    tg.restore();
  }
});

test("consumer: another failure retries only that message", async () => {
  const { env } = await setup([1, 2]);
  const tg = stubTelegram({ 10: { code: 500 } });
  try {
    const { log, batch } = fakeBatch([1, 2].map((userId) => ({ kind: "announce", userId, text: "x" })));
    await handleBroadcastBatch(batch, env);
    assert.deepEqual(log, ["retry:0:30", "ack:1"]);
  } finally {
    tg.restore();
  }
});
