// Pure retry/backoff policy for the scheduler notification outbox (db/repos/notificationOutbox.ts,
// wired into scheduler.ts's processUser `send` closure). Deliberately grammY-free: the caller
// extracts the handful of fields that matter from whatever error type it caught (GrammyError,
// HttpError, ...) so this stays a plain-object function, testable without mocking the bot API.
export const MAX_DELIVERY_ATTEMPTS = 6;
const BASE_BACKOFF_MS = 60_000; // 1 minute
const MAX_BACKOFF_MS = 60 * 60_000; // 1 hour cap — the per-minute cron will pick it up eventually

export function computeBackoffMs(attempts: number): number {
  // attempts=1 (first failure) -> 1min, 2 -> 2min, 3 -> 4min, ... capped at MAX_BACKOFF_MS.
  return Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** Math.max(0, attempts - 1));
}

export interface SendErrorInfo {
  /** Telegram Bot API error_code, when the failure was a GrammyError (an API-level rejection,
   * as opposed to a network/HTTP failure reaching Telegram at all). */
  errorCode?: number;
  /** Telegram's own requested backoff for a 429, in seconds (err.parameters.retry_after). */
  retryAfterSeconds?: number;
}

export type DeliveryOutcome =
  | { kind: "sent" }
  | { kind: "blocked" } // 403 — the chat is gone (user blocked the bot); never retry
  | { kind: "retry"; nextAttemptAt: Date }
  | { kind: "permanent_failure" }; // exhausted attempts, or an error retrying can't fix

export function classifySendError(info: SendErrorInfo, attemptsSoFar: number): DeliveryOutcome {
  const attempts = attemptsSoFar + 1;
  if (info.errorCode === 403) return { kind: "blocked" };
  if (info.errorCode === 429) {
    if (attempts >= MAX_DELIVERY_ATTEMPTS) return { kind: "permanent_failure" };
    const retryAfterMs = (info.retryAfterSeconds ?? 30) * 1000;
    // Telegram's own requested wait is authoritative when given — take whichever is longer of
    // that and our own backoff schedule, so a big retry_after is never undercut.
    return { kind: "retry", nextAttemptAt: new Date(Date.now() + Math.max(retryAfterMs, computeBackoffMs(attempts))) };
  }
  // Any other 4xx (400 bad request, 404 chat not found, ...) will not succeed by retrying —
  // the request itself is wrong, not transient.
  if (info.errorCode !== undefined && info.errorCode >= 400 && info.errorCode < 500) {
    return { kind: "permanent_failure" };
  }
  // Network failure / 5xx / unrecognized — transient, retry with backoff up to the attempt cap.
  if (attempts >= MAX_DELIVERY_ATTEMPTS) return { kind: "permanent_failure" };
  return { kind: "retry", nextAttemptAt: new Date(Date.now() + computeBackoffMs(attempts)) };
}
