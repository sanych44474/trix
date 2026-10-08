import { test } from "node:test";
import assert from "node:assert/strict";
import { chainFor } from "../src/ai/index";
import { WORKERSAI_TIER_MODELS, estimateNeurons, tierFor } from "../src/ai/models";
import { addNeurons, dailyBudget, neuronsToday, workersaiAllowed } from "../src/ai/budget";
import { workersaiGenerate, workersaiText } from "../src/ai/workersai";
import { newDb } from "./harness";
import type { Env } from "../src/types";

const allKeys = { AI: {}, GROQ_API_KEY: "g", OPENROUTER_API_KEY: "o", OLLAMA_API_KEY: "l" } as unknown as Env;
const names = (tier: Parameters<typeof chainFor>[1], workersai = true, translate = false) =>
  chainFor(allKeys, tier, "gemini-x", { workersai, translate }).map((p) => p.name);

test("tierFor: light / standard / heavy / vision", () => {
  assert.equal(tierFor("progress", false), "light");
  assert.equal(tierFor("nutrition", false), "light");
  assert.equal(tierFor("coach", false), "standard");
  assert.equal(tierFor("plan", false), "heavy");
  assert.equal(tierFor("translate", false), "heavy");
  assert.equal(tierFor("nutrition", true), "vision");
});

test("chainFor: provider order per tier", () => {
  assert.deepEqual(names("light"), ["workersai", "groq", "gemini", "openrouter"]);
  assert.deepEqual(names("standard"), ["groq", "workersai", "gemini", "openrouter", "ollama"]);
  assert.deepEqual(names("heavy"), ["gemini", "groq", "workersai", "openrouter", "ollama"]);
  assert.deepEqual(names("heavy", true, true), ["gemini", "groq", "workersai", "openrouter"]);
  assert.deepEqual(names("vision"), ["gemini", "workersai", "openrouter"]);
});

test("chainFor: Workers AI drops out when the budget is spent; missing keys drop providers", () => {
  assert.deepEqual(names("light", false), ["groq", "gemini", "openrouter"]);
  assert.deepEqual(names("vision", false), ["gemini", "openrouter"]);
  const bare = chainFor({} as Env, "standard", "gemini-x", { workersai: true }).map((p) => p.name);
  assert.deepEqual(bare, ["gemini"]);
  const vision = chainFor(allKeys, "vision", "gemini-x", { workersai: true });
  assert.equal(vision.find((p) => p.name === "workersai")?.model, WORKERSAI_TIER_MODELS.vision[0]);
});

test("estimateNeurons: grows with text and images, unknown models never free", () => {
  const short = estimateNeurons("@cf/qwen/qwen3-30b-a3b-fp8", "a".repeat(300), "b".repeat(300));
  const long = estimateNeurons("@cf/qwen/qwen3-30b-a3b-fp8", "a".repeat(3000), "b".repeat(3000));
  assert.ok(short > 0 && long > short);
  assert.ok(estimateNeurons("@cf/meta/llama-4-scout-17b-16e-instruct", "x", "y", 1) > estimateNeurons("@cf/meta/llama-4-scout-17b-16e-instruct", "x", "y"));
  assert.ok(estimateNeurons("@cf/unknown/model", "a".repeat(300), "b".repeat(300)) >= short);
});

test("budget: default 8000, capped at the free 10k, counter accumulates", async () => {
  assert.equal(dailyBudget({}), 8000);
  assert.equal(dailyBudget({ WORKERSAI_DAILY_NEURONS: "50000" }), 10000);
  assert.equal(dailyBudget({ WORKERSAI_DAILY_NEURONS: "500" }), 500);
  const db = newDb() as unknown as D1Database;
  assert.equal(await neuronsToday(db), 0);
  await addNeurons(db, 300);
  await addNeurons(db, 250.2);
  assert.equal(await neuronsToday(db), 551);
  assert.equal(await workersaiAllowed(db, { WORKERSAI_DAILY_NEURONS: "600" }, 40), true);
  assert.equal(await workersaiAllowed(db, { WORKERSAI_DAILY_NEURONS: "600" }, 60), false);
});

test("Workers AI: images go as image_url parts; neurons reported even for rejected output", async () => {
  const seen: unknown[] = [];
  const env = { AI: { run: async (_m: string, o: unknown) => { seen.push(o); return { response: "<think>hmm</think> {\"ok\":1}" }; } } } as unknown as Env;
  const spent: number[] = [];
  const text = await workersaiGenerate(env, {
    system: "s",
    user: "u",
    images: [{ mimeType: "image/jpeg", dataBase64: "AAAA" }],
    workersaiModels: [WORKERSAI_TIER_MODELS.vision[0]],
    onNeurons: (_m, n) => spent.push(n),
  });
  assert.equal(text, "{\"ok\":1}");
  const content = (seen[0] as { messages: Array<{ content: unknown }> }).messages[1].content as Array<{ type: string; image_url?: { url: string } }>;
  assert.equal(content[1].image_url?.url, "data:image/jpeg;base64,AAAA");
  await assert.rejects(workersaiGenerate(env, { system: "s", user: "u", workersaiModels: ["@cf/a"], validate: () => { throw new Error("bad"); }, onNeurons: (_m, n) => spent.push(n) }));
  assert.equal(spent.length, 2);
  assert.equal(workersaiText({ choices: [{ message: { content: "<think>a\nb</think>\nhi" } }] }), "hi");
});
