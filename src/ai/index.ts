import type { AiKind, AiProvider, Env } from "../types";
import { aiAttemptCountForUserSince, aiCacheStmt, aiCallStmt, aiUsageStmt, getAiCache, recordError } from "../adapters/d1/v2AiTelemetry";
import { GEMINI_DEFAULT_LIGHT_MODEL, geminiGenerate } from "./gemini";
import { GROQ_DEFAULT_MODEL, groqGenerate } from "./groq";
import { OLLAMA_DEFAULT_MODEL, ollamaGenerate } from "./ollama";
import { OPENROUTER_DEFAULT_MODEL, OPENROUTER_DEFAULT_TRANSLATE_MODEL, OPENROUTER_DEFAULT_VISION_MODEL, openrouterGenerate } from "./openrouter";
import { workersaiGenerate, workersaiModels, workersaiTranscribe } from "./workersai";
import { groqTranscribe } from "./groq";
import { RateLimitError, type GenInput, type InlineImage } from "./errors";
import { type AiTier, WORKERSAI_TIER_MODELS, estimateNeurons, tierFor } from "./models";
import { addNeurons, addNeuronsStmt, workersaiAllowed } from "./budget";
import { logInfo } from "../log";

export { RateLimitError } from "./errors";
export type { InlineImage } from "./errors";

// A network-level blip (dropped connection, DNS hiccup) is worth one immediate retry on the
// SAME provider before giving up on it — often cheaper/faster than escalating to the next
// provider in the chain, which may be lower quality. A real HTTP error status, a rate limit, or
// a validation/schema failure means retrying the exact same request would just fail the same
// way again, so those are excluded. `fetch` throws a plain TypeError for connection-level
// failures (see MDN / undici), which is the one signal reliable across all provider modules
// without each of them needing to classify their own errors.
function isTransientNetworkError(err: unknown): boolean {
  if (err instanceof RateLimitError) return false;
  if (err instanceof TypeError) return true;
  const msg = err instanceof Error ? err.message : String(err);
  return /network|ECONNRESET|ETIMEDOUT|fetch failed/i.test(msg);
}

/** Run `fn` once; on a transient network error (and only if there's still time left), retry it
 * exactly once with no backoff delay — the chain's overall budget is tight enough that a sleep
 * would cost more than it's worth. */
async function withQuickRetry<T>(fn: () => Promise<T>, deadline: number): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (!isTransientNetworkError(err) || Date.now() >= deadline) throw err;
    return await fn();
  }
}

