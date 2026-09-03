import type { AiKind, AiProvider, Env } from "../types";
import { aiCacheStmt, aiCallStmt, aiUsageStmt, getAiCache, recordError } from "../db/repos";
import { geminiGenerate } from "./gemini";
import { groqGenerate } from "./groq";
import { ollamaGenerate } from "./ollama";
import { openrouterGenerate } from "./openrouter";
import { workersaiGenerate, workersaiTranscribe } from "./workersai";
import { groqTranscribe } from "./groq";
import { RateLimitError, type GenInput, type InlineImage } from "./errors";

export { RateLimitError } from "./errors";
export type { InlineImage } from "./errors";

// Transcribe a voice/audio clip. Prefers Workers AI Whisper (keyless, on-platform); falls back to
// Groq Whisper when a key is set. Rethrows the last error if every backend fails.
export async function aiTranscribe(env: Env, audio: ArrayBuffer, mimeType: string, lang?: string): Promise<string> {
  let lastErr: unknown;
  if (env.AI) {
    try {
      return await workersaiTranscribe(env, audio, lang);
    } catch (err) {
      lastErr = err;
    }
  }
  if (env.GROQ_API_KEY) {
    try {
      return await groqTranscribe(env, audio, mimeType, lang);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr ?? new Error("no transcription backend available");
}

interface CallOpts {
  system: string;
  user: string;
  kind: AiKind;
  db: D1Database;
  userId?: number;
  images?: InlineImage[];
  schema?: unknown;
  temperature?: number;
  attemptsPerKey?: number; // generations to try per key before rotating (e.g. 2 for plans)
  groqModel?: string; // per-call Groq primary override (meal-plan stages pick 8b/70b/120b)
  validate?: (parsed: unknown) => void; // semantic check on the PARSED result (aiJSON only)
}

function utcDate(): string {
  return new Date().toISOString().slice(0, 10);
}

// Per-attempt telemetry (usage counters + latency/fallback/tokens) is buffered during the
// chain and flushed in ONE db.batch round-trip at the end — awaiting two INSERTs per
// provider attempt used to add 2+ blocking DB round-trips to every user-facing AI call.
async function flushTelemetry(db: D1Database, stmts: D1PreparedStatement[]): Promise<void> {
  if (!stmts.length) return;
  try {
    await db.batch(stmts);
  } catch {
    /* telemetry is best-effort */
  }
}

// Response cache: kinds whose output depends ONLY on the prompt (not the user) — repeated
// identical inputs skip the whole provider chain. Nutrition text estimates are the win:
// "apple 100g" is asked constantly and the estimate is user-independent per language.
const CACHE_TTL_MS: Partial<Record<AiKind, number>> = {
  nutrition: 30 * 86_400_000,
};

/** Stable cache key: kind + system prompt + case/whitespace-normalized user text. */
async function cacheKey(kind: AiKind, system: string, user: string): Promise<string> {
  const normalized = user.toLowerCase().replace(/\s+/g, " ").trim();
  const data = new TextEncoder().encode(`${kind}\n${system}\n${normalized}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

interface Provider {
  name: AiProvider;
  model: string;
  fn: (env: Env, input: GenInput) => Promise<string>;
}

// Fallback chain. For fast conversational kinds (groqFirst) Groq leads — live benchmarks
// put it at ~180-370 ms with reliable JSON, while the free Gemini flash tier is rate-limited
// (10 RPM) and the 3.x models 404/429/timeout. For plan/translate Gemini leads (native
// responseSchema = the most reliable structured JSON), with Groq as a strong fallback.
function providers(env: Env, hasImages: boolean, geminiModel: string, groqFirst = false): Provider[] {
  const gemini: Provider = { name: "gemini", model: geminiModel, fn: geminiGenerate };
  const groq: Provider | null = env.GROQ_API_KEY
    ? {
        name: "groq",
        model: hasImages
          ? env.GROQ_VISION_MODEL || "meta-llama/llama-4-scout-17b-16e-instruct"
          : env.GROQ_MODEL || "llama-3.3-70b-versatile",
        fn: groqGenerate,
      }
    : null;
  const list: Provider[] = [gemini];
  if (groq) {
    if (groqFirst) list.unshift(groq); // Groq leads for fast conversational kinds
    else list.push(groq);
  }
  if (env.OPENROUTER_API_KEY) {
    const model = hasImages
      ? env.OPENROUTER_VISION_MODEL || "meta-llama/llama-3.2-11b-vision-instruct:free"
      : env.OPENROUTER_MODEL || "meta-llama/llama-3.3-70b-instruct:free";
    list.push({ name: "openrouter", model, fn: openrouterGenerate });
  }
  if (env.AI && !hasImages) {
    list.push({
      name: "workersai",
      model: env.WORKERSAI_MODEL || "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
      fn: workersaiGenerate,
    });
  }
  if (env.OLLAMA_API_KEY && !hasImages) {
    list.push({ name: "ollama", model: env.OLLAMA_MODEL || "gpt-oss:120b", fn: ollamaGenerate });
  }
  return list;
}

// Dedicated translation chain. Gemini FIRST — by far the best at fluent Ukrainian, and
// translations are cached one-time per exercise so the quota cost is negligible. Weaker
// free models (Qwen/Groq) tend to bleed Russian words or transliterate, so they're only
// fallbacks for when Gemini's daily quota is exhausted.
function translateProviders(env: Env, geminiModel: string): Provider[] {
  const list: Provider[] = [{ name: "gemini", model: geminiModel, fn: geminiGenerate }];
  if (env.GROQ_API_KEY) {
    list.push({ name: "groq", model: env.GROQ_MODEL || "llama-3.3-70b-versatile", fn: groqGenerate });
  }
  if (env.OPENROUTER_API_KEY) {
    const model = env.OPENROUTER_TRANSLATE_MODEL || "qwen/qwen-2.5-72b-instruct:free";
    list.push({ name: "openrouter", model, fn: openrouterGenerate });
  }
  if (env.AI) {
    list.push({
      name: "workersai",
      model: env.WORKERSAI_MODEL || "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
      fn: workersaiGenerate,
    });
  }
  return list;
}

// `validate` (optional) runs on each provider's output BEFORE accepting it. For JSON
// calls it parses the result, so a provider that returns unparseable/garbage JSON is
// treated as a failure and the chain falls through to the next provider (instead of
// returning junk that blows up downstream). A provider counts as "ok" only if usable.
async function run(
  env: Env,
  input: GenInput,
  o: CallOpts,
  validate?: (text: string) => void,
): Promise<string> {
  // Plan + translate + meal_plan use the full Gemini model for quality (meal_plan needs
  // fluent Ukrainian food names + reliable native-schema JSON); everything else uses flash-lite.
  const geminiModel =
    o.kind === "plan" || o.kind === "translate" || o.kind === "meal_plan"
      ? env.GEMINI_MODEL
      : env.GEMINI_LIGHT_MODEL || "gemini-2.5-flash-lite";
  // Gemini enforces responseSchema natively, so it gets the ORIGINAL prompt (the textual
  // schema would only inflate input tokens). The others can't, so spell out the exact
  // JSON shape in the prompt for them.
  const schemaUser = input.schema
    ? `${input.user}\n\nReturn ONLY valid JSON matching this schema (use these exact field names):\n${JSON.stringify(input.schema)}`
    : input.user;

  // For fast conversational calls (interview, coach, swap…) cap Gemini model list to 2
  // and keep each per-fetch attempt SHORT (8 s) so a slow/degraded Gemini can't consume the
  // whole-chain budget before we fall back to Groq/OpenRouter/Workers AI. The chain budget
  // (26 s) leaves room for Gemini (≤2×8 s) PLUS at least one fallback provider. Without the
  // short per-attempt cap, Gemini's 25 s × 2-model ladder (~36 s) blew the old 18 s budget,
  // so the chain `break`d before ever trying a fallback — interviews hung then failed.
  // Plan/translate get the full 28 s budget and 25 s attempts with all fallback models.
  // Fast kinds: only ONE Gemini model. gemini.ts loops models × API keys × per-fetch
  // timeout, so 2 models × N keys × 8 s can still overrun the budget (observed ~34 s with
  // 2 models). One model keeps Gemini's slice bounded (≤ keys × 8 s) so Groq/OpenRouter/
  // Workers AI always get a turn. Plan/translate keep the full model ladder for quality.
  // thinking is OFF, so a healthy model answers in <2 s; a model taking >10 s is overloaded
  // (the free-tier 503 storm holds the connection ~9 s before erroring) — abort and move on
  // so the deep Gemini ladder / Groq fallback stays reachable within budget.
  // meal_plan joins plan/translate: Gemini leads the chain (best Ukrainian + native schema),
  // gets the full model ladder and the longer per-attempt/total budget.
  const isPlanLike = o.kind === "plan" || o.kind === "translate" || o.kind === "meal_plan";
  const totalDeadlineMs = isPlanLike ? 28_000 : 26_000;
  const maxGeminiModels = isPlanLike ? 99 : 2;
  const attemptTimeoutMs = isPlanLike ? 10_000 : 8_000;

  let lastTokens: number | undefined; // set by the provider's onUsage on a successful generation
  // Reserve ~40% of the chain budget for the fallback providers: Gemini's model×key ladder must
  // yield with time to spare so a slow/degraded Gemini can't consume the whole budget and starve
  // Groq/OpenRouter (the observed plan outage — gemini/plan ran 100-200 s and fallback never ran).
  const geminiDeadlineMs = Date.now() + Math.round(totalDeadlineMs * 0.6);
  const baseInput: GenInput = {
    ...input,
    user: schemaUser,
    model: geminiModel,
    validate,
    attemptsPerKey: o.attemptsPerKey,
    maxModels: maxGeminiModels,
    timeoutMs: attemptTimeoutMs,
    deadlineMs: geminiDeadlineMs,
    groqModel: o.groqModel,
    onUsage: (t) => {
      lastTokens = t;
    },
  };
  const geminiInput: GenInput = { ...baseInput, user: input.user };
  // Fast conversational kinds lead with Groq (sub-300 ms, reliable); plan/translate keep
  // Gemini first for native-schema structured output. (translate has its own chain.)
  const chain =
    o.kind === "translate"
      ? translateProviders(env, geminiModel)
      : providers(env, !!(input.images && input.images.length), geminiModel, !isPlanLike);
  // Cache lookup — a hit returns instantly with zero provider calls. The stored text
  // passed validation when written; re-validate anyway (cheap) so a stale-schema entry
  // falls through to a live generation instead of crashing downstream.
  const cacheTtl = !input.images?.length ? CACHE_TTL_MS[o.kind] : undefined;
  const key = cacheTtl ? await cacheKey(o.kind, input.system, input.user) : undefined;
  if (key) {
    try {
      const hit = await getAiCache(o.db, key);
      if (hit) {
        validate?.(hit);
        return hit;
      }
    } catch {
      /* cache is best-effort — fall through to the live chain */
    }
  }

  let lastErr: unknown;
  let hadRateLimit = false;
  let attempt = 0;
  const telemetry: D1PreparedStatement[] = [];
  const date = utcDate();
  const deadline = Date.now() + totalDeadlineMs;
  for (const p of chain) {
    if (Date.now() >= deadline) break; // chain spent its budget, fail fast
    const wasFallback = attempt > 0; // any provider after the first in the chain
    attempt++;
    const startMs = Date.now();
    try {
      lastTokens = undefined;
      const text = await p.fn(env, p.name === "gemini" ? geminiInput : baseInput);
      if (validate) validate(text); // throws if the output is unusable → next provider
      telemetry.push(aiUsageStmt(o.db, { userId: o.userId, provider: p.name, kind: o.kind, model: p.model, ok: true, date }));
      telemetry.push(aiCallStmt(o.db, { userId: o.userId, provider: p.name, kind: o.kind, latencyMs: Date.now() - startMs, tokens: lastTokens, wasFallback }));
      if (key && cacheTtl) telemetry.push(aiCacheStmt(o.db, key, text, cacheTtl)); // piggybacks the batch
      await flushTelemetry(o.db, telemetry);
      return text;
    } catch (err) {
      telemetry.push(aiUsageStmt(o.db, { userId: o.userId, provider: p.name, kind: o.kind, model: p.model, ok: false, date }));
      telemetry.push(aiCallStmt(o.db, { userId: o.userId, provider: p.name, kind: o.kind, latencyMs: Date.now() - startMs, wasFallback }));
      if (err instanceof RateLimitError) hadRateLimit = true;
      lastErr = err;
      // always try the next provider — even on rate-limit
    }
  }
  await flushTelemetry(o.db, telemetry);
  // All providers failed → log for the owner error report (best-effort), classified by
  // kind (interview/plan/…) and error type (json / rate_limit / ai).
  const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
  let errorType = "ai";
  if (lastErr instanceof RateLimitError) errorType = "rate_limit";
  else if (/unparseable JSON/i.test(msg)) errorType = "json";
  try {
    await recordError(o.db, { userId: o.userId, kind: o.kind, errorType, message: msg });
  } catch {
    /* error logging is best-effort */
  }
  // Surface RateLimitError only if every failure was a rate-limit.
  if (hadRateLimit && lastErr instanceof RateLimitError) throw lastErr;
  throw lastErr ?? new Error("no AI provider available");
}

function parseJson<T>(raw: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    // Strip markdown fences.
    const cleaned = raw.replace(/```(?:json)?/gi, "").trim();
    try {
      return JSON.parse(cleaned) as T;
    } catch {
      // Last resort: extract the outermost JSON object/array from surrounding prose
      // (some fallback models wrap JSON in text despite instructions).
      const first = cleaned.search(/[{[]/);
      const lastObj = cleaned.lastIndexOf("}");
      const lastArr = cleaned.lastIndexOf("]");
      const last = Math.max(lastObj, lastArr);
      if (first !== -1 && last > first) {
        return JSON.parse(cleaned.slice(first, last + 1)) as T;
      }
      throw new Error("AI returned unparseable JSON");
    }
  }
}

export async function aiText(env: Env, o: CallOpts): Promise<string> {
  return run(env, { system: o.system, user: o.user, temperature: o.temperature }, o);
}

export async function aiJSON<T>(env: Env, o: CallOpts): Promise<T> {
  return parseJson<T>(
    await run(
      env,
      { system: o.system, user: o.user, schema: o.schema, temperature: o.temperature ?? 0.4 },
      o,
      // Reject providers that can't return parseable JSON, then run the caller's optional
      // semantic check on the parsed object (e.g. "plan must have ≥5 exercises/day").
      (text) => {
        const parsed = parseJson<T>(text);
        o.validate?.(parsed);
      },
    ),
  );
}

export async function aiVisionJSON<T>(env: Env, o: CallOpts): Promise<T> {
  return parseJson<T>(
    await run(
      env,
      {
        system: o.system,
        user: o.user,
        images: o.images,
        schema: o.schema,
        temperature: o.temperature ?? 0.3,
      },
      o,
      (text) => void parseJson<T>(text),
    ),
  );
}
