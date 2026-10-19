// "All notifications off" reaches every path a background message takes: the outbox (immediate
// and retry), bot handlers messaging someone else, and the Mini App's best-effort pings.
import { test } from "node:test";
import assert from "node:assert/strict";
import { newDb } from "./harness";
import { getOrCreateUser, updateUser } from "../src/adapters/d1/v2Users";
import { chatMuted, dueNotifications, markRetry } from "../src/adapters/d1/v2Notifications";
import { deliverDueNotifications, enqueueAndDeliver, type OutboxSender } from "../src/schedulerOutbox";
import { skipMutedRecipients } from "../src/notify";
import type { Env } from "../src/types";

async function mute(db: ReturnType<typeof newDb>, id: number) {
  const u = await getOrCreateUser(db, id, id, "en", "x");
  await updateUser(db, id, { profile: { ...u.profile, remindersOff: ["all"] } });
}

test("chatMuted reads the person behind a private chat id", async () => {
  const db = newDb();
  await getOrCreateUser(db, 7, 7, "en", "Bo");
  assert.equal(await chatMuted(db, 7), false);
  await mute(db, 7);
  assert.equal(await chatMuted(db, 7), true);
  assert.equal(await chatMuted(db, 999), false, "unknown chat is not muted");
});

test("a retry queued before muting is dropped, not sent", async () => {
  const db = newDb();
  await getOrCreateUser(db, 1, 1, "en", "Ann");
  const sent: string[] = [];
  let fail = true;
  const sender: OutboxSender = { api: { sendMessage: (async (_c: number, text: string) => {
    if (fail) throw new Error("network");
    sent.push(text);
    return {} as never;
  }) as never } };
  await enqueueAndDeliver({ DB: db } as unknown as Env, sender, { userId: 1, chatId: 1, kind: "reminder", idempotencyKey: "k", text: "hi" });
  const [row] = await dueNotifications(db, new Date(Date.now() + 3_600_000).toISOString());
  await markRetry(db, row.id, 1, new Date(0), "network");
  await mute(db, 1);
  fail = false;
  await deliverDueNotifications({ DB: db } as unknown as Env, sender);
  assert.deepEqual(sent, []);
  assert.deepEqual(await dueNotifications(db, new Date(Date.now() + 3_600_000).toISOString()), []);
});

test("bot handlers: a message to a muted person is dropped, a reply to the acting user is not", async () => {
  const db = newDb();
  await getOrCreateUser(db, 1, 1, "en", "Trainer");
  await mute(db, 2);
  const calls: number[] = [];
  const prev = (async (_m: string, payload: { chat_id: number }) => { calls.push(payload.chat_id); return { ok: true, result: {} }; }) as never;
  const tr = skipMutedRecipients(db, 1);
  await tr(prev, "sendMessage", { chat_id: 2, text: "to client" } as never);
  await tr(prev, "sendMessage", { chat_id: 1, text: "reply to me" } as never);
  await tr(prev, "answerCallbackQuery", { callback_query_id: "x" } as never);
  assert.deepEqual(calls, [1, undefined]);
});