// Transcribe a voice/audio clip. Workers AI Whisper (keyless, on-platform) leads while today's
// neuron budget allows; past it, Groq Whisper leads and Workers AI is the last resort. Rethrows
// the last error if every backend fails. `db` (optional) enables the budget; without it Workers
// AI simply leads, as before.
export async function aiTranscribe(env: Env, audio: ArrayBuffer, mimeType: string, lang?: string, db?: D1Database): Promise<string> {
  const viaWorkers = async () => {
    const r = await workersaiTranscribe(env, audio, lang);
    if (db) await addNeurons(db, r.neurons);
    return r.text;
  };
  const viaGroq = () => groqTranscribe(env, audio, mimeType, lang);
  const workersFirst = !db || (await workersaiAllowed(db, env));
  const order: Array<() => Promise<string>> = [];
  if (env.AI && workersFirst) order.push(viaWorkers);
  if (env.GROQ_API_KEY) order.push(viaGroq);
  if (env.AI && !workersFirst) order.push(viaWorkers);
  let lastErr: unknown;
  for (const backend of order) {
    try {
      return await backend();
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
  onPartial?: (textSoFar: string) => void; // stream the raw answer as it arrives (providers that can)
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

/**
 * The provider order for a tier (see ai/models.ts for the reasoning per tier):
 *   light     Workers AI (small models) → Groq → Gemini → OpenRouter
 *   standard  Groq → Workers AI → Gemini → OpenRouter → Ollama
 *   heavy     Gemini → Groq → Workers AI → OpenRouter → Ollama   (translate: OpenRouter's translate model)
 *   vision    Gemini → Workers AI (vision models) → OpenRouter (vision model)
 * Workers AI is left out when today's neuron budget is spent (`workersai: false`); a provider
 * without a key is left out. Groq has had no vision model since 2026-07, so images skip it.
 */
export function chainFor(env: Env, tier: AiTier, geminiModel: string, opts: { workersai: boolean; translate?: boolean }): Provider[] {
  const vision = tier === "vision";
  const gemini: Provider = { name: "gemini", model: geminiModel, fn: geminiGenerate };
  const groq: Provider | null = env.GROQ_API_KEY && !vision ? { name: "groq", model: env.GROQ_MODEL || GROQ_DEFAULT_MODEL, fn: groqGenerate } : null;
  const waiModels = tier === "standard" || tier === "heavy" ? workersaiModels(env) : WORKERSAI_TIER_MODELS[tier];
  const workersai: Provider | null = env.AI && opts.workersai ? { name: "workersai", model: waiModels[0], fn: workersaiGenerate } : null;
  const orModel = vision
    ? env.OPENROUTER_VISION_MODEL || OPENROUTER_DEFAULT_VISION_MODEL
    : opts.translate
      ? env.OPENROUTER_TRANSLATE_MODEL || OPENROUTER_DEFAULT_TRANSLATE_MODEL
      : env.OPENROUTER_MODEL || OPENROUTER_DEFAULT_MODEL;
  const openrouter: Provider | null = env.OPENROUTER_API_KEY ? { name: "openrouter", model: orModel, fn: openrouterGenerate } : null;
  const ollama: Provider | null = env.OLLAMA_API_KEY && !vision ? { name: "ollama", model: env.OLLAMA_MODEL || OLLAMA_DEFAULT_MODEL, fn: ollamaGenerate } : null;
  const order: Array<Provider | null> =
    tier === "light" ? [workersai, groq, gemini, openrouter]
    : tier === "standard" ? [groq, workersai, gemini, openrouter, ollama]
    : tier === "heavy" ? [gemini, groq, workersai, openrouter, ...(opts.translate ? [] : [ollama])]
    : [gemini, workersai, openrouter];
  return order.filter((p): p is Provider => p !== null);
}

/** The Workers AI models a tier may use, in order. */
function workersaiModelsFor(env: Env, tier: AiTier): string[] {
  return tier === "standard" || tier === "heavy" ? workersaiModels(env) : WORKERSAI_TIER_MODELS[tier];
}

// `validate` (optional) runs on each provider's output BEFORE accepting it. For JSON
// calls it parses the result, so a provider that returns unparseable/garbage JSON is
// treated as a failure and the chain falls through to the next provider (instead of
// returning junk that blows up downstream). A provider counts as "ok" only if usable.
// Per-user rate limit (improvement #1 from the production-readiness list) — nothing previously
// stopped a single user from firing repeated AI calls and burning through shared free-tier
// quota (a client-side retry loop, a spammed callback button, a compromised account). Generous
// on purpose: a real multi-turn coach conversation easily fires a handful of calls in 5 minutes;
// this is sized to catch a runaway loop or deliberate spam, not normal back-and-forth use.
const RATE_LIMIT_WINDOW_MS = 5 * 60_000;
const RATE_LIMIT_MAX_ATTEMPTS = 20;

async function run(
  env: Env,
  input: GenInput,
  o: CallOpts,
  validate?: (text: string) => void,
): Promise<string> {
  // Checked first, before any model selection or provider work — a rate-limited caller should
  // never even spend the CPU time. Fails OPEN on a DB error: the limiter itself must never
  // become a new reason a legitimate call fails.
  if (o.userId != null) {
    try {
      const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString();
      const recent = await aiAttemptCountForUserSince(o.db, o.userId, windowStart);
      if (recent >= RATE_LIMIT_MAX_ATTEMPTS) {
        throw new RateLimitError(429, `user ${o.userId} exceeded ${RATE_LIMIT_MAX_ATTEMPTS} AI attempts/${RATE_LIMIT_WINDOW_MS / 60_000}min`);
      }
    } catch (err) {
      if (err instanceof RateLimitError) throw err; // the limit itself — must propagate
      // Any other error here is the limiter's own DB read failing — proceed rather than block.
    }
  }
  // Plan + translate + meal_plan use the full Gemini model for quality (meal_plan needs
  // fluent Ukrainian food names + reliable native-schema JSON); everything else uses flash-lite.
  const geminiModel =
    o.kind === "plan" || o.kind === "translate" || o.kind === "meal_plan"
      ? env.GEMINI_MODEL
      : env.GEMINI_LIGHT_MODEL || GEMINI_DEFAULT_LIGHT_MODEL;
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
    onPartial: o.onPartial,
    onUsage: (t) => {
      lastTokens = t;
    },
  };
  const geminiInput: GenInput = { ...baseInput, user: input.user };
  // The kind's tier picks the provider order and the Workers AI models (ai/models.ts). Workers
  // AI joins only while today's neuron budget has room for this call (ai/budget.ts).
  const hasImages = !!(input.images && input.images.length);
  // Video (the form check) is Gemini-only: it's the one provider in the chain that accepts
  // inline video; the others would reject it or silently look at nothing.
  const hasVideo = !!input.images?.some((i) => i.mimeType.startsWith("video/"));
  const tier = tierFor(o.kind, hasImages);
  const waiModels = workersaiModelsFor(env, tier);
  const neuronsSpent: D1PreparedStatement[] = [];
  baseInput.workersaiModels = waiModels;
  baseInput.onNeurons = (_model, neurons) => { neuronsSpent.push(addNeuronsStmt(o.db, neurons)); };
  const reserve = estimateNeurons(waiModels[0] ?? "", input.system + schemaUser, "x".repeat(1_500), input.images?.length ?? 0);
  const workersai = !!env.AI && !hasVideo && (await workersaiAllowed(o.db, env, reserve));
  const fullChain = chainFor(env, tier, geminiModel, { workersai, translate: o.kind === "translate" });
  const chain = hasVideo ? fullChain.filter((p) => p.name === "gemini") : fullChain;
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
  // Starts true (vacuously, before any attempt) and flips to false the moment a NON-rate-limit
  // failure happens — so it only stays true if literally every attempt was rate-limited. Used to
  // decide whether to surface the friendlier "you've hit your limit" error below; a chain that
  // failed on a mix of causes (or ended on a genuine bug) should get the generic error instead.
  let allRateLimit = true;
  let attempt = 0;
  // Per-attempt trail (provider:short-reason for every provider tried, not just the last one) —
  // aiCallStmt/aiUsageStmt already record provider+ok per attempt for the usage/latency reports,
  // but recordError below only ever saw the FINAL error, discarding why every earlier provider
  // in the chain also failed. Kept short per-entry so a long chain still fits recordError's cap.
  const attemptTrail: string[] = [];
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
      const text = await withQuickRetry(() => p.fn(env, p.name === "gemini" ? geminiInput : baseInput), deadline);
      if (validate) validate(text); // throws if the output is unusable → next provider
      telemetry.push(aiUsageStmt(o.db, { userId: o.userId, provider: p.name, kind: o.kind, model: p.model, ok: true, date }));
      telemetry.push(aiCallStmt(o.db, { userId: o.userId, provider: p.name, kind: o.kind, latencyMs: Date.now() - startMs, tokens: lastTokens, wasFallback }));
      if (key && cacheTtl) telemetry.push(aiCacheStmt(o.db, key, text, cacheTtl)); // piggybacks the batch
      await flushTelemetry(o.db, [...telemetry, ...neuronsSpent]);
      // docs/slos.md's ai_call_completed -- input/output token split and cost estimate are NOT
      // populated yet: providers return bare text today (see aiCallStmt's own comment), so there
      // is no real per-call token count to split or price. `tokens` is whatever lastTokens holds
      // (often undefined) until that provider-level change happens.
      logInfo("ai_call_completed", { provider: p.name, kind: o.kind, ok: true, wasFallback, latencyMs: Date.now() - startMs, tokens: lastTokens ?? null });
      if (wasFallback) logInfo("ai_fallback", { fromProvider: chain[attempt - 2]?.name ?? null, toProvider: p.name, kind: o.kind });
      return text;
    } catch (err) {
      telemetry.push(aiUsageStmt(o.db, { userId: o.userId, provider: p.name, kind: o.kind, model: p.model, ok: false, date }));
      telemetry.push(aiCallStmt(o.db, { userId: o.userId, provider: p.name, kind: o.kind, latencyMs: Date.now() - startMs, wasFallback }));
      logInfo("ai_call_completed", { provider: p.name, kind: o.kind, ok: false, wasFallback, latencyMs: Date.now() - startMs, tokens: null });
      const shortMsg = err instanceof Error ? err.message : String(err);
      attemptTrail.push(`${p.name}:${shortMsg.slice(0, 60)}`);
      if (!(err instanceof RateLimitError)) allRateLimit = false;
      lastErr = err;
      // always try the next provider — even on rate-limit
    }
  }
  await flushTelemetry(o.db, [...telemetry, ...neuronsSpent]);
  // All providers failed → log for the owner error report (best-effort), classified by
  // kind (interview/plan/…) and error type (json / rate_limit / ai).
  const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
  let errorType = "ai";
  if (lastErr instanceof RateLimitError) errorType = "rate_limit";
  else if (/unparseable JSON/i.test(msg)) errorType = "json";
  try {
    const trail = attemptTrail.length > 1 ? ` | trail: ${attemptTrail.join(" -> ")}` : "";
    await recordError(o.db, { userId: o.userId, kind: o.kind, errorType, message: msg + trail });
  } catch {
    /* error logging is best-effort */
  }
  // Surface RateLimitError only if every failure was a rate-limit.
  if (allRateLimit && lastErr instanceof RateLimitError) throw lastErr;
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
        try {
          return JSON.parse(cleaned.slice(first, last + 1)) as T;
        } catch {
          // fall through — an unbalanced slice throws its own SyntaxError, which would
          // otherwise misclassify this failure as errorType "ai" instead of "json" below.
        }
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

/** Free-text answer about images or a short video (the form check). */
export async function aiVisionText(env: Env, o: CallOpts): Promise<string> {
  return run(env, { system: o.system, user: o.user, images: o.images, temperature: o.temperature ?? 0.3 }, o);
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
