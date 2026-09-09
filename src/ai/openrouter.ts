import type { Env } from "../types";
import { splitKeys, withKeys, type GenInput } from "./errors";
import { openaiCompatChat } from "./http";

const URL = "https://openrouter.ai/api/v1/chat/completions";

// Exported (not just local literals) so scripts/check-ai-models.mjs can smoke-test the actual
// defaults instead of hand-maintained copies that can drift out of sync — index.ts's own
// translateProviders() used to duplicate the first two of these verbatim.
//
// [2026-09-09] The previous defaults (meta-llama/llama-3.3-70b-instruct:free,
// meta-llama/llama-3.2-11b-vision-instruct:free, qwen/qwen-2.5-72b-instruct:free) all started
// 404ing — confirmed live against https://openrouter.ai/api/v1/models and a real
// chat/completions call with the actual .dev.vars key, not guessed from memory (Meta and Qwen
// pulled every :free variant of these; OpenRouter's error for the first and third even names a
// PAID replacement slug, which is exactly the wrong direction for a free-tier-only project — see
// CLAUDE.md). Replaced with models confirmed live (200, real completion) AND actually free.
// Picked nvidia/nemotron-3-super-120b-a12b:free (120B, text) as the general/translate default —
// closest size class to the old 70B pick among the free roster at the time — and
// google/gemma-4-31b-it:free for vision (Gemma is Google's own established open-model family,
// and the OpenRouter API confirms `architecture.input_modalities` includes "image"). Re-run
// `npm run check:ai-models` periodically — this free-tier roster has now visibly churned once
// already and will again.
export const OPENROUTER_DEFAULT_MODEL = "nvidia/nemotron-3-super-120b-a12b:free";
export const OPENROUTER_DEFAULT_VISION_MODEL = "google/gemma-4-31b-it:free";
export const OPENROUTER_DEFAULT_TRANSLATE_MODEL = "nvidia/nemotron-3-super-120b-a12b:free";

// OpenRouter — OpenAI-compatible. Uses free (`:free`) models. Supports vision via a
// vision-capable free model when images are present.
export async function openrouterGenerate(env: Env, input: GenInput): Promise<string> {
  const hasImages = !!(input.images && input.images.length);
  const model = hasImages
    ? env.OPENROUTER_VISION_MODEL || OPENROUTER_DEFAULT_VISION_MODEL
    : env.OPENROUTER_MODEL || OPENROUTER_DEFAULT_MODEL;

  const content: Record<string, unknown>[] = [{ type: "text", text: input.user }];
  for (const img of input.images ?? []) {
    content.push({
      type: "image_url",
      image_url: { url: `data:${img.mimeType};base64,${img.dataBase64}` },
    });
  }

  // NOTE: do NOT set response_format json_object — some free models (gpt-oss) return
  // empty content with it. We instruct JSON in the prompt and extract it when parsing.
  const body: Record<string, unknown> = {
    model,
    temperature: input.temperature ?? 0.7,
    messages: [
      { role: "system", content: input.system },
      { role: "user", content: hasImages ? content : input.user },
    ],
  };

  return withKeys(
    splitKeys(env.OPENROUTER_API_KEY),
    (key) => openaiCompatChat(URL, key, body, "OpenRouter", input.timeoutMs, { "X-Title": "trix-bot" }, input.onUsage),
    { attempts: input.attemptsPerKey, validate: input.validate },
  );
}
