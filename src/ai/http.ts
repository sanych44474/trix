import { RateLimitError } from "./errors";

// Statuses that mean "rotate key / fall through" rather than a hard failure:
// 401 bad key, 402 no credits, 403 forbidden, 413 payload too large, 429 rate limit, 503 down.
const FALLTHROUGH_STATUS = new Set([401, 402, 403, 413, 429, 503]);

/** Throw a labeled error for a non-OK response, classifying fall-through statuses as
 * RateLimitError so the orchestrator rotates the key / tries the next provider. */
export async function throwForResponse(res: Response, label: string): Promise<never> {
  const errText = await res.text();
  if (FALLTHROUGH_STATUS.has(res.status)) {
    throw new RateLimitError(res.status, errText.slice(0, 200));
  }
  throw new Error(`${label} ${res.status}: ${errText.slice(0, 300)}`);
}

/** POST an OpenAI-compatible chat completion and return the assistant text.
 * Shared by the OpenAI-compatible providers (Groq, OpenRouter, Ollama): handles the
 * abort timeout, fall-through status classification, and `choices[0].message.content`
 * extraction so each provider only builds its body + headers. */
export async function openaiCompatChat(
  url: string,
  key: string,
  body: unknown,
  label: string,
  timeoutMs?: number,
  extraHeaders?: Record<string, string>,
  onUsage?: (totalTokens: number) => void,
): Promise<string> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}`, ...extraHeaders },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs ?? 25000),
  });
  if (!res.ok) await throwForResponse(res, label);
  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
    usage?: { total_tokens?: number };
  };
  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error(`${label} returned no text`);
  if (data.usage?.total_tokens) onUsage?.(data.usage.total_tokens);
  return text;
}
