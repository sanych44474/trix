import type { Env } from "../types";
import { splitKeys, withKeys, type GenInput } from "./errors";
import { openaiCompatChat, throwForResponse } from "./http";

const URL = "https://api.groq.com/openai/v1/chat/completions";
const TRANSCRIBE_URL = "https://api.groq.com/openai/v1/audio/transcriptions";

// Transcribe a voice/audio clip via Groq Whisper (free, fast). Returns the recognized text.
// `lang` is an ISO-639-1 hint ("uk"/"en") to improve accuracy; Whisper still autodetects.
export async function groqTranscribe(
  env: Env,
  audio: ArrayBuffer,
  mimeType: string,
  lang?: string,
): Promise<string> {
  if (!env.GROQ_API_KEY) throw new Error("no GROQ_API_KEY for transcription");
  const model = env.GROQ_TRANSCRIBE_MODEL || "whisper-large-v3-turbo";
  return withKeys(splitKeys(env.GROQ_API_KEY), async (key) => {
    const form = new FormData();
    form.append("file", new Blob([audio], { type: mimeType || "audio/ogg" }), "audio.ogg");
    form.append("model", model);
    if (lang) form.append("language", lang);
    form.append("response_format", "text");
    const res = await fetch(TRANSCRIBE_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: form,
      signal: AbortSignal.timeout(25000),
    });
    if (!res.ok) await throwForResponse(res, "Groq transcribe");
    return (await res.text()).trim();
  });
}

// Groq Cloud — OpenAI-compatible, very fast, generous free tier. Used as a high-priority
// fallback for text/JSON. Vision goes to a vision-capable model when images are present.
// Tries multiple models in order: primary first, then any GROQ_FALLBACK_MODELS.
export async function groqGenerate(env: Env, input: GenInput): Promise<string> {
  const hasImages = !!(input.images && input.images.length);

  if (hasImages) {
    // Vision path: single model, no fallback.
    const model = env.GROQ_VISION_MODEL || "meta-llama/llama-4-scout-17b-16e-instruct";
    return groqCall(env, input, model);
  }

  // Text path: try primary model (per-call override wins), then fallback list.
  const primary = input.groqModel || env.GROQ_MODEL || "llama-3.3-70b-versatile";
  const fallbacks = (env.GROQ_FALLBACK_MODELS ?? "")
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);
  const models = [...new Set([primary, ...fallbacks])];

  let lastErr: unknown;
  for (const model of models) {
    try {
      return await groqCall(env, input, model);
    } catch (err) {
      lastErr = err;
      // rate-limit or error on this model → try next
    }
  }
  throw lastErr ?? new Error("all Groq models failed");
}

async function groqCall(env: Env, input: GenInput, model: string): Promise<string> {
  const hasImages = !!(input.images && input.images.length);
  const content: Record<string, unknown>[] = [{ type: "text", text: input.user }];
  for (const img of input.images ?? []) {
    content.push({
      type: "image_url",
      image_url: { url: `data:${img.mimeType};base64,${img.dataBase64}` },
    });
  }

  const body: Record<string, unknown> = {
    model,
    temperature: input.temperature ?? 0.7,
    messages: [
      { role: "system", content: input.system },
      { role: "user", content: hasImages ? content : input.user },
    ],
    // Groq honors OpenAI json_object mode reliably → cleaner JSON than the others.
    ...(input.schema && !hasImages ? { response_format: { type: "json_object" } } : {}),
  };

  return withKeys(
    splitKeys(env.GROQ_API_KEY),
    (key) => openaiCompatChat(URL, key, body, `Groq ${model}`, input.timeoutMs, undefined, input.onUsage),
    { attempts: input.attemptsPerKey, validate: input.validate },
  );
}
