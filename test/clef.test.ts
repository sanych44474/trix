import { test } from "node:test";
import assert from "node:assert/strict";
import { clefAsk, choiceOf, noulProb, type ClefQuestion } from "../src/ai/clef";
import { addNeurons, neuronsToday } from "../src/ai/budget";
import { CLEF_MODEL, estimateNeurons, neuronsForTokens } from "../src/ai/models";
import { newDb } from "./harness";
import type { Env } from "../src/types";

const questions: Record<string, ClefQuestion> = {
  urgent: { type: "noul", instructions: "Is the message urgent?" },
  intent: { type: "choice", instructions: "What is the user asking?", criteria: { food: "a meal", pain: "an injury" } },
  effort: { type: "score", instructions: "How hard was the session?", criteria: ["easy", "hard"] },
};

const wellFormed = {
  model: "clef-flash",
  answers: {
    urgent: { type: "noul", noul: 0.91 },
    intent: { type: "choice", choice: "pain", probabilities: { food: 0.1, pain: 0.9 }, confidence: 0.8 },
    effort: { type: "score", score: 1.4, legend: { "0": "easy", "1": "hard" }, probabilities: { "0": 0.6, "1": 0.4 }, confidence: 0.7 },
  },
  usage: { input_tokens: 120, output_tokens: 3 },
};

function envWith(run: (model: string, input: unknown) => Promise<unknown>, db: D1Database = newDb() as unknown as D1Database): Env {
  return { AI: { run }, DB: db } as unknown as Env;
}

test("Clef is priced at 3,500 neurons per M input tokens and its output is not doubled", () => {
  const text = "x".repeat(3_000_000); // 1M tokens
  assert.equal(estimateNeurons(CLEF_MODEL, text, text), 3_500);
  assert.equal(neuronsForTokens(CLEF_MODEL, 1_000_000, 1_000_000), 3_500);
});

test("clefAsk parses a well-formed answer and the accessors read it", async () => {
  const env = envWith(async () => wellFormed);
  const answers = await clefAsk(env, "I pulled my knee", questions);
  assert.ok(answers);
  assert.equal(noulProb(answers, "urgent"), 0.91);
  assert.deepEqual(choiceOf(answers, "intent"), { choice: "pain", confidence: 0.8 });
  assert.equal(noulProb(answers, "intent"), null);
  assert.equal(choiceOf(answers, "missing"), null);
  assert.equal(noulProb(null, "urgent"), null);
});

test("clefAsk calls the Clef model with model clef-flash, state and questions", async () => {
  const calls: Array<{ model: string; input: Record<string, unknown> }> = [];
  const env = envWith(async (model, input) => {
    calls.push({ model, input: input as Record<string, unknown> });
    return wellFormed;
  });
  await clefAsk(env, { text: "hi" }, questions);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].model, "@cf/cloudflare/clef-flash");
  assert.equal(calls[0].input.model, "clef-flash");
  assert.deepEqual(calls[0].input.state, { text: "hi" });
  assert.deepEqual(calls[0].input.questions, questions);
  assert.equal("images" in calls[0].input, false);
});

test("clefAsk passes up to 4 images through as base64 objects", async () => {
  let sent: Record<string, unknown> = {};
  const env = envWith(async (_m, input) => {
    sent = input as Record<string, unknown>;
    return wellFormed;
  });
  const images = [{ content_type: "image/jpeg" as const, base64: "AAAA" }];
  await clefAsk(env, "meal", questions, { images });
  assert.deepEqual(sent.images, images);
});

test("clefAsk refuses more than 4 images without calling run", async () => {
  let called = false;
  const env = envWith(async () => {
    called = true;
    return wellFormed;
  });
  const img = { content_type: "image/png" as const, base64: "AAAA" };
  assert.equal(await clefAsk(env, "meal", questions, { images: [img, img, img, img, img] }), null);
  assert.equal(called, false);
});

test("clefAsk returns null when there is no AI binding", async () => {
  const env = { DB: newDb() as unknown as D1Database } as unknown as Env;
  assert.equal(await clefAsk(env, "x", questions), null);
});

test("clefAsk returns null when run throws", async () => {
  const env = envWith(async () => {
    throw new Error("boom");
  });
  assert.equal(await clefAsk(env, "x", questions), null);
});

test("clefAsk returns null on timeout", async () => {
  const env = envWith(() => new Promise(() => {}));
  assert.equal(await clefAsk(env, "x", questions, { timeoutMs: 20 }), null);
});

test("clefAsk returns null for malformed responses", async () => {
  const cases: unknown[] = [
    null,
    "not json",
    { model: "clef-flash" }, // no answers
    { answers: { urgent: { type: "noul", noul: 1.5 }, intent: wellFormed.answers.intent, effort: wellFormed.answers.effort } }, // out of range
    { answers: { ...wellFormed.answers, urgent: { type: "choice", choice: "x", probabilities: {}, confidence: 1 } } }, // wrong type for id
    { answers: { urgent: wellFormed.answers.urgent, effort: wellFormed.answers.effort } }, // intent missing
    { answers: { ...wellFormed.answers, intent: { type: "choice", choice: 7, probabilities: { food: 1 }, confidence: 0.5 } } }, // choice not a string
    { answers: { ...wellFormed.answers, effort: { type: "score", score: "1", legend: {}, probabilities: {}, confidence: 0.5 } } }, // score not a number
  ];
  for (const bad of cases) {
    const env = envWith(async () => bad);
    assert.equal(await clefAsk(env, "x", questions), null, JSON.stringify(bad));
  }
});

test("clefAsk returns null without calling run when the daily neuron budget is spent", async () => {
  const db = newDb() as unknown as D1Database;
  await addNeurons(db, 10_000);
  let called = false;
  const env = envWith(async () => {
    called = true;
    return wellFormed;
  }, db);
  assert.equal(await clefAsk(env, "x", questions), null);
  assert.equal(called, false);
});

test("clefAsk records its spend in the daily counter after a successful call", async () => {
  const db = newDb() as unknown as D1Database;
  const env = envWith(async () => wellFormed, db);
  assert.equal(await neuronsToday(db), 0);
  assert.ok(await clefAsk(env, "x", questions));
  assert.ok((await neuronsToday(db)) > 0);
});
