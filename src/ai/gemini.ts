import type { Env } from "../types";
import { RateLimitError, splitKeys, type GenInput } from "./errors";

const BASE = "https://generativelanguage.googleapis.com/v1beta/models";

// Fallback ladder, ordered by MEASURED free-tier behaviour, not by version number.
// Benchmarked live 2026-09-09 (6 structured-JSON calls each, 2 keys, 503s counted as failures):
//   gemini-2.5-flash-lite    6/6  726ms      gemini-3.1-flash-lite  6/6  1506ms
//   gemini-3.5-flash-lite    6/6  789ms      gemini-3.8-flash       3/6  1455ms (503-throttled)
//   gemini-2.5-flash         6/6  770ms      gemini-flash-latest    3/6  1239ms (503-throttled)
//   gemini-3.5-flash         5/6  7652ms (far too slow for the 8s fast-kind attempt cap)
// The newest "flash" tiers are the WORST choice here despite being newest: on the free tier they
// 503 about half the time. The lite tiers are the reliable ones, and 3.5-flash-lite is a real
// generational upgrade at the same latency. The 503-heavy newest model stays last: worth trying
// when everything above is exhausted (plan-like kinds walk the whole ladder), never first.
const DEFAULT_GEMINI_MODELS = [
  "gemini-2.5-flash-lite",
  "gemini-3.5-flash-lite",
  "gemini-2.5-flash",
  "gemini-3.1-flash-lite",
  "gemini-3.8-flash",
];

/** Default for fast conversational kinds (index.ts's GEMINI_LIGHT_MODEL fallback) — exported so
 * that default lives next to the ladder above and its benchmark, instead of as a second
 * hardcoded id in another file that can drift out of sync with it. */
export const GEMINI_DEFAULT_LIGHT_MODEL = DEFAULT_GEMINI_MODELS[0];

function geminiModels(env: Env, preferred?: string): string[] {
  const configured = (env.GEMINI_FALLBACK_MODELS ?? "")
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);
  // The tail is DEFAULT_GEMINI_MODELS itself — it used to be two hardcoded ids repeated here,
  // which quietly made the constant dead code (the list is never empty, so its only other use
  // as the `deduped.length ? … : DEFAULT` fallback never fired) and meant editing the ladder in
  // one place had no effect on what actually ran.
  const models = [preferred, env.GEMINI_MODEL, env.GEMINI_LIGHT_MODEL, ...configured, ...DEFAULT_GEMINI_MODELS];

  const deduped = [...new Set(models.filter((m): m is string => !!m && m.trim().length > 0))];
  return deduped.length ? deduped : DEFAULT_GEMINI_MODELS;
}

// Models that reject `generationConfig.thinkingConfig` with 400 INVALID_ARGUMENT. Gemma always
// has; several newer Gemini generations do too (verified live 2026-09-09 — gemini-3.5-flash-lite,
// gemini-3.6-flash and gemini-flash-lite-latest all 400 with it and answer fine without it).
// Learned at runtime rather than hardcoded as a name list, because that list would go stale the
// same way the model ids themselves keep doing. Cached per isolate so the extra round trip is
// paid once, not on every call. Worst case a 400 from an unrelated cause lands a model in here
// and it keeps "thinking" enabled — a latency cost, never a correctness one.
const NO_THINKING_CONFIG = new Set<string>();

const rejectsThinkingConfig = (model: string): boolean => model.startsWith("gemma") || NO_THINKING_CONFIG.has(model);

export async function geminiGenerate(env: Env, input: GenInput): Promise<string> {
  const parts: Record<string, unknown>[] = [{ text: input.user }];
  for (const img of input.images ?? []) {
    parts.push({ inline_data: { mime_type: img.mimeType, data: img.dataBase64 } });
  }

  let lastErr: unknown;
  let hadRateLimit = false;
  const models = geminiModels(env, input.model);
  const maxM = input.maxModels ?? models.length;
  // Absolute budget for the WHOLE Gemini ladder: a degraded Gemini (every attempt burning the
  // full per-fetch timeout) must not run models×keys for minutes and starve the Groq/OpenRouter
  // fallback. Once the deadline passes we stop starting new attempts and let the chain fall on.
  const overBudget = () => typeof input.deadlineMs === "number" && Date.now() >= input.deadlineMs;
  for (const model of models.slice(0, maxM)) {
    if (overBudget()) break;
    // Disabling "thinking" is a big latency cut for structured tasks — but only some models
    // accept the knob (see NO_THINKING_CONFIG above), so the body is built per attempt.
    const buildBody = (withThinking: boolean): Record<string, unknown> => ({
      contents: [{ role: "user", parts }],
      generationConfig: {
        temperature: input.temperature ?? 0.7,
        ...(withThinking ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
        ...(input.schema
          ? { responseMimeType: "application/json", responseSchema: input.schema }
          : {}),
      },
      systemInstruction: { parts: [{ text: input.system }] },
    });
    const triesPerKey = Math.max(1, input.attemptsPerKey ?? 1);
    for (const key of splitKeys(env.GEMINI_API_KEY)) {
      if (overBudget()) break;
      // Up to `triesPerKey` generations per key — a degenerate-but-parseable result
      // (rejected by input.validate) is retried on the same key before rotating.
      for (let i = 0; i < triesPerKey; i++) {
        try {
          const send = (withThinking: boolean) =>
            fetch(`${BASE}/${model}:generateContent`, {
              method: "POST",
              headers: { "Content-Type": "application/json", "X-goog-api-key": key },
              body: JSON.stringify(buildBody(withThinking)),
              signal: AbortSignal.timeout(input.timeoutMs ?? 25000),
            });
          const sentThinking = !rejectsThinkingConfig(model);
          let res = await send(sentThinking);
          // A model that rejects thinkingConfig answers 400 INVALID_ARGUMENT to an otherwise
          // valid request. Learn it, retry immediately without the knob, and skip it from here
          // on — otherwise a perfectly good model looks broken and the chain falls past it.
          if (res.status === 400 && sentThinking) {
            NO_THINKING_CONFIG.add(model);
            res = await send(false);
          }

          if (!res.ok) {
            const errText = await res.text();
            if (res.status === 429 || res.status === 503) {
              throw new RateLimitError(res.status, errText.slice(0, 200));
            }
            throw new Error(`Gemini ${model} ${res.status}: ${errText.slice(0, 300)}`);
          }

          const data = (await res.json()) as {
            candidates?: { content?: { parts?: { text?: string }[] } }[];
            usageMetadata?: { totalTokenCount?: number };
          };
          const text = data.candidates?.[0]?.content?.parts
            ?.map((p) => p.text ?? "")
            .join("")
            .trim();
          if (!text) throw new Error(`Gemini ${model} returned no text`);
          input.validate?.(text); // reject degenerate output → retry/rotate
          if (data.usageMetadata?.totalTokenCount) input.onUsage?.(data.usageMetadata.totalTokenCount);
          return text;
        } catch (err) {
          if (err instanceof RateLimitError) hadRateLimit = true;
          lastErr = err;
          // Try every configured Gemini model across every key before falling back to other providers.
        }
      }
    }
  }

  if (hadRateLimit && lastErr instanceof RateLimitError) throw lastErr;
  throw lastErr ?? new Error("no Gemini model available");
}

export function geminiFallbackModels(env: Env, preferred?: string): string[] {
  return geminiModels(env, preferred);
}
