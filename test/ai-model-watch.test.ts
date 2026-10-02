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
    assert.deepEqual(r, { missing: { groq: ["gone"] }, unreachable: ["openrouter"] });
    assert.ok(urls.every((u) => u.endsWith("/models")), "only model lists, no generation calls");
    const text = modelAlertText(r)!;
    assert.match(text, /groq.*gone/);
    assert.match(text, /unreachable: openrouter/);
    assert.equal(modelAlertText({ missing: {}, unreachable: ["groq"] }), null);
  } finally { globalThis.fetch = orig; }
});
