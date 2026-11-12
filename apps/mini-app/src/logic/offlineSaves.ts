// Workout saves made without a connection (a gym basement, a lift). The logger would otherwise
// show a red error over a finished session; instead the save is kept on the phone with its
// idempotency key and its date, and sent when the network is back — on the browser's "online"
// event, when the app comes back to the foreground, or on the next open. The same key on every
// retry means a save whose response was lost is never applied twice (server: runIdempotent),
// and the stored date means a save flushed after midnight still lands on the day it was logged.
// Pure apart from the Storage passed in; test/mini-app-offline-saves.test.ts.

export const OFFLINE_SAVES_KEY = "trix:v2:offline-saves";
export const TODAY_CACHE_KEY = "trix:v2:workout-today";
const MAX_QUEUED = 20;

export interface QueuedSave {
  key: string; // Idempotency-Key
  date: string; // YYYY-MM-DD the workout belongs to
  body: Record<string, unknown>; // the /workout/save body, date included
  queuedAt: number;
}

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function readQueue(store: Store): QueuedSave[] {
  try {
    const raw = JSON.parse(store.getItem(OFFLINE_SAVES_KEY) ?? "[]") as unknown;
    return Array.isArray(raw)
      ? raw.filter((q): q is QueuedSave => !!q && typeof q.key === "string" && typeof q.date === "string" && !!q.body && typeof q.body === "object")
      : [];
  } catch { return []; }
}

function writeQueue(store: Store, queue: QueuedSave[]): void {
  try {
    if (queue.length) store.setItem(OFFLINE_SAVES_KEY, JSON.stringify(queue));
    else store.removeItem(OFFLINE_SAVES_KEY);
  } catch { /* storage is optional */ }
}

/** Queue a save. A newer save for the same date replaces the older one (it carries every set). */
export function enqueueSave(store: Store, save: QueuedSave): void {
  const rest = readQueue(store).filter((q) => q.date !== save.date);
  writeQueue(store, [...rest, save].slice(-MAX_QUEUED));
}

/** A failure that means "no network", not "the server said no". fetch() rejects with a TypeError
 *  when it can't reach the server, and with a TimeoutError when api.ts's timeout fires; an HTTP
 *  error is an ApiError with a status. */
export function isNetworkError(err: unknown, online = true): boolean {
  if (!online) return true;
  if (err && typeof err === "object" && "status" in err && typeof (err as { status: unknown }).status === "number") return false;
  if ((err as { name?: unknown } | null)?.name === "TimeoutError") return true;
  return err instanceof TypeError || (err instanceof Error && /network|failed to fetch|load failed|offline/i.test(err.message));
}

export type FlushResult = { sent: number; dropped: number; remaining: number };

/**
 * Whether a failed save stays queued. The server's `retryable` flag decides when it is present
 * (a 401/403 from a session not there yet, a 409 for a key still in flight, a 5xx: retryable; a day
 * more than 14 days back: not). Without the flag: no network, 429 and 5xx stay queued, other 4xx drop.
 */
export function shouldRetry(err: unknown): boolean {
  if (isNetworkError(err)) return true;
  const retryable = (err as { retryable?: unknown }).retryable;
  if (typeof retryable === "boolean") return retryable;
  const status = (err as { status?: number }).status ?? 0;
  return status === 429 || status >= 500;
}

/** Remove the queued save for a date: a newer save for that day went through online. Without
 *  this the next flush replayed the older body and overwrote the newer workout. */
export function dequeueDate(store: Store, date: string): void {
  const queue = readQueue(store);
  if (queue.some((q) => q.date === date)) writeQueue(store, queue.filter((q) => q.date !== date));
}

const removeKey = (store: Store, key: string) => writeQueue(store, readQueue(store).filter((q) => q.key !== key));

/**
 * Send queued saves oldest first. Stops at the first network error (still offline) and keeps the
 * rest. Any other failure stays queued only when shouldRetry says so.
 *
 * The queue is re-read around every send, and only the entry just handled is removed. A send can
 * take the full request timeout on gym signal; a save queued meanwhile used to be erased when the
 * flush wrote its start-of-run snapshot back, after the logger had already said "saved".
 */
export async function flushQueue(store: Store, send: (q: QueuedSave) => Promise<void>): Promise<FlushResult> {
  let sent = 0, dropped = 0;
  const tried = new Set<string>();
  for (;;) {
    // The oldest entry not tried in this run. One replaced by a newer save for its date is gone
    // from the queue by now and is never sent.
    const q = readQueue(store).find((entry) => !tried.has(entry.key));
    if (!q) break;
    tried.add(q.key);
    try {
      await send(q);
      sent++;
      removeKey(store, q.key);
    } catch (err) {
      if (isNetworkError(err)) break;
      if (!shouldRetry(err)) { dropped++; removeKey(store, q.key); }
    }
  }
  return { sent, dropped, remaining: readQueue(store).length };
}

/** The device's calendar date (the logger's "today" when the server can't be asked). */
export function localDate(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Last /workout/today response, so the logger still opens in a gym with no signal. Only a
 *  response for today is reused. */
export function cacheToday(store: Store, raw: { date: string }): void {
  try { store.setItem(TODAY_CACHE_KEY, JSON.stringify(raw)); } catch { /* storage is optional */ }
}

export function cachedToday<T extends { date: string }>(store: Store, today = localDate()): T | null {
  try {
    const raw = JSON.parse(store.getItem(TODAY_CACHE_KEY) ?? "null") as T | null;
    return raw && raw.date === today ? raw : null;
  } catch { return null; }
}
