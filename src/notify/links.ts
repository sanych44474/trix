// Telegram deep links into THIS deployment's bot. Kept in its own module with no bot imports so
// any layer (handlers, scheduler, plan finalisation) can build a link without an import cycle.
import type { Env } from "../types";

/** Bare @username of the configured bot, or "" when BOT_USERNAME is unset (a fresh fork). */
export function botUsername(env: Env): string {
  return env.BOT_USERNAME?.replace(/^@/, "") ?? "";
}

/**
 * `t.me/<bot>?start=<payload>` — the entry point for every referral/pairing flow.
 * Returns "" when the deployment has no BOT_USERNAME, so callers render a fallback instead of a
 * link pointing at nobody.
 */
export function botDeepLink(env: Env, payload: string): string {
  const user = botUsername(env);
  return user ? `https://t.me/${user}?start=${payload}` : "";
}

/**
 * Telegram's native share sheet. Opening this from a button lets the user pick the chat, so the
 * card lands as a real forward rather than a copied-out link.
 */
export function shareUrl(link: string, text: string): string {
  return `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`;
}
