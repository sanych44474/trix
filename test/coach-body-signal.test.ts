import assert from "node:assert/strict";
import test from "node:test";
import { handleV2Api } from "../src/webapp/v2Api";
import { getOrCreateUser } from "../src/adapters/d1/v2Users";
import { newDb } from "./harness";
import type { Env } from "../src/types";

const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;
const CLEF = "@cf/cloudflare/clef-flash";
const USER = 7101;

type Run = (model: string, input: unknown) => Promise<unknown>;

const coachReply = { reply: "Try a lighter set and keep the form tight.", actions: [] };
const textModel = async () => ({ response: JSON.stringify(coachReply) });

function clefAnswer(pain: number, choice: string, confidence: number) {
  return {
    model: "clef-flash",
    answers: {
      pain: { type: "noul", noul: pain },
      severity: { type: "choice", choice, probabilities: { [choice]: confidence }, confidence },
    },
    usage: { input_tokens: 80, output_tokens: 4 },
  };
}

async function ask(run: Run, question: string, key: string): Promise<Record<string, unknown>> {
  const db = newDb();
  await getOrCreateUser(db, USER, USER, "en", "Solo");
  const env = { DB: db, ALLOW_DEBUG_USER: "1", TELEGRAM_BOT_TOKEN: "test", AI: { run } } as unknown as Env;
  const request = new Request(`https://example.test/api/v2/coach/ask?debugUser=${USER}`, {
    method: "POST",
    headers: { "Idempotency-Key": key },
    body: JSON.stringify({ question }),
  });
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => { throw new Error("no network in tests"); }) as typeof fetch;
  try {
    const response = await handleV2Api(request, new URL(request.url), env, ctx);
    assert.equal(response.status, 200);
    return (await response.json() as { data: Record<string, unknown> }).data;
  } finally {
    globalThis.fetch = realFetch;
  }
}

/** Text models answer as usual; Clef answers with `clef`, or fails when `clef` is null. */
const withClef = (clef: unknown): Run => async (model) => {
  if (model !== CLEF) return textModel();
  if (clef === null) throw new Error("clef down");
  return clef;
};

const PAIN_Q = "my knee hurts when I squat, what now?";

test("a pain message with an injury reading adds bodySignal and leaves the reply unchanged", async () => {
  const without = await ask(withClef(null), PAIN_Q, "body-signal-0001");
  const withSignal = await ask(withClef(clefAnswer(0.9, "injury", 0.8)), PAIN_Q, "body-signal-0002");
  assert.deepEqual(withSignal.bodySignal, { kind: "injury" });
  assert.equal(withSignal.answer, without.answer);
  assert.deepEqual(withSignal.actions, without.actions);
  assert.ok(typeof withSignal.answer === "string" && withSignal.answer.length > 0);
});

test("an urgent reading adds bodySignal urgent", async () => {
  const data = await ask(withClef(clefAnswer(0.9, "urgent", 0.7)), "sharp chest pain when I run", "body-signal-0003");
  assert.deepEqual(data.bodySignal, { kind: "urgent" });
});

test("when Clef fails the reply is returned and bodySignal is absent", async () => {
  const data = await ask(withClef(null), PAIN_Q, "body-signal-0004");
  assert.equal("bodySignal" in data, false);
  assert.ok(typeof data.answer === "string" && data.answer.length > 0);
});

test("a mild soreness reading adds no bodySignal", async () => {
  const data = await ask(withClef(clefAnswer(0.9, "mild", 0.95)), "my legs are sore after leg day", "body-signal-0005");
  assert.equal("bodySignal" in data, false);
});

test("a question with low pain probability adds no bodySignal", async () => {
  const data = await ask(withClef(clefAnswer(0.1, "injury", 0.9)), "how many sets for biceps?", "body-signal-0006");
  assert.equal("bodySignal" in data, false);
});
