// Small pieces every scheduler job shares: the HTML send options, error logging into
// error_logs, a date helper and the narrowed bot surface (split out of scheduler.ts).
import { Bot } from "grammy";
import { recordError } from "../adapters/d1/v2Admin";

export const HTML = { parse_mode: "HTML" as const, link_preview_options: { is_disabled: true } };

/**
 * Persist a scheduler-internal failure to error_logs, where /ownerreport → Errors actually reads
 * from — console.error alone only reaches whoever happens to be running `wrangler tail` live.
 *
 * Deliberately NOT used for individual bot.api.sendMessage failures (blocked bot, deleted chat):
 * those are routine at any real user count and would drown the signal that matters — the
 * recovery sweeps and report generation breaking — under noise. This covers exactly the sites
 * that were already being console.error'd as "this needed someone's attention," so nothing about
 * the error taxonomy is invented here, only where each one goes.
 */
export function logSchedulerError(db: D1Database, kind: string, e: unknown, userId?: number): void {
  console.error(kind, userId, e);
  recordError(db, { userId, kind, errorType: "exception", message: String(e).slice(0, 200) }).catch(() => {});
}

export function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

// The only bot surface processUser (and everything it calls) needs. Narrowed from the
// concrete grammY Bot so a dry-run caller (a DO alarm, logging what it WOULD send) can pass
// a logging stand-in instead of a real bot, without an `as unknown as Bot` cast.
export interface Sender {
  api: { sendMessage: Bot["api"]["sendMessage"] };
}
