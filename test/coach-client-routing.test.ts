import assert from "node:assert/strict";
import test from "node:test";
import { handleV2Api } from "../src/webapp/v2Api";
import { getOrCreateUser, updateUser } from "../src/adapters/d1/v2Users";
import { listQuestionsForClient } from "../src/adapters/d1/v2Trainer";
import { newDb } from "./harness";
import type { Env } from "../src/types";

const TRAINER_ID = 7001;
const CLIENT_ID = 7002;

// No WORKER_URL -> auth.ts's ?debugUser= bypass is live, so these exercise the real HTTP entry
// point (handleV2Api -> forward -> handleCoachApi) rather than calling the handler directly.
const testEnv = (db: unknown) => ({ DB: db, ALLOW_DEBUG_USER: "1", TELEGRAM_BOT_TOKEN: "test" } as unknown as Env);

async function pairedDb() {
  const db = newDb();
  await getOrCreateUser(db, TRAINER_ID, TRAINER_ID, "en", "Coach");
  await getOrCreateUser(db, CLIENT_ID, CLIENT_ID, "en", "Athlete");
  await updateUser(db, TRAINER_ID, { role: "trainer" });
  await updateUser(db, CLIENT_ID, { role: "client", trainerId: TRAINER_ID });
  return db;
}

/** aiText and the Telegram push both go out over fetch; neither may reach the network in tests,
 * and neither is allowed to decide whether the question was stored. */
async function withStubbedNetwork<T>(run: () => Promise<T>): Promise<T> {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => { throw new Error("no network in tests"); }) as typeof fetch;
  try { return await run(); } finally { globalThis.fetch = realFetch; }
}

test("coach/ask routes a client's question to their trainer instead of 403ing them", async () => {
  const db = await pairedDb();
  const request = new Request(`https://example.test/api/v2/coach/ask?debugUser=${CLIENT_ID}`, {
    method: "POST",
    headers: { "Idempotency-Key": "coach-routing-test-0001" },
    body: JSON.stringify({ question: "My knee aches on squats, should I drop the weight?" }),
  });
  const response = await withStubbedNetwork(() => handleV2Api(request, new URL(request.url), testEnv(db)));
  const body = await response.json() as { data?: { routed?: boolean } };
  assert.equal(response.status, 200, `expected the question to be routed, got ${response.status}: ${JSON.stringify(body)}`);
  assert.equal(body.data?.routed, true);

  // The write is what matters: a failed AI draft or Telegram push must not lose the question.
  const questions = await listQuestionsForClient(db, CLIENT_ID);
  assert.equal(questions.length, 1);
  assert.equal(questions[0].trainerId, TRAINER_ID);
  assert.equal(questions[0].status, "pending");
});

test("coach/thread gives the client their own questions back", async () => {
  const db = await pairedDb();
  const ask = new Request(`https://example.test/api/v2/coach/ask?debugUser=${CLIENT_ID}`, {
    method: "POST",
    headers: { "Idempotency-Key": "coach-routing-test-0002" },
    body: JSON.stringify({ question: "Can I swap Wednesday for Thursday?" }),
  });
  await withStubbedNetwork(() => handleV2Api(ask, new URL(ask.url), testEnv(db)));

  const request = new Request(`https://example.test/api/v2/coach/thread?debugUser=${CLIENT_ID}`);
  const response = await handleV2Api(request, new URL(request.url), testEnv(db));
  assert.equal(response.status, 200);
  const body = await response.json() as { data: { trainer: { name: string } | null; questions: Array<{ text: string }> } };
  assert.equal(body.data.trainer?.name, "Coach");
  assert.equal(body.data.questions.length, 1);
  assert.match(body.data.questions[0].text, /Wednesday/);
});

test("a solo user still gets a direct AI answer, not the routed flow", async () => {
  const db = newDb();
  await getOrCreateUser(db, 7003, 7003, "en", "Solo");
  const request = new Request("https://example.test/api/v2/coach/ask?debugUser=7003", {
    method: "POST",
    headers: { "Idempotency-Key": "coach-routing-test-0003" },
    body: JSON.stringify({ question: "How many rest days do I need?" }),
  });
  const response = await withStubbedNetwork(() => handleV2Api(request, new URL(request.url), testEnv(db)));
  assert.equal(response.status, 200);
  const body = await response.json() as { data: { routed?: boolean; answer?: string } };
  assert.equal(body.data.routed, undefined);
  assert.equal(typeof body.data.answer, "string"); // empty when every AI provider is unreachable
  assert.equal((await listQuestionsForClient(db, 7003)).length, 0);
});
