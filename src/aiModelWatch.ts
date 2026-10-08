// Weekly check that every AI model id the Worker is configured to call still exists. Providers
// retire free models with little notice (Groq dropped its vision models, OpenRouter rotates its
// :free roster, Gemini previews expire), and a vanished id doesn't fail loudly: the fallback
// chain silently skips it, quality drops, and nobody notices until a whole provider is gone.
// Only the providers' model LISTS are read — no generation, no cost — and the owner gets one bot
// message naming each configured id that is no longer listed. scripts/check-ai-models.mjs is the
// manual, fuller version (it also test-calls every model).
import type { Env } from "./types";
import { getOwnerChatId } from "./adapters/d1/v2Admin";
import { runOncePer } from "./schedulerJobs/runOncePer";
import { geminiFallbackModels } from "./ai/gemini";
import { GROQ_DEFAULT_MODEL } from "./ai/groq";
import { OPENROUTER_DEFAULT_TRANSLATE_MODEL, OPENROUTER_DEFAULT_VISION_MODEL, openrouterTextModels } from "./ai/openrouter";
import { ollamaModels } from "./ai/ollama";

export type Provider = "gemini" | "groq" | "openrouter" | "ollama";
const WEEK_MS = 7 * 86_400_000;
const STATE_KEY = "last_ai_model_check";
const list = (s: string | undefined) => (s ?? "").split(",").map((m) => m.trim()).filter(Boolean);

/** Every model id the Worker may call, per provider (only providers with a key). */
export function configuredModels(env: Env): Partial<Record<Provider, string[]>> {
  const out: Partial<Record<Provider, string[]>> = {};
  if (env.GEMINI_API_KEY) out.gemini = geminiFallbackModels(env);
  if (env.GROQ_API_KEY) out.groq = [...new Set([env.GROQ_MODEL || GROQ_DEFAULT_MODEL, ...list(env.GROQ_FALLBACK_MODELS), ...list(env.GROQ_VISION_MODEL)])];
  if (env.OPENROUTER_API_KEY) out.openrouter = [...new Set([...openrouterTextModels(env), env.OPENROUTER_VISION_MODEL || OPENROUTER_DEFAULT_VISION_MODEL, env.OPENROUTER_TRANSLATE_MODEL || OPENROUTER_DEFAULT_TRANSLATE_MODEL])];
  if (env.OLLAMA_API_KEY) out.ollama = ollamaModels(env);
  return out;
}

/** Configured ids missing from a provider's catalog. Pure; test/ai-model-watch.test.ts. */
export function missingModels(configured: string[], catalog: string[]): string[] {
  const have = new Set(catalog.map((id) => id.replace(/^models\//, "").toLowerCase()));
  return configured.filter((id) => !have.has(id.toLowerCase()));
}

async function ids(url: string, headers: Record<string, string>, pick: (body: unknown) => string[]): Promise<string[]> {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return pick(await res.json());
}
const dataIds = (b: unknown) => ((b as { data?: Array<{ id?: string }> }).data ?? []).map((m) => m.id ?? "").filter(Boolean);

export async function fetchCatalog(env: Env, provider: Provider): Promise<string[]> {
  switch (provider) {
    case "gemini":
      return ids("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000", { "X-goog-api-key": env.GEMINI_API_KEY },
        (b) => ((b as { models?: Array<{ name?: string }> }).models ?? []).map((m) => m.name ?? "").filter(Boolean));
    case "groq":
      return ids("https://api.groq.com/openai/v1/models", { Authorization: `Bearer ${env.GROQ_API_KEY}` }, dataIds);
    case "openrouter":
      return ids("https://openrouter.ai/api/v1/models", {}, dataIds);
    case "ollama":
      return ids("https://ollama.com/v1/models", { Authorization: `Bearer ${env.OLLAMA_API_KEY}` }, dataIds);
  }
}

/** Run the check now; returns the missing ids per provider (an unreachable catalog is skipped). */
export async function checkModels(env: Env): Promise<{ missing: Partial<Record<Provider, string[]>>; unreachable: Provider[] }> {
  const missing: Partial<Record<Provider, string[]>> = {};
  const unreachable: Provider[] = [];
  for (const [provider, models] of Object.entries(configuredModels(env)) as Array<[Provider, string[]]>) {
    try {
      const gone = missingModels(models, await fetchCatalog(env, provider));
      if (gone.length) missing[provider] = gone;
    } catch {
      unreachable.push(provider);
    }
  }
  return { missing, unreachable };
}

export function modelAlertText(r: { missing: Partial<Record<Provider, string[]>>; unreachable: Provider[] }): string | null {
  const rows = Object.entries(r.missing).map(([p, ids]) => `• <b>${p}</b>: ${ids!.map((id) => `<code>${id}</code>`).join(", ")}`);
  // An unreachable catalog is reported on its own: a provider whose list cannot be read is a provider
  // whose retired ids go unnoticed, which is exactly what this check exists to prevent.
  if (!rows.length && !r.unreachable.length) return null;
  return [
    ...(rows.length ? ["🤖 <b>AI models gone</b> — configured ids no longer listed by the provider:", ...rows] : []),
    ...(r.unreachable.length ? [`${rows.length ? "(" : "⚠️ <b>AI model check incomplete</b> — "}catalog unreachable: ${r.unreachable.join(", ")}${rows.length ? ")" : ""}`] : []),
    "Update wrangler.toml [vars]; <code>npm run check:ai-models -- --catalog</code> lists what's available.",
  ].join("\n");
}

/** Once a week from the global pass: alert the owner when a configured model has disappeared.
 * The week is closed only after the check and the alert both went through (runOncePer), so a
 * failed catalog read or a failed send is retried on the next tick instead of losing the week. */
export async function weeklyModelCheck(env: Env, send: (chatId: number, text: string) => Promise<unknown>, now = Date.now()): Promise<void> {
  await runOncePer(env.DB, { key: STATE_KEY, period: { windowMs: WEEK_MS }, now }, async () => {
    const text = modelAlertText(await checkModels(env));
    if (!text) return;
    const owner = await getOwnerChatId(env.DB);
    if (owner !== undefined) await send(owner, text);
  });
}
