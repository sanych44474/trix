// Delivery mechanics for the scheduler notification outbox (roadmap item 3, migrations/0067).
// Two entry points share attemptDelivery so a send outcome means the same thing either way:
//  - enqueueAndDeliver: called from scheduler.ts's processUser `send` closure — enqueues, then
//    attempts delivery immediately so the happy path keeps today's near-instant latency. A
//    failure is now PERSISTED and retried, not silently dropped.
//  - deliverDueNotifications: called once per runScheduleInner tick (the existing per-minute
//    cron) — sweeps rows a previous attempt backed off, whose nextAttemptAt has now passed.
import type { Bot } from "grammy";
import { GrammyError } from "grammy";
import { dueNotifications, enqueueNotification, markPermanentFailure, markRetry, markSent, updateUser, type OutboxRow } from "./db/repos";
import { classifySendError } from "./domain/notificationDelivery";
import type { Env } from "./types";

export interface OutboxSender {
  api: { sendMessage: Bot["api"]["sendMessage"] };
}

export type DeliveryResult = "sent" | "blocked" | "retrying" | "failed" | "duplicate";

async function attemptDelivery(db: D1Database, bot: OutboxSender, row: OutboxRow): Promise<DeliveryResult> {
  try {
    await bot.api.sendMessage(row.chatId, row.payload.text, row.payload.extra as Parameters<Bot["api"]["sendMessage"]>[2]);
    await markSent(db, row.id);
    return "sent";
  } catch (err) {
    const info = err instanceof GrammyError ? { errorCode: err.error_code, retryAfterSeconds: err.parameters?.retry_after } : {};
    const outcome = classifySendError(info, row.attempts);
    const message = err instanceof Error ? err.message : String(err);
    if (outcome.kind === "blocked") {
      await markPermanentFailure(db, row.id, "blocked", message);
      // Same signal processUser's OLD inline catch already acted on — centralized here so the
      // retry sweep (which runs outside any processUser invocation) also flips it, not just the
      // immediate-attempt path.
      await updateUser(db, row.userId, { botBlocked: true }).catch(() => {});
      return "blocked";
    }
    if (outcome.kind === "retry") {
      await markRetry(db, row.id, row.attempts + 1, outcome.nextAttemptAt, message);
      return "retrying";
    }
    await markPermanentFailure(db, row.id, "failed", message);
    return "failed";
  }
}

export async function enqueueAndDeliver(
  env: Env,
  bot: OutboxSender,
  args: { userId: number; chatId: number; kind: string; idempotencyKey: string; text: string; extra?: unknown },
): Promise<DeliveryResult> {
  const db = env.DB;
  const id = await enqueueNotification(db, {
    userId: args.userId,
    chatId: args.chatId,
    kind: args.kind,
    idempotencyKey: args.idempotencyKey,
    payload: { text: args.text, extra: args.extra },
  });
  if (id === null) return "duplicate"; // already enqueued (and already attempted or in flight)
  return attemptDelivery(db, bot, { id, userId: args.userId, chatId: args.chatId, kind: args.kind, attempts: 0, payload: { text: args.text, extra: args.extra } });
}

/** The retry sweep — rows a previous attempt backed off, now due. Runs once per cron tick
 * (runScheduleInner), so backoff granularity is effectively the tick interval (every minute in
 * this Worker's trigger config) even though computeBackoffMs can schedule further out. */
export async function deliverDueNotifications(env: Env, bot: OutboxSender, limit = 50): Promise<{ sent: number; retrying: number; failed: number }> {
  const db = env.DB;
  const rows = await dueNotifications(db, new Date().toISOString(), limit);
  let sent = 0, retrying = 0, failed = 0;
  for (const row of rows) {
    const outcome = await attemptDelivery(db, bot, row);
    if (outcome === "sent") sent++;
    else if (outcome === "retrying") retrying++;
    else if (outcome === "blocked" || outcome === "failed") failed++;
  }
  return { sent, retrying, failed };
}
