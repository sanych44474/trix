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
 *  when it can't reach the server; an HTTP error is an ApiError with a status. */
export function isNetworkError(err: unknown, online = true): boolean {
  if (!online) return true;
  if (err && typeof err === "object" && "status" in err && typeof (err as { status: unknown }).status === "number") return false;
  return err instanceof TypeError || (err instanceof Error && /network|failed to fetch|load failed|offline/i.test(err.message));
}

export type FlushResult = { sent: number; dropped: number; remaining: number };

/**
 * Send queued saves oldest first. Stops at the first network error (still offline) and keeps the
 * rest. A 409 (the same key still in flight) or a 5xx/429 stays queued for the next try; any
 * other 4xx (e.g. the day is now more than 14 days back) can never succeed and is dropped.
 */
export async function flushQueue(store: Store, send: (q: QueuedSave) => Promise<void>): Promise<FlushResult> {
  const queue = readQueue(store);
  const keep: QueuedSave[] = [];
  let sent = 0, dropped = 0;
  for (let i = 0; i < queue.length; i++) {
    const q = queue[i]!;
    try {
      await send(q);
      sent++;
    } catch (err) {
      if (isNetworkError(err)) { keep.push(...queue.slice(i)); break; }
      const status = (err as { status?: number }).status ?? 0;
      if (status === 409 || status === 429 || status >= 500) keep.push(q);
      else dropped++;
    }
  }
  writeQueue(store, keep);
  return { sent, dropped, remaining: keep.length };
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
