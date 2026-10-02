import { test } from "node:test";
import assert from "node:assert/strict";
import { GEMINI_DEFAULT_LIGHT_MODEL, geminiFallbackModels } from "../src/ai/gemini";
import { workersaiModels, workersaiText, workersaiGenerate } from "../src/ai/workersai";
import { openrouterTextModels } from "../src/ai/openrouter";
import { ollamaModels } from "../src/ai/ollama";
import type { Env } from "../src/types";

test("Gemini: 3.5-flash-lite leads the light ladder; 2.5 models stay as the tail", () => {
  assert.equal(GEMINI_DEFAULT_LIGHT_MODEL, "gemini-3.5-flash-lite");
  const ladder = geminiFallbackModels({} as never);
  assert.equal(ladder[0], "gemini-3.5-flash-lite");
  assert.ok(ladder.includes("gemini-2.5-flash-lite") && ladder.includes("gemini-2.5-flash"));
  assert.ok(!ladder.includes("gemini-3-flash-preview"));
});

test("model lists: primary then fallbacks, env overrides, no duplicates", () => {
  assert.deepEqual(workersaiModels({}), ["@cf/openai/gpt-oss-120b", "@cf/meta/llama-3.3-70b-instruct-fp8-fast"]);
  assert.deepEqual(workersaiModels({ WORKERSAI_MODEL: "@cf/x", WORKERSAI_FALLBACK_MODELS: "@cf/y, @cf/x" }), ["@cf/x", "@cf/y"]);
  assert.deepEqual(openrouterTextModels({}), ["nvidia/nemotron-3-super-120b-a12b:free", "google/gemma-4-31b-it:free"]);
  assert.deepEqual(ollamaModels({}), ["gpt-oss:120b", "gpt-oss:20b"]);
});

test("Workers AI text from classic, Chat Completions and Responses-style results", () => {
  assert.equal(workersaiText({ response: " hi " }), "hi");
  assert.equal(workersaiText({ choices: [{ message: { content: "ok" } }] }), "ok");
  assert.equal(workersaiText({ output: [{ type: "reasoning", content: [{ text: "thinking" }] }, { type: "message", content: [{ type: "output_text", text: "answer" }] }] }), "answer");
  assert.equal(workersaiText({}), "");
});

test("Workers AI walks to the next model when the first returns nothing usable", async () => {
  const calls: string[] = [];
  const env = {
    AI: { run: async (m: string) => { calls.push(m); return m.includes("gpt-oss") ? { output: [] } : { response: "{\"ok\":true}" }; } },
  } as unknown as Env;
  const text = await workersaiGenerate(env, { system: "s", user: "u" });
  assert.equal(text, "{\"ok\":true}");
  assert.deepEqual(calls, ["@cf/openai/gpt-oss-120b", "@cf/meta/llama-3.3-70b-instruct-fp8-fast"]);
});
