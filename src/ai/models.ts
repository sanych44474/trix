// Which AI work goes where. Every call has a kind (types.ts AiKind); the kind decides its tier,
// and the tier decides the provider order and which Workers AI models it may use:
//
//   light     short, low-stakes text (progress notes, weekly report text, food-text estimates):
//             Workers AI's small fast models FIRST -- on-platform, no external quota, cheap in
//             neurons -- then Groq, Gemini, OpenRouter.
//   standard  conversation (coach, onboarding interview): Groq first (fastest), Workers AI's
//             large model second, then Gemini, OpenRouter, Ollama.
//   heavy     long structured output that must be fluent Ukrainian (plans, meal plans,
//             translations): Gemini first (native JSON schema), then Groq, Workers AI, OpenRouter.
//   vision    images (meal photos): Gemini, then Workers AI's vision models, then OpenRouter.
//             Video (form check) stays Gemini-only -- nothing else in the chain accepts video.
//
// Workers AI is free up to 10,000 neurons a day per account (shared by every model); budget.ts
// keeps the Worker under that. The neuron rates below are ESTIMATES per 1M tokens, set on the
// high side so the budget errs toward stopping early. (Workers AI ids can't be smoke-tested by
// scripts/check-ai-models.mjs -- they only run through the binding; a bad id fails the call and
// workersai.ts falls to the tier's next model, then the chain to the next provider.)
import type { AiKind } from "../types";

export type AiTier = "light" | "standard" | "heavy" | "vision";

export function tierFor(kind: AiKind, hasImages: boolean): AiTier {
  if (hasImages) return "vision";
  switch (kind) {
    case "progress":
    case "report":
    case "nutrition":
      return "light";
    case "plan":
    case "meal_plan":
    case "translate":
      return "heavy";
    default:
      return "standard";
  }
}

/** Workers AI models per tier, tried in order (workersai.ts walks the list). */
export const WORKERSAI_TIER_MODELS: Record<AiTier, string[]> = {
  light: ["@cf/qwen/qwen3-30b-a3b-fp8", "@cf/google/gemma-3-12b-it"],
  standard: ["@cf/openai/gpt-oss-120b", "@cf/meta/llama-3.3-70b-instruct-fp8-fast"],
  heavy: ["@cf/openai/gpt-oss-120b", "@cf/meta/llama-3.3-70b-instruct-fp8-fast"],
  vision: ["@cf/meta/llama-4-scout-17b-16e-instruct", "@cf/mistralai/mistral-small-3.1-24b-instruct"],
};

export const WORKERSAI_IMAGE_MODEL = "@cf/black-forest-labs/flux-1-schnell";
export const WORKERSAI_TRANSCRIBE_DEFAULT = "@cf/openai/whisper-large-v3-turbo";

/** Estimated neurons per 1M input / output tokens (rounded up from the published rates). */
const NEURONS_PER_M: Record<string, { in: number; out: number }> = {
  "@cf/qwen/qwen3-30b-a3b-fp8": { in: 5_000, out: 31_000 },
  "@cf/google/gemma-3-12b-it": { in: 32_000, out: 51_000 },
  "@cf/openai/gpt-oss-120b": { in: 32_000, out: 69_000 },
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast": { in: 27_000, out: 205_000 },
  "@cf/meta/llama-4-scout-17b-16e-instruct": { in: 25_000, out: 78_000 },
  "@cf/mistralai/mistral-small-3.1-24b-instruct": { in: 32_000, out: 51_000 },
};
/** Unknown models are charged like the most expensive one we know, never as free. */
const UNKNOWN_RATE = { in: 32_000, out: 205_000 };
/** Whisper: neurons per audio minute (estimate). One FLUX image (4 steps, 1024²) in neurons. */
export const NEURONS_PER_AUDIO_MINUTE = 50;
export const NEURONS_PER_IMAGE = 120;
/** A vision input image counted as this many input tokens. */
const IMAGE_TOKENS = 1_600;

/** Rough token count of text (Cyrillic tokenises denser than English, so ~3 chars/token). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3);
}

/** Estimated neurons for one generation. Reasoning models (gpt-oss, qwen3) think before
 *  answering, so their visible output is doubled to cover the hidden part. */
export function estimateNeurons(model: string, inputText: string, outputText: string, images = 0): number {
  const rate = NEURONS_PER_M[model] ?? UNKNOWN_RATE;
  const inTokens = estimateTokens(inputText) + images * IMAGE_TOKENS;
  const outTokens = estimateTokens(outputText) * (/gpt-oss|qwen3/.test(model) ? 2 : 1);
  return Math.ceil((inTokens * rate.in + outTokens * rate.out) / 1_000_000);
}
