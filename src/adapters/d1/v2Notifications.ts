// v2-native notification outbox (Domain 9 of the v2 cutover — see
// docs/adr/0001-v2-seams-and-staged-cutover.md). Faithful port of
// src/db/repos/notificationOutbox.ts: same exported names/signatures, same retry/backoff
// semantics — but reads/writes ONLY v2_notifications/v2_notification_attempts
// (migrations/0069_v2_core.sql + 0070_v2_long_tail.sql, completed by
// migrations/0081_v2_admin_complete.sql — see that file's header for why the rebuild was
// necessary: 0069 scoped idempotencyKey uniqueness globally instead of per-account, and never
// gave the table a chatId/lastError column at all).
//
// markSent/markRetry/markPermanentFailure deliberately do NOT also write to
// v2_notification_attempts (the per-attempt history table 0070 created). Nothing in the legacy
// notificationOutbox.ts wrote a per-attempt row either — 0070's INSERT into
// v2_notification_attempts was a one-time backfill synthesizing ONE attempt row per legacy
// notification_outbox row from its final (attempts, status, lastError) state, not an ongoing
// writer. Porting that same (non-)behavior forward: this module updates v2_notifications' own
// attempts/status/lastError columns in place on every delivery outcome (exactly like legacy did
// to notification_outbox), and leaves v2_notification_attempts as a historical snapshot rather
// than inventing a new per-attempt-row writer that legacy never had.
import { nowIso, type DB } from "../../db/repos/shared";

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

/** Idempotent by (accountId, idempotencyKey) — a duplicate enqueue of the same logical
 * notification is silently absorbed rather than creating a second row (defense in depth; the
 * cutover flag, not this, is what actually prevents cron/DO from both deciding to send in the
 * first place). Returns the new row's id, or null if it was a duplicate (nothing was inserted) —
 * the caller uses this to decide whether to attempt an immediate delivery. */
export async function enqueueNotification(
  db: DB,
  args: { userId: number; chatId: number; kind: string; idempotencyKey: string; payload: OutboxPayload },
): Promise<number | null> {
  const now = nowIso();
  const r = await db
    .prepare(
      `INSERT INTO v2_notifications (accountId, chatId, kind, idempotencyKey, payload, status, attempts, nextAttemptAt, createdAt)
       VALUES (?, ?, ?, ?, ?, 'pending', 0, ?, ?)
       ON CONFLICT(accountId, idempotencyKey) DO NOTHING
       RETURNING id`,
    )
    .bind(args.userId, args.chatId, args.kind, args.idempotencyKey, JSON.stringify(args.payload), now, now)
    .first<{ id: number }>();
  return r?.id ?? null;
}

interface OutboxRowRaw {
  id: number;
  accountId: number;
  chatId: number;
  kind: string;
  attempts: number;
  payload: string;
}

/** Rows ready for a delivery attempt right now — pending and past their backoff window.
 * Ordered oldest-first so a backlog drains in creation order. */
export async function dueNotifications(db: DB, nowIsoStr: string, limit = 50): Promise<OutboxRow[]> {
  const r = await db
    .prepare("SELECT id, accountId, chatId, kind, attempts, payload FROM v2_notifications WHERE status = 'pending' AND nextAttemptAt <= ? ORDER BY id ASC LIMIT ?")
    .bind(nowIsoStr, limit)
    .all<OutboxRowRaw>();
  return (r.results ?? []).flatMap((row) => {
    try {
      return [{ id: row.id, userId: row.accountId, chatId: row.chatId, kind: row.kind, attempts: row.attempts, payload: JSON.parse(row.payload) as OutboxPayload }];
    } catch {
      return []; // corrupted payload — drop it from this batch; markPermanentFailure below cleans it up
    }
  });
}

export async function markSent(db: DB, id: number): Promise<void> {
  await db.prepare("UPDATE v2_notifications SET status = 'sent', sentAt = ? WHERE id = ?").bind(nowIso(), id).run();
}

export async function markRetry(db: DB, id: number, attempts: number, nextAttemptAt: Date, lastError: string): Promise<void> {
  await db
    .prepare("UPDATE v2_notifications SET attempts = ?, nextAttemptAt = ?, lastError = ? WHERE id = ?")
    .bind(attempts, nextAttemptAt.toISOString(), lastError.slice(0, 500), id)
    .run();
}

/** Terminal — either permanently undeliverable (blocked chat, bad request) or attempts exhausted.
 * `status` distinguishes the two for observability without adding another column. */
export async function markPermanentFailure(db: DB, id: number, status: "blocked" | "failed", lastError: string): Promise<void> {
  await db
    .prepare("UPDATE v2_notifications SET status = ?, lastError = ? WHERE id = ?")
    .bind(status, lastError.slice(0, 500), id)
    .run();
}

/** Telemetry-style cleanup, riding the same weekly prune pass as error_logs/ai_call_logs/
 * idempotency_keys (scheduler.ts's runGlobalJobs). */
export async function pruneNotificationOutbox(db: DB, beforeIso: string): Promise<void> {
  await db.prepare("DELETE FROM v2_notifications WHERE createdAt < ? AND status != 'pending'").bind(beforeIso).run();
}
