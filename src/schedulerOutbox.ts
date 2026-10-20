// Delivery mechanics for the scheduler notification outbox (roadmap item 3, migrations/0067).
// Two entry points share attemptDelivery so a send outcome means the same thing either way:
//  - enqueueAndDeliver: called from scheduler.ts's processUser `send` closure — enqueues, then
//    attempts delivery immediately so the happy path keeps today's near-instant latency. A
//    failure is now PERSISTED and retried, not silently dropped.
//  - deliverDueNotifications: called once per runScheduleInner tick (the existing per-minute
//    cron) — sweeps rows a previous attempt backed off, whose nextAttemptAt has now passed.
import type { Bot } from "grammy";
import { GrammyError } from "grammy";
import { claimNotification, dueNotifications, enqueueNotification, notificationsMuted, markPermanentFailure, markRetry, markSent, type OutboxRow } from "./adapters/d1/v2Notifications";
import { updateUser } from "./adapters/d1/v2Users";
import { classifySendError } from "./domain/notificationDelivery";
import type { Env } from "./types";
import { deletePushTokens, listPushTokens } from "./adapters/d1/v2Push";
import { sendPush } from "./adapters/fcm/fcm";
import { pushParts } from "./domain/plainText";

export interface OutboxSender {
  api: { sendMessage: Bot["api"]["sendMessage"] };
}

// "muted": the recipient turned all notifications off, so nothing was queued or sent. Durable in
// the dedup sense -- the event is handled, it must not be retried every tick.
export type DeliveryResult = "sent" | "blocked" | "retrying" | "failed" | "duplicate" | "muted";

// An account with no Telegram chat (chatId <= 0: email / Google sign-in, or the bot blocked) is
// reached through the native app's push tokens instead. Same outcomes as a Telegram send: sent,
// retried with backoff, or failed for good (no device left).
async function attemptPush(env: Env, row: OutboxRow): Promise<DeliveryResult> {
  const db = env.DB;
  const tokens = await listPushTokens(db, row.userId);
  if (!tokens.length) {
    await markPermanentFailure(db, row.id, "failed", "no_channel");
    return "failed";
  }
  const msg = { ...pushParts(row.payload.text, "Hack Limits"), data: { kind: row.kind } };
  const results = await Promise.all(tokens.map((t) => sendPush(env, t, msg)));
  await deletePushTokens(db, tokens.filter((_, i) => results[i] === "unregistered").map((t) => t.token)).catch(() => {});
  if (results.includes("sent")) {
    await markSent(db, row.id);
    return "sent";
  }
  if (results.includes("retry")) {
    const outcome = classifySendError({}, row.attempts);
    if (outcome.kind === "retry") {
      await markRetry(db, row.id, row.attempts + 1, outcome.nextAttemptAt, "push_retry");
      return "retrying";
    }
  }
  await markPermanentFailure(db, row.id, "failed", results.every((r) => r === "unregistered") ? "no_channel" : "push_failed");
  return "failed";
}

async function attemptDelivery(env: Env, bot: OutboxSender, row: OutboxRow): Promise<DeliveryResult> {
  const db = env.DB;
  if (row.chatId <= 0) return attemptPush(env, row);
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

// A row being delivered right now must not look due to the retry sweep: the sweep runs every
// minute (and a user's Durable Object alarm runs beside it), so a row enqueued as due-now was
// picked up by a sweep while the first attempt was still talking to Telegram -- the same reminder
// arrived twice. New rows start leased for this long; a failed attempt sets its own retry time,
// and a crashed one becomes due again once the lease runs out.
const LEASE_MS = 2 * 60_000;
const leaseUntil = () => new Date(Date.now() + LEASE_MS).toISOString();

export async function enqueueAndDeliver(
  env: Env,
  bot: OutboxSender,
  args: { userId: number; chatId: number; kind: string; idempotencyKey: string; text: string; extra?: unknown },
): Promise<DeliveryResult> {
  const db = env.DB;
  if (await notificationsMuted(db, args.userId).catch(() => false)) return "muted";
  const id = await enqueueNotification(db, {
    userId: args.userId,
    chatId: args.chatId,
    kind: args.kind,
    idempotencyKey: args.idempotencyKey,
    payload: { text: args.text, extra: args.extra },
    notBefore: leaseUntil(),
  });
  if (id === null) return "duplicate"; // already enqueued (and already attempted or in flight)
  return attemptDelivery(env, bot, { id, userId: args.userId, chatId: args.chatId, kind: args.kind, attempts: 0, payload: { text: args.text, extra: args.extra } });
}

/** The retry sweep — rows a previous attempt backed off, now due. Runs once per cron tick
 * (runScheduleInner), so backoff granularity is effectively the tick interval (every minute in
 * this Worker's trigger config) even though computeBackoffMs can schedule further out. */
export async function deliverDueNotifications(env: Env, bot: OutboxSender, limit = 50): Promise<{ sent: number; retrying: number; failed: number }> {
  const db = env.DB;
  const now = new Date().toISOString();
  const rows = await dueNotifications(db, now, limit);
  let sent = 0, retrying = 0, failed = 0;
  for (const row of rows) {
    if (!(await claimNotification(db, row.id, now, leaseUntil()))) continue; // another sweep has it
    // Muted since it was queued: a retry must not slip through either.
    if (await notificationsMuted(db, row.userId).catch(() => false)) {
      await markPermanentFailure(db, row.id, "failed", "muted");
      continue;
    }
    const outcome = await attemptDelivery(env, bot, row);
    if (outcome === "sent") sent++;
    else if (outcome === "retrying") retrying++;
    else if (outcome === "blocked" || outcome === "failed") failed++;
  }
  return { sent, retrying, failed };
}
