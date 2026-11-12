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
import { logError } from "../../log";

/** The slice of Cloudflare's RateLimit binding this module uses. */
interface RateLimitBinding {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

/** `admin`: guessing ADMIN_SECRET. `expensive`: Mini App actions that call AI or send documents. */
type LimitName = "admin" | "expensive" | "auth";

const BINDING: Record<LimitName, string> = { admin: "RL_ADMIN", expensive: "RL_EXPENSIVE", auth: "RL_AUTH" };
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
  ["/api/v2/photo", "media"],
  ["/api/v2/coach", "coach"],
  ["/api/v2/chat", "chat"],
  ["/api/v2/settings", "settings"],
];

/** Single routes outside those prefixes that spend AI calls or the shared YouTube quota (a search
 * costs 100 of ~10k daily units) on each request, reads included: exercise info looks the name up
 * with AI and YouTube, so a loop of made-up names could use up the day's quota for every user. */
const EXPENSIVE_ROUTES: Array<[method: string, path: string, bucket: string]> = [
  ["GET", "/api/v2/workout/exinfo", "exinfo"],
  ["GET", "/api/v2/workout/insight", "insight"],
  ["POST", "/api/v2/workout/custom", "custom"],
  ["POST", "/api/v2/plan/replan", "replan"],
];

/** The limiter bucket for a v2 request, or null when it is not throttled. */
export function expensiveBucket(method: string, pathname: string): string | null {
  for (const [m, path, bucket] of EXPENSIVE_ROUTES) if (method === m && pathname === path) return bucket;
  if (method !== "POST") return null;
  for (const [prefix, bucket] of EXPENSIVE_PREFIXES) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return bucket;
  }
  return null;
}
