// The environment a Durable Object's dry run executes against. Dry run means: decide for real,
// apply nothing and contact no one. The DB is already shadowed (shadowDb.ts) and Telegram sends go
// to a logging sender, but `{ ...env }` also copied every outbound credential, so the run still
// reached the outside world through anything that does not go through those two seams:
//   - push: a push-only user's reminder goes outbox -> attemptPush -> sendPush(env.FCM_SERVICE_ACCOUNT),
//     a real FCM request; with the outbox's dedup rows shadowed it repeated every hour.
//   - AI: the weekly narrative and the global jobs (model check, KB sync, exercise learning) call
//     providers with these keys and the Workers AI binding.
//   - YouTube / exercise / food lookups, Strava, email.
// Stripping them makes each of those paths take its own "not configured" branch (sendPush returns
// "failed" before any fetch, aiText throws and the caller falls back), which is exactly the
// no-side-effects behaviour a dry run promises.
import type { Env } from "../types";

/** Credentials and bindings that let code talk to a third party. Never available to a dry run. */
export const OUTBOUND_KEYS = [
  "FCM_SERVICE_ACCOUNT",
  "GEMINI_API_KEY",
  "GROQ_API_KEY",
  "OLLAMA_API_KEY",
  "OPENROUTER_API_KEY",
  "AI",
  "YOUTUBE_API_KEY",
  "EXERCISES_API_KEY",
  "USDA_FDC_API_KEY",
  "FATSECRET_CLIENT_ID",
  "FATSECRET_CLIENT_SECRET",
  "STRAVA_CLIENT_ID",
  "STRAVA_CLIENT_SECRET",
  "RESEND_API_KEY",
  "HEALTHCHECK_PING_URL",
] as const;

export function dryRunEnv(env: Env, shadowDb: D1Database): Env {
  const out: Record<string, unknown> = { ...env, DB: shadowDb };
  for (const key of OUTBOUND_KEYS) delete out[key];
  return out as unknown as Env;
}
