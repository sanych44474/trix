import type { Env } from "../types";
import { splitKeys, withKeys, type GenInput } from "./errors";
import { openaiCompatChat } from "./http";

const URL = "https://ollama.com/v1/chat/completions";

// Exported (not just a local literal) so scripts/check-ai-models.mjs can smoke-test the actual
// default instead of a hand-maintained copy that can drift out of sync — index.ts used to
// duplicate this verbatim.
export const OLLAMA_DEFAULT_MODEL = "gpt-oss:120b";
// [2026-10-02] Smaller sibling as an in-tier fallback when 120b is busy; OLLAMA_FALLBACK_MODELS overrides.
export const OLLAMA_DEFAULT_FALLBACK_MODELS = ["gpt-oss:20b"];

export function ollamaModels(env: { OLLAMA_MODEL?: string; OLLAMA_FALLBACK_MODELS?: string }): string[] {
  const configured = (env.OLLAMA_FALLBACK_MODELS ?? "").split(",").map((m) => m.trim()).filter(Boolean);
  return [...new Set([env.OLLAMA_MODEL || OLLAMA_DEFAULT_MODEL, ...(configured.length ? configured : OLLAMA_DEFAULT_FALLBACK_MODELS)])];
}

// Ollama Cloud — OpenAI-compatible hosted models (free tier: gpt-oss). Text-only
// fallback after Groq. Honors json_object mode for clean JSON. Walks ollamaModels().
export async function ollamaGenerate(env: Env, input: GenInput): Promise<string> {
  let lastErr: unknown;
  for (const model of ollamaModels(env)) {
    try {
      return await ollamaCall(env, input, model);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr ?? new Error("no Ollama model available");
}

async function ollamaCall(env: Env, input: GenInput, model: string): Promise<string> {
  const body: Record<string, unknown> = {
    model,
    temperature: input.temperature ?? 0.7,
    stream: false,
    messages: [
      { role: "system", content: input.system },
      { role: "user", content: input.user },
    ],
    ...(input.schema ? { response_format: { type: "json_object" } } : {}),
  };

  return withKeys(
    splitKeys(env.OLLAMA_API_KEY),
    (key) => openaiCompatChat(URL, key, body, `Ollama ${model}`, input.timeoutMs, undefined, input.onUsage, input.onPartial),
    { attempts: input.attemptsPerKey, validate: input.validate },
  );
}
