// A trainer's answer closes the client's question only once the answer is stored. The handler used
// to swallow a failed client lookup and a failed message insert, then mark the question
// "answered" and record the idempotent success: the client got nothing (or a Telegram ping with
// an empty thread), the question left the trainer's inbox, and a retry replayed "ok".
import { test } from "node:test";
import assert from "node:assert/strict";
import { newDb } from "./harness";
import { getOrCreateUser, updateUser } from "../src/adapters/d1/v2Users";
import { createQuestion, getQuestion } from "../src/adapters/d1/v2TrainerMessages";
import { handleV2Api } from "../src/webapp/v2Api";
import type { Env } from "../src/types";

const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;

async function seed() {
  const db = newDb();
  await getOrCreateUser(db, 71, 71, "en", "Coach");
  await getOrCreateUser(db, 72, 72, "en", "Client");
  await updateUser(db, 71, { role: "trainer" });
  await updateUser(db, 72, { role: "client", trainerId: 71 });
  const qid = await createQuestion(db, 72, 71, "Add weight?", undefined);
  return { db, qid };
}

function answer(db: ReturnType<typeof newDb>, qid: number, key: string) {
  const env = { DB: db, ALLOW_DEBUG_USER: "1", TELEGRAM_BOT_TOKEN: "t" } as unknown as Env;
  const req = new Request(`https://x.test/api/v2/trainer/question/${qid}/answer?debugUser=71`, {
    method: "POST",
    headers: { "content-type": "application/json", "Idempotency-Key": key },
    body: JSON.stringify({ text: "Yes, +2.5 kg." }),
  });
  return handleV2Api(req, new URL(req.url), env, ctx);
}

async function withNoNetwork<T>(run: () => Promise<T>): Promise<T> {
  const real = globalThis.fetch;
  globalThis.fetch = (async () => { throw new Error("no network in tests"); }) as typeof fetch;
  try { return await run(); } finally { globalThis.fetch = real; }
}

test("trainer answer: a failed message write leaves the question open and is not replayed as success", async () => {
  const { db, qid } = await seed();
  await db.prepare("ALTER TABLE v2_messages RENAME TO v2_messages_gone").run(); // the write will fail
  const res = await withNoNetwork(() => answer(db, qid, "answer-fail-000001"));
  assert.ok(res.status >= 500, `expected a server error, got ${res.status}`);
  assert.equal((await getQuestion(db, qid))?.status, "pending", "still in the trainer's inbox");

  await db.prepare("ALTER TABLE v2_messages_gone RENAME TO v2_messages").run(); // D1 is back
  const retry = await withNoNetwork(() => answer(db, qid, "answer-fail-000001"));
  assert.equal(retry.status, 200, "the same key runs again instead of replaying a cached success");
  assert.equal((await getQuestion(db, qid))?.status, "answered");
  const stored = await db.prepare("SELECT COUNT(*) AS n FROM v2_messages WHERE fromAccountId = 71 AND toAccountId = 72").first<{ n: number }>();
  assert.equal(stored?.n, 1);
});
