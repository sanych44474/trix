import type { Env } from "../types";
import { splitKeys, withKeys, type GenInput } from "./errors";
import { openaiCompatChat } from "./http";

const URL = "https://openrouter.ai/api/v1/chat/completions";

// OpenRouter — OpenAI-compatible. Uses free (`:free`) models. Supports vision via a
// vision-capable free model when images are present.
export async function openrouterGenerate(env: Env, input: GenInput): Promise<string> {
  const hasImages = !!(input.images && input.images.length);
  const model = hasImages
    ? env.OPENROUTER_VISION_MODEL || "meta-llama/llama-3.2-11b-vision-instruct:free"
    : env.OPENROUTER_MODEL || "meta-llama/llama-3.3-70b-instruct:free";

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
