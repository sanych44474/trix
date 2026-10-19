import { test } from "node:test";
import assert from "node:assert/strict";
import { checkModels, configuredModels, missingModels, modelAlertText } from "../src/aiModelWatch";
import type { Env } from "../src/types";

test("missingModels ignores the models/ prefix and case", () => {
  assert.deepEqual(missingModels(["gemini-3.5-flash", "gemini-old"], ["models/gemini-3.5-flash", "models/gemma-4"]), ["gemini-old"]);
});

test("configuredModels covers only providers with a key, fallbacks and vision included", () => {
  const env = { GEMINI_API_KEY: "", GROQ_API_KEY: "k", GROQ_MODEL: "a", GROQ_FALLBACK_MODELS: "b, c", OPENROUTER_API_KEY: "k", OPENROUTER_MODEL: "x:free", OPENROUTER_FALLBACK_MODELS: "y:free", OPENROUTER_VISION_MODEL: "v:free", OPENROUTER_TRANSLATE_MODEL: "x:free" } as unknown as Env;
  const c = configuredModels(env);
  assert.equal(c.gemini, undefined);
  assert.equal(c.ollama, undefined);
  assert.deepEqual(c.groq, ["a", "b", "c"]);
  assert.deepEqual(c.openrouter, ["x:free", "y:free", "v:free"]);
});

test("checkModels reads catalogs only, flags missing ids, skips an unreachable catalog", async () => {
  const env = { GROQ_API_KEY: "k", GROQ_MODEL: "a", GROQ_FALLBACK_MODELS: "gone", OPENROUTER_API_KEY: "k", OPENROUTER_MODEL: "x:free", OPENROUTER_FALLBACK_MODELS: "x:free", OPENROUTER_VISION_MODEL: "x:free", OPENROUTER_TRANSLATE_MODEL: "x:free" } as unknown as Env;
  const orig = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = (async (url: string) => {
    urls.push(String(url));
    if (String(url).includes("openrouter")) return new Response("down", { status: 503 });
    return Response.json({ data: [{ id: "a" }, { id: "other" }] });
  }) as typeof fetch;
  try {
    const r = await checkModels(env);
    assert.deepEqual(r, { missing: { groq: ["gone"] }, unreachable: ["openrouter"], reasons: { openrouter: "HTTP 503" } });
    assert.ok(urls.every((u) => u.endsWith("/models")), "only model lists, no generation calls");
    const text = modelAlertText(r)!;
    assert.match(text, /groq.*gone/);
    assert.match(text, /unreachable: openrouter \(HTTP 503\)/);
    assert.equal(modelAlertText({ missing: {}, unreachable: [] }), null, "all clear stays silent");
    assert.match(modelAlertText({ missing: {}, unreachable: ["groq"] })!, /check incomplete.*unreachable: groq/s);
  } finally { globalThis.fetch = orig; }
});

test("a key var with several comma-separated keys is tried key by key, never sent whole", async () => {
  const env = { GEMINI_API_KEY: "dead, good", GEMINI_MODEL: "gemini-a", GROQ_API_KEY: "g1,g2", GROQ_MODEL: "a" } as unknown as Env;
  const orig = globalThis.fetch;
  const sent: string[] = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const h = (init?.headers ?? {}) as Record<string, string>;
    const key = h["X-goog-api-key"] ?? h.Authorization?.replace("Bearer ", "") ?? "";
    sent.push(key);
    if (key.includes(",") || key === "dead") return new Response("bad key", { status: 400 });
    if (String(url).includes("googleapis")) return Response.json({ models: [{ name: "models/gemini-a" }] });
    return Response.json({ data: [{ id: "a" }] });
  }) as typeof fetch;
  try {
    const r = await checkModels(env);
    assert.deepEqual(r.unreachable, []);
    assert.ok(!sent.some((k) => k.includes(",")), "the raw list is never used as a key");
    assert.deepEqual(sent, ["dead", "good", "g1"]);
  } finally { globalThis.fetch = orig; }
});
