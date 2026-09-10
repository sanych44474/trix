// Client-supplied idempotency keys for Mini App POST actions — see migrations/0063 for why this
// exists (row-level PKs already dedupe the underlying write; this dedupes the SIDE EFFECTS a
// retried request would otherwise repeat, like a trainer notification sent inside the handler).
import type { DB } from "./shared";
import { nowIso } from "./shared";

const WINDOW_HOURS = 24; // a retry hours later is a NEW action, not a duplicate of the first

export interface CachedResponse {
  status: number;
  response: unknown;
}

/** A previously recorded response for this (userId, key), if it's still inside the replay
 * window. Returns null on a fresh key OR one old enough to no longer count as "the same
 * attempt" — the caller should then run the handler for real and record the result. */
export async function getIdempotentResponse(db: DB, userId: number, key: string): Promise<CachedResponse | null> {
  const cutoff = new Date(Date.now() - WINDOW_HOURS * 3_600_000).toISOString();
  const row = await db
    .prepare("SELECT response, status FROM idempotency_keys WHERE userId = ? AND key = ? AND createdAt >= ?")
    .bind(userId, key, cutoff)
    .first<{ response: string; status: number }>();
  if (!row) return null;
  try {
    return { status: row.status, response: JSON.parse(row.response) };
  } catch {
    return null; // corrupt row (should never happen) — treat as a miss rather than throw
  }
}

/** Record a handler's result under this key. ON CONFLICT overwrite: a key can only legitimately
 * collide with an EARLIER attempt of the same action (checked via getIdempotentResponse first),
 * so refreshing createdAt on a genuine re-record is harmless. */
export async function recordIdempotentResponse(db: DB, userId: number, key: string, status: number, response: unknown): Promise<void> {
  await db
    .prepare(
      "INSERT INTO idempotency_keys (userId, key, response, status, createdAt) VALUES (?, ?, ?, ?, ?) " +
        "ON CONFLICT(userId, key) DO UPDATE SET response = excluded.response, status = excluded.status, createdAt = excluded.createdAt",
    )
    .bind(userId, key, JSON.stringify(response), status, nowIso())
    .run();
}

/** Telemetry-style cleanup, called from the same weekly prune pass as error_logs/ai_call_logs
 * (scheduler.ts). Keys are only ever meant to survive WINDOW_HOURS; the 90-day cutoff shared
 * with everything else in that pass is generous on purpose (cheap, and a stray row costs nothing). */
export async function pruneIdempotencyKeys(db: DB, beforeIso: string): Promise<void> {
  await db.prepare("DELETE FROM idempotency_keys WHERE createdAt < ?").bind(beforeIso).run();
}
