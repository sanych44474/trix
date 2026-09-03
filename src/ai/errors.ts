/** Thrown when a provider is rate-limited / out of quota / temporarily unavailable. */
export class RateLimitError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "RateLimitError";
  }
}

export interface InlineImage {
  mimeType: string;
  dataBase64: string;
}

/** Parse a comma-separated list of API keys (multiple keys multiply free-tier quota). */
export function splitKeys(raw?: string): string[] {
  return (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Try each key in turn; return the first usable result, else throw the last error.
 * Rotates on ANY failure (rate-limit, dead key, transient, failed validation) so one bad
 * key/output fails over. `opts.attempts` retries the SAME key that many times before moving
 * on (e.g. 2 → up to 2 generations per key); `opts.validate` rejects an unusable result
 * (throws) so it's retried/rotated instead of returned. */
export async function withKeys<T>(
  keys: string[],
  attempt: (key: string) => Promise<T>,
  opts: { attempts?: number; validate?: (result: T) => void } = {},
): Promise<T> {
  if (!keys.length) throw new Error("no API key configured");
  const tries = Math.max(1, opts.attempts ?? 1);
  let lastErr: unknown;
  for (const key of keys) {
    for (let i = 0; i < tries; i++) {
      try {
        const result = await attempt(key);
        opts.validate?.(result); // throws → treated as a failed attempt
        return result;
      } catch (err) {
        lastErr = err; // retry same key, then next key
      }
    }
  }
  throw lastErr ?? new Error("all API keys failed");
}

export interface GenInput {
  system: string;
  user: string;
  images?: InlineImage[];
  schema?: unknown; // request JSON output
  temperature?: number;
  model?: string; // per-call model override (provider-specific)
  groqModel?: string; // per-call Groq primary model override (e.g. pick gpt-oss-120b for a stage)
  validate?: (text: string) => void; // reject unusable output → retry/rotate (throws)
  attemptsPerKey?: number; // generations to try per key before rotating (default 1)
  maxModels?: number; // max number of models to try (Gemini only; default unlimited)
  timeoutMs?: number; // per-fetch abort timeout (default 25s) — kept short for fast kinds
                      // so one slow provider can't blow the whole-chain budget before fallback
  deadlineMs?: number; // absolute epoch-ms budget for THIS provider's whole model×key ladder —
                       // stop starting new attempts past it so the chain can still reach fallbacks
  onUsage?: (totalTokens: number) => void; // reports token usage of the SUCCESSFUL generation
}
