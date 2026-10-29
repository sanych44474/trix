import { test } from "node:test";
import assert from "node:assert/strict";
import { providerDeadline } from "../src/ai/index";
import { openrouterGenerate } from "../src/ai/openrouter";
import type { GenInput } from "../src/ai/errors";
import type { Env } from "../src/types";

const env = { OPENROUTER_API_KEY: "k", OPENROUTER_MODEL: "m1", OPENROUTER_FALLBACK_MODELS: "m2,m3" } as unknown as Env;

function baseInput(): GenInput {
  return { system: "s", user: "u", timeoutMs: 5_000 };
}

// Stubs fetch: the first model 404s, later models answer 200. Records every requested model.
// `onFirstCall` runs after the first request, before the chain decides whether to try model two.
async function withStubbedFetch(onFirstCall: () => void, run: () => Promise<unknown>): Promise<{ models: string[]; result: unknown }> {
  const realFetch = globalThis.fetch;
  const models: string[] = [];
  globalThis.fetch = (async (_url: unknown, init?: { body?: string }) => {
    const model = (JSON.parse(init?.body ?? "{}") as { model: string }).model;
    models.push(model);
    if (models.length === 1) {
      onFirstCall();
      return new Response("not found", { status: 404 });
    }
    return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  try {
    const result = await run();
    return { models, result };
  } finally {
    globalThis.fetch = realFetch;
  }
}

test("openrouterGenerate stops before the next model once the provider deadline has passed", async () => {
  const input: GenInput = { ...baseInput(), deadlineMs: Date.now() + 60_000 };
  const realFetch = globalThis.fetch;
  const models: string[] = [];
  globalThis.fetch = (async (_url: unknown, init?: { body?: string }) => {
    models.push((JSON.parse(init?.body ?? "{}") as { model: string }).model);
    input.deadlineMs = Date.now() - 1; // budget spent during the first call
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
  try {
    await assert.rejects(openrouterGenerate(env, input), /404|OpenRouter/);
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.deepEqual(models, ["m1"]);
});

test("openrouterGenerate throws 'budget spent' when the deadline is already past before any call", async () => {
  const realFetch = globalThis.fetch;
  const models: string[] = [];
  globalThis.fetch = (async (_url: unknown, init?: { body?: string }) => {
    models.push((JSON.parse(init?.body ?? "{}") as { model: string }).model);
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  try {
    await assert.rejects(openrouterGenerate(env, { ...baseInput(), deadlineMs: Date.now() - 1 }), {
      message: "OpenRouter: provider budget spent",
    });
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.deepEqual(models, []);
});

test("openrouterGenerate walks to the next model when there is no deadline", async () => {
  const { models, result } = await withStubbedFetch(() => {}, () => openrouterGenerate(env, baseInput()));
  assert.deepEqual(models, ["m1", "m2"]);
  assert.equal(result, "ok");
});

test("providerDeadline: gemini first gets 60% of the chain budget", () => {
  assert.equal(providerDeadline("gemini", true, 0, 28_000), 16_800);
});

test("providerDeadline: openrouter first gets 35% of the chain budget", () => {
  assert.equal(providerDeadline("openrouter", true, 0, 28_000), 9_800);
});

test("providerDeadline: openrouter not first gets no deadline", () => {
  assert.equal(providerDeadline("openrouter", false, 0, 28_000), undefined);
});

test("providerDeadline: other providers get no deadline", () => {
  assert.equal(providerDeadline("groq", true, 0, 28_000), undefined);
  assert.equal(providerDeadline("workersai", false, 0, 28_000), undefined);
});

test("providerDeadline: gemini starting at t=9800 gets 60% of what is left", () => {
  assert.equal(providerDeadline("gemini", false, 9_800, 28_000), 9_800 + Math.round(18_200 * 0.6));
});
