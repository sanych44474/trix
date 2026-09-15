// Reliable delivery for scheduler.ts's reminder sends (roadmap item 3). See migrations/0067 and
// domain/notificationDelivery.ts for the retry/backoff policy this stores state for.
import { nowIso, type DB } from "./shared";

export interface OutboxPayload {
  text: string;
  extra?: unknown; // grammY SendMessage `other` param (parse_mode, reply_markup, ...) — opaque here
}

export interface OutboxRow {
  id: number;
  userId: number;
  chatId: number;
  kind: string;
  attempts: number;
  payload: OutboxPayload;
}

/** Idempotent by (userId, idempotencyKey) — a duplicate enqueue of the same logical notification
 * is silently absorbed rather than creating a second row (defense in depth; the cutover flag,
 * not this, is what actually prevents cron/DO from both deciding to send in the first place).
 * Returns the new row's id, or null if it was a duplicate (nothing was inserted) — the caller
 * uses this to decide whether to attempt an immediate delivery. */
export async function enqueueNotification(
  db: DB,
  args: { userId: number; chatId: number; kind: string; idempotencyKey: string; payload: OutboxPayload },
): Promise<number | null> {
  const now = nowIso();
  const r = await db
    .prepare(
      `INSERT INTO notification_outbox (userId, chatId, kind, idempotencyKey, payload, status, attempts, nextAttemptAt, createdAt)
       VALUES (?, ?, ?, ?, ?, 'pending', 0, ?, ?)
       ON CONFLICT(userId, idempotencyKey) DO NOTHING
       RETURNING id`,
    )
    .bind(args.userId, args.chatId, args.kind, args.idempotencyKey, JSON.stringify(args.payload), now, now)
    .first<{ id: number }>();
  return r?.id ?? null;
}

interface OutboxRowRaw {
  id: number;
  userId: number;
  chatId: number;
  kind: string;
  attempts: number;
  payload: string;
}

/** Rows ready for a delivery attempt right now — pending and past their backoff window.
 * Ordered oldest-first so a backlog drains in creation order. */
export async function dueNotifications(db: DB, nowIsoStr: string, limit = 50): Promise<OutboxRow[]> {
  const r = await db
    .prepare("SELECT id, userId, chatId, kind, attempts, payload FROM notification_outbox WHERE status = 'pending' AND nextAttemptAt <= ? ORDER BY id ASC LIMIT ?")
    .bind(nowIsoStr, limit)
    .all<OutboxRowRaw>();
  return (r.results ?? []).flatMap((row) => {
    try {
      return [{ ...row, payload: JSON.parse(row.payload) as OutboxPayload }];
    } catch {
      return []; // corrupted payload — drop it from this batch; markPermanentFailure below cleans it up
    }
  });
}

export async function markSent(db: DB, id: number): Promise<void> {
  await db.prepare("UPDATE notification_outbox SET status = 'sent', sentAt = ? WHERE id = ?").bind(nowIso(), id).run();
}

export async function markRetry(db: DB, id: number, attempts: number, nextAttemptAt: Date, lastError: string): Promise<void> {
  await db
    .prepare("UPDATE notification_outbox SET attempts = ?, nextAttemptAt = ?, lastError = ? WHERE id = ?")
    .bind(attempts, nextAttemptAt.toISOString(), lastError.slice(0, 500), id)
    .run();
}

/** Terminal — either permanently undeliverable (blocked chat, bad request) or attempts exhausted.
 * `status` distinguishes the two for observability without adding another column. */
export async function markPermanentFailure(db: DB, id: number, status: "blocked" | "failed", lastError: string): Promise<void> {
  await db
    .prepare("UPDATE notification_outbox SET status = ?, lastError = ? WHERE id = ?")
    .bind(status, lastError.slice(0, 500), id)
    .run();
}

/** Telemetry-style cleanup, riding the same weekly prune pass as error_logs/ai_call_logs/
 * idempotency_keys (scheduler.ts's runGlobalJobs). */
export async function pruneNotificationOutbox(db: DB, beforeIso: string): Promise<void> {
  await db.prepare("DELETE FROM notification_outbox WHERE createdAt < ? AND status != 'pending'").bind(beforeIso).run();
}
