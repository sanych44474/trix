import type { Env } from "../types";
import { splitKeys, withKeys, type GenInput } from "./errors";
import { openaiCompatChat } from "./http";

const URL = "https://ollama.com/v1/chat/completions";

// Ollama Cloud — OpenAI-compatible hosted models (free tier: gpt-oss:120b). Text-only
// fallback after Groq. Honors json_object mode for clean JSON.
export async function ollamaGenerate(env: Env, input: GenInput): Promise<string> {
  const model = env.OLLAMA_MODEL || "gpt-oss:120b";

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
    (key) => openaiCompatChat(URL, key, body, "Ollama", input.timeoutMs, undefined, input.onUsage),
    { attempts: input.attemptsPerKey, validate: input.validate },
  );
}
