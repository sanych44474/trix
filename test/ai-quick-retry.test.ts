// Improvement #2 from the production-readiness list: a transient network-level failure (a
// dropped connection, DNS hiccup — `fetch` throws a plain TypeError for these) gets one
// immediate retry on the SAME provider before the chain gives up on it and moves on, instead of
// burning a fallback slot on a blip that would likely have succeeded a moment later. A real
// (non-network) error is NOT retried — retrying the exact same request would just fail the same
// way again.
//
// Uses "coach" kind with only GROQ_API_KEY set: providers() puts groq first (groqFirst=true for
// fast conversational kinds) and gemini has no key configured, so gemini contributes zero fetch
// calls (splitKeys("") → its model×key loop never runs) — every fetch call in this test is
// groq's, with GROQ_FALLBACK_MODELS unset so groqGenerate makes exactly one HTTP attempt per
// invocation. That gives an exact, unambiguous fetch call count to assert against.
import { test } from "node:test";
import assert from "node:assert/strict";
import { newDb } from "./harness";
import { aiText } from "../src/ai/index";
import type { Env } from "../src/types";

function groqSuccessResponse() {
  return new Response(JSON.stringify({ choices: [{ message: { content: "hi" } }] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

test("run(): a transient network error is retried once and can still succeed", async () => {
  const db = newDb();
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    if (calls === 1) throw new TypeError("fetch failed");
    return groqSuccessResponse();
  }) as typeof fetch;
  try {
    const env = { GROQ_API_KEY: "k" } as unknown as Env;
    const out = await aiText(env, { system: "s", user: "u", kind: "coach", db });
    assert.equal(out, "hi");
    assert.equal(calls, 2, "expected exactly one retry (2 total fetch calls)");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("run(): a non-network error is NOT retried on the same provider", async () => {
  const db = newDb();
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    throw new Error("boom");
  }) as typeof fetch;
  try {
    const env = { GROQ_API_KEY: "k" } as unknown as Env;
    await assert.rejects(() => aiText(env, { system: "s", user: "u", kind: "coach", db }));
    assert.equal(calls, 1, "a non-transient error should fail fast, not retry");
  } finally {
    globalThis.fetch = realFetch;
  }
});
