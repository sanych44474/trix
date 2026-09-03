import type { Env } from "../types";
import { RateLimitError, type GenInput } from "./errors";

// Chunked base64 of an ArrayBuffer (avoids call-stack blowups on large audio).
function abToB64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

// Transcribe a voice/audio clip via Cloudflare Workers AI Whisper (free, keyless, on-platform).
// `lang` is an ISO-639-1 hint. Capacity/rate errors become RateLimitError so the orchestrator
// can fall through to Groq.
export async function workersaiTranscribe(env: Env, audio: ArrayBuffer, lang?: string): Promise<string> {
  if (!env.AI) throw new Error("Workers AI binding not configured");
  const model = env.WORKERSAI_TRANSCRIBE_MODEL || "@cf/openai/whisper-large-v3-turbo";
  // Loose cast: model-specific run() overloads; call on the binding so `this` is preserved.
  const ai = env.AI as unknown as { run: (m: string, o: unknown) => Promise<{ text?: string }> };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const res = await Promise.race([
      ai.run(model, { audio: abToB64(audio), ...(lang ? { language: lang } : {}) }),
      new Promise<never>((_, rej) => {
        timer = setTimeout(() => rej(new Error("Workers AI transcribe timeout")), 25000);
      }),
    ]);
    const text = res.text?.trim();
    if (!text) throw new Error("Workers AI returned no transcript");
    return text;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/capacity|rate|limit|429|503|quota/i.test(msg)) throw new RateLimitError(503, msg.slice(0, 200));
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// Cloudflare Workers AI — free, on-platform, no external key. Text-only here
// (vision fallback is handled by OpenRouter). Uses the `AI` binding.
export async function workersaiGenerate(env: Env, input: GenInput): Promise<string> {
  if (!env.AI) throw new Error("Workers AI binding not configured");
  if (input.images && input.images.length) {
    throw new Error("Workers AI provider is text-only here");
  }
  const model = env.WORKERSAI_MODEL || "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

  // Loose cast: the typed `run` overloads are model-specific; we pass a dynamic model id.
  // NOTE: call on `ai` (not a detached method) so `this` is preserved.
  const ai = env.AI as unknown as {
    run: (m: string, o: unknown) => Promise<{ response?: string }>;
  };

  // `ai.run` doesn't accept an AbortSignal, so race it against a timer to bound the call —
  // otherwise a hung Workers AI request could eat the whole fallback-chain budget.
  const timeoutMs = input.timeoutMs ?? 25000;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const res = await Promise.race([
      ai.run(model, {
        messages: [
          { role: "system", content: input.system },
          { role: "user", content: input.user },
        ],
        max_tokens: 1024,
        temperature: input.temperature ?? 0.7,
      }),
      new Promise<never>((_, rej) => {
        timer = setTimeout(() => rej(new Error(`Workers AI timeout after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
    const text = res.response?.trim();
    if (!text) throw new Error("Workers AI returned no text");
    input.validate?.(text); // reject unusable output → orchestrator falls through
    return text;
  } catch (err) {
    // Capacity / rate errors → let the orchestrator fall through.
    const msg = err instanceof Error ? err.message : String(err);
    if (/capacity|rate|limit|429|503|quota/i.test(msg)) {
      throw new RateLimitError(503, msg.slice(0, 200));
    }
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
