import type { Env } from "../types";
import { RateLimitError, type GenInput } from "./errors";
import { NEURONS_PER_AUDIO_MINUTE, WORKERSAI_TIER_MODELS, estimateNeurons } from "./models";

// Exported (not just local literals) so scripts/check-ai-models.mjs can smoke-test the actual
// defaults instead of hand-maintained copies that can drift out of sync — index.ts used to
// duplicate WORKERSAI_DEFAULT_MODEL verbatim.
export const WORKERSAI_DEFAULT_TRANSCRIBE_MODEL = "@cf/openai/whisper-large-v3-turbo";
// [2026-10-02] gpt-oss-120b leads (Workers AI's strongest general model; it accepts Chat
// Completions-style messages since 2026-02-17), the long-serving Llama 3.3 70B stays right behind
// it — workersaiGenerate walks the list, so a model that errors or returns unusable output (e.g.
// all of max_tokens spent on reasoning) falls to the next one instead of out of the provider.
export const WORKERSAI_DEFAULT_MODEL = WORKERSAI_TIER_MODELS.standard[0];
export const WORKERSAI_DEFAULT_FALLBACK_MODELS = WORKERSAI_TIER_MODELS.standard.slice(1);

/** Models to try in order: WORKERSAI_MODEL (or the default), then WORKERSAI_FALLBACK_MODELS (or
 *  the default fallbacks). Exported for scripts/check-ai-models.mjs and tests. */
export function workersaiModels(env: { WORKERSAI_MODEL?: string; WORKERSAI_FALLBACK_MODELS?: string }): string[] {
  const configured = (env.WORKERSAI_FALLBACK_MODELS ?? "").split(",").map((m) => m.trim()).filter(Boolean);
  return [...new Set([env.WORKERSAI_MODEL || WORKERSAI_DEFAULT_MODEL, ...(configured.length ? configured : WORKERSAI_DEFAULT_FALLBACK_MODELS)])];
}

/** The text out of a Workers AI response: classic `{response}`, Chat Completions `{choices}`, or
 *  the Responses-style `{output:[{content:[{text}]}]}` some OpenAI-family models return. */
const REASONING = /gpt-oss|qwen3/;

/** Drop an inline `<think>…</think>` block some reasoning models (qwen3) put before the answer. */
const stripThink = (t: string) => t.replace(/^\s*<think>[\s\S]*?<\/think>/, "").trim();

export function workersaiText(res: unknown): string {
  const r = res as {
    response?: unknown;
    choices?: Array<{ message?: { content?: unknown } }>;
    output?: Array<{ type?: string; content?: Array<{ type?: string; text?: unknown }> }>;
  };
  if (typeof r?.response === "string") return stripThink(r.response);
  const choice = r?.choices?.[0]?.message?.content;
  if (typeof choice === "string") return stripThink(choice);
  const out = (r?.output ?? []).filter((o) => o.type !== "reasoning").flatMap((o) => o.content ?? []);
  return out.map((c) => (typeof c.text === "string" ? c.text : "")).join("").trim();
}

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
export async function workersaiTranscribe(env: Env, audio: ArrayBuffer, lang?: string, seconds?: number): Promise<{ text: string; neurons: number }> {
  if (!env.AI) throw new Error("Workers AI binding not configured");
  const model = env.WORKERSAI_TRANSCRIBE_MODEL || WORKERSAI_DEFAULT_TRANSCRIBE_MODEL;
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
    // Opus voice is ~2 KB/s; without a known duration, estimate it from the size (at least 1 min).
    const minutes = Math.max(1, Math.ceil((seconds ?? audio.byteLength / 2_000) / 60));
    return { text, neurons: minutes * NEURONS_PER_AUDIO_MINUTE };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/capacity|rate|limit|429|503|quota/i.test(msg)) throw new RateLimitError(503, msg.slice(0, 200));
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// Cloudflare Workers AI — free (within the daily neuron allowance), on-platform, no external key.
// Walks the call's tier models (ai/models.ts), or the configured standard list. Vision models get
// the images as Chat Completions content parts.
export async function workersaiGenerate(env: Env, input: GenInput): Promise<string> {
  if (!env.AI) throw new Error("Workers AI binding not configured");
  const models = input.workersaiModels?.length ? input.workersaiModels : workersaiModels(env);
  let lastErr: unknown;
  for (const model of models) {
    try {
      return await workersaiCall(env, input, model);
    } catch (err) {
      lastErr = err;
      if (err instanceof RateLimitError) break; // the platform is saturated — every model is
    }
  }
  throw lastErr ?? new Error("no Workers AI model available");
}

async function workersaiCall(env: Env, input: GenInput, model: string): Promise<string> {
  // Loose cast: the typed `run` overloads are model-specific; we pass a dynamic model id.
  // NOTE: call on `ai` (not a detached method) so `this` is preserved.
  const ai = env.AI as unknown as { run: (m: string, o: unknown) => Promise<unknown> };

  // `ai.run` doesn't accept an AbortSignal, so race it against a timer to bound the call —
  // otherwise a hung Workers AI request could eat the whole fallback-chain budget.
  const timeoutMs = input.timeoutMs ?? 25000;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const res = await Promise.race([
      ai.run(model, {
        messages: [
          { role: "system", content: input.system },
          {
            role: "user",
            content: input.images?.length
              ? [
                  { type: "text", text: input.user },
                  ...input.images.map((img) => ({ type: "image_url", image_url: { url: `data:${img.mimeType};base64,${img.dataBase64}` } })),
                ]
              : input.user,
          },
        ],
        // Reasoning models (gpt-oss, qwen3) spend part of the budget thinking before they answer.
        max_tokens: REASONING.test(model) ? 4096 : 1024,
        temperature: input.temperature ?? 0.7,
      }),
      new Promise<never>((_, rej) => {
        timer = setTimeout(() => rej(new Error(`Workers AI timeout after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
    const text = workersaiText(res);
    // The call cost neurons whether or not its output is usable, so count it before validating.
    input.onNeurons?.(model, estimateNeurons(model, input.system + input.user, text || "x".repeat(1_000), input.images?.length ?? 0));
    if (!text) throw new Error(`Workers AI ${model} returned no text`);
    input.validate?.(text); // reject unusable output → next model / orchestrator falls through
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
