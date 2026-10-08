// Request throttling for the HTTP surface. The only limiter before this lived inside the AI
// module (ai/index.ts, 20 attempts per 5 minutes, counted from telemetry rows), so the HTTP layer
// could not see it and nothing at all protected /admin/* from secret guessing or the expensive
// Mini App actions (photo, voice, coach, trainer chat, feedback, export) from a flood.
//
// Backed by the Workers Rate Limiting binding (wrangler.toml `[[ratelimits]]`). Two properties of
// that binding shape this module:
//  - counters are per Cloudflare location and eventually consistent, so this is abuse protection,
//    not exact accounting -- a burst can briefly exceed the limit, and it is not a billing meter;
//  - the binding may be missing (local dev, tests, or a plan that does not provide it). A missing or
//    failing limiter FAILS OPEN and says so once per isolate: dropping every request because the
//    protection is unavailable would turn a safety net into an outage.
//
// Keys are stable identifiers (a user id, or the client IP for /admin where there is no user), never
// a region.
import { logError } from "./log";

/** The slice of Cloudflare's RateLimit binding this module uses. */
export interface RateLimitBinding {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

/** `admin`: guessing ADMIN_SECRET. `expensive`: Mini App actions that call AI or send documents. */
export type LimitName = "admin" | "expensive";

const BINDING: Record<LimitName, string> = { admin: "RL_ADMIN", expensive: "RL_EXPENSIVE" };
const warned = new Set<string>();

function warnOnce(name: LimitName, reason: string, err?: unknown): void {
  if (warned.has(name)) return;
  warned.add(name);
  logError("rate_limit_unavailable", err ?? new Error(reason), { limit: name });
}

/** True when the request may proceed. `key` namespaces the counter (e.g. `media:42`). */
export async function withinLimit(env: object, name: LimitName, key: string): Promise<boolean> {
  const binding = (env as Record<string, RateLimitBinding | undefined>)[BINDING[name]];
  if (!binding) {
    warnOnce(name, `binding ${BINDING[name]} is not configured`);
    return true;
  }
  try {
    return (await binding.limit({ key })).success;
  } catch (err) {
    warnOnce(name, "limiter threw", err);
    return true;
  }
}

/** Mini App actions that cost AI calls or Telegram uploads, keyed to a limiter bucket. Prefix match,
 * POST only: reads are cheap and the app polls them. `settings` is here because feedback and the
 * data exports are POST actions inside it. */
const EXPENSIVE_PREFIXES: Array<[prefix: string, bucket: string]> = [
  ["/api/v2/media", "media"],
  ["/api/v2/coach", "coach"],
  ["/api/v2/chat", "chat"],
  ["/api/v2/settings", "settings"],
];

/** The limiter bucket for a v2 request, or null when it is not throttled. */
export function expensiveBucket(method: string, pathname: string): string | null {
  if (method !== "POST") return null;
  for (const [prefix, bucket] of EXPENSIVE_PREFIXES) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return bucket;
  }
  return null;
}
