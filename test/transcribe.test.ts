import { test } from "node:test";
import assert from "node:assert/strict";
import { workersaiTranscribe } from "../src/ai/workersai";
import { aiTranscribe } from "../src/ai/index";
import type { Env } from "../src/types";

const audio = new ArrayBuffer(16);

function envWith(run: (m: string, o: unknown) => Promise<{ text?: string }>, extra: Partial<Env> = {}): Env {
  return { AI: { run }, ...extra } as unknown as Env;
}

test("workersaiTranscribe: returns trimmed text and uses the default model", async () => {
  let usedModel = "";
  const env = envWith(async (m) => { usedModel = m; return { text: "  жим 80 3x8  " }; });
  const out = await workersaiTranscribe(env, audio, "uk");
  assert.equal(out, "жим 80 3x8");
  assert.equal(usedModel, "@cf/openai/whisper-large-v3-turbo");
});

test("workersaiTranscribe: throws when no binding or empty transcript", async () => {
  await assert.rejects(() => workersaiTranscribe({} as unknown as Env, audio));
  await assert.rejects(() => workersaiTranscribe(envWith(async () => ({ text: "   " })), audio));
});

test("aiTranscribe: prefers Workers AI and does not touch Groq on success", async () => {
  let groqCalled = false;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => { groqCalled = true; return new Response("nope"); }) as typeof fetch;
  try {
    const env = envWith(async () => ({ text: "hello" }), { GROQ_API_KEY: "k" });
    assert.equal(await aiTranscribe(env, audio, "audio/ogg", "en"), "hello");
    assert.equal(groqCalled, false);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("aiTranscribe: falls back to Groq when Workers AI fails", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response("groq heard", { status: 200 })) as typeof fetch;
  try {
    const env = envWith(async () => { throw new Error("capacity exceeded"); }, { GROQ_API_KEY: "k" });
    assert.equal(await aiTranscribe(env, audio, "audio/ogg", "uk"), "groq heard");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("aiTranscribe: throws when no backend is configured", async () => {
  await assert.rejects(() => aiTranscribe({} as unknown as Env, audio, "audio/ogg"));
});
