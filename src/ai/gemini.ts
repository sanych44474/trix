import type { Env } from "../types";
import { RateLimitError, splitKeys, type GenInput } from "./errors";

const BASE = "https://generativelanguage.googleapis.com/v1beta/models";

const DEFAULT_GEMINI_MODELS = [
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-3.5-flash",
];

function geminiModels(env: Env, preferred?: string): string[] {
  const configured = (env.GEMINI_FALLBACK_MODELS ?? "")
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);
  const models = [
    preferred,
    env.GEMINI_MODEL,
    env.GEMINI_LIGHT_MODEL,
    ...configured,
    "gemini-2.5-flash",
    "gemini-2.5-flash-lite",
    "gemini-3.5-flash",
  ];

  const deduped = [...new Set(models.filter((m): m is string => !!m && m.trim().length > 0))];
  return deduped.length ? deduped : DEFAULT_GEMINI_MODELS;
}

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
    // Gemma models reject thinkingConfig; disable "thinking" only on Gemini 2.5/3.x
    // (big latency cut for structured tasks).
    const isGemma = model.startsWith("gemma");
    const body: Record<string, unknown> = {
      contents: [{ role: "user", parts }],
      generationConfig: {
        temperature: input.temperature ?? 0.7,
        ...(isGemma ? {} : { thinkingConfig: { thinkingBudget: 0 } }),
        ...(input.schema
          ? { responseMimeType: "application/json", responseSchema: input.schema }
          : {}),
      },
      systemInstruction: { parts: [{ text: input.system }] },
    };
    const triesPerKey = Math.max(1, input.attemptsPerKey ?? 1);
    for (const key of splitKeys(env.GEMINI_API_KEY)) {
      if (overBudget()) break;
      // Up to `triesPerKey` generations per key — a degenerate-but-parseable result
      // (rejected by input.validate) is retried on the same key before rotating.
      for (let i = 0; i < triesPerKey; i++) {
        try {
          const res = await fetch(`${BASE}/${model}:generateContent`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-goog-api-key": key },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(input.timeoutMs ?? 25000),
          });

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
