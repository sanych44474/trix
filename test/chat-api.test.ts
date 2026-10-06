// Trainer <-> client chat in the Mini App (src/webapp/chatApi.ts): who may read and write which
// thread, read receipts, one Telegram ping per burst with a button back into the thread.
import { test } from "node:test";
import assert from "node:assert/strict";
import { newDb } from "./harness";
import { getOrCreateUser, updateUser } from "../src/adapters/d1/v2Users";
import { handleChatApi } from "../src/webapp/chatApi";

type Sent = { chat_id: number; text: string; reply_markup?: { inline_keyboard: Array<Array<{ web_app?: { url: string } }>> } };

async function withTelegram<T>(run: (sent: Sent[]) => Promise<T>): Promise<T> {
  const sent: Sent[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string, init?: { body?: string }) => {
    if (String(url).includes("api.telegram.org") && init?.body) sent.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as unknown as typeof fetch;
  try { return await run(sent); } finally { globalThis.fetch = realFetch; }
}

async function call(db: ReturnType<typeof newDb>, id: number, method: string, path: string, body?: unknown) {
  const p = `${path}${path.includes("?") ? "&" : "?"}debugUser=${id}`;
  const req = new Request(`https://x${p}`, { method, ...(body !== undefined ? { body: JSON.stringify(body), headers: { "content-type": "application/json" } } : {}) });
  return handleChatApi(req, new URL(`https://x${p}`), { DB: db, ALLOW_DEBUG_USER: "1", TELEGRAM_BOT_TOKEN: "t", WORKER_URL: "https://trix.example", V2_APP_ENABLED: "1" } as never);
}

async function pair(db: ReturnType<typeof newDb>) {
  await getOrCreateUser(db, 10, 10, "uk", "Max");
  await updateUser(db, 10, { role: "trainer" });
  await getOrCreateUser(db, 20, 20, "en", "Ann");
  await updateUser(db, 20, { role: "client", trainerId: 10 });
  await getOrCreateUser(db, 30, 30, "en", "Stranger");
}

type Thread = { peer: { id: number; isTrainer: boolean }; messages: Array<{ fromMe: boolean; text: string; read: boolean }> };

test("chat: client and trainer share one thread; reading marks the peer's messages read", async () => {
  const db = newDb();
  await pair(db);
  await withTelegram(async () => {
    assert.equal((await call(db, 20, "POST", "/api/chat", { text: "Hi coach" })).status, 200);
    assert.equal((await call(db, 10, "POST", "/api/chat", { with: 20, text: "Hi Ann" })).status, 200);
  });
  const clientView = (await (await call(db, 20, "GET", "/api/chat")).json()) as Thread;
  assert.deepEqual(clientView.peer, { id: 10, name: "Max", isTrainer: true });
  assert.deepEqual(clientView.messages.map((m) => [m.fromMe, m.text]), [[true, "Hi coach"], [false, "Hi Ann"]]);
  assert.equal(clientView.messages[0].read, false, "the trainer has not opened the thread yet");

  const unread = (await (await call(db, 10, "GET", "/api/chat/unread")).json()) as { bySender: Record<string, number> };
  assert.deepEqual(unread.bySender, { 20: 1 });
  await call(db, 10, "GET", "/api/chat?with=20");
  const after = (await (await call(db, 10, "GET", "/api/chat/unread")).json()) as { bySender: Record<string, number> };
  assert.deepEqual(after.bySender, {});
  const again = (await (await call(db, 20, "GET", "/api/chat")).json()) as Thread;
  assert.equal(again.messages[0].read, true);
});

test("chat: nobody reaches a thread they are not part of", async () => {
  const db = newDb();
  await pair(db);
  assert.equal((await call(db, 30, "GET", "/api/chat")).status, 404, "a solo user has no trainer thread");
  assert.equal((await call(db, 30, "GET", "/api/chat?with=20")).status, 404, "not this client's trainer");
  assert.equal((await call(db, 30, "POST", "/api/chat", { with: 20, text: "hey" })).status, 404);
  assert.equal((await call(db, 20, "POST", "/api/chat", { with: 30, text: "hey" })).status, 404, "a client can only write to their trainer");
  assert.equal((await call(db, 20, "POST", "/api/chat/draft", {})).status, 403, "only the trainer gets AI drafts");
});

test("chat: one ping per burst, with a button into the thread", async () => {
  const db = newDb();
  await pair(db);
  await withTelegram(async (sent) => {
    await call(db, 20, "POST", "/api/chat", { text: "one" });
    await call(db, 20, "POST", "/api/chat", { text: "two" });
    assert.equal(sent.length, 1, "the second message is part of the same unread burst");
    assert.equal(sent[0].chat_id, 10);
    assert.match(sent[0].text, /Ann.*one/);
    assert.match(sent[0].reply_markup?.inline_keyboard[0][0].web_app?.url ?? "", /view=role&client=20/);

    await call(db, 10, "GET", "/api/chat?with=20"); // trainer reads
    await call(db, 20, "POST", "/api/chat", { text: "three" });
    assert.equal(sent.length, 2, "after the trainer read the thread, a new message pings again");

    await call(db, 10, "POST", "/api/chat", { with: 20, text: "reply" });
    assert.equal(sent[2].chat_id, 20);
    assert.match(sent[2].reply_markup?.inline_keyboard[0][0].web_app?.url ?? "", /view=coach/);
  });
});

test("chat: empty text is rejected", async () => {
  const db = newDb();
  await pair(db);
  assert.equal((await call(db, 20, "POST", "/api/chat", { text: "   " })).status, 400);
});
