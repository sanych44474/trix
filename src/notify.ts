// The one door for a message that goes to ANOTHER person or runs in the background.
//
// Sending a Telegram message looked like one thing and was three: ~35 `api.sendMessage` calls,
// ~20 hand-written `fetch`es, and six callers of the notification outbox. The outbox
// (schedulerOutbox.ts) is the only path that retries a rate limit, records a block and refuses to
// send the same thing twice, yet most sends that matter bypassed it -- a reminder whose send
// failed was recorded as sent, a duel result vanished on a Telegram hiccup.
//
// Which door:
//  - notify()        a message to someone else, or from the scheduler: the trainer's "your client
//                    trained", a reminder, a duel result, a chat ping. Persisted, retried with
//                    backoff, deduplicated by `key`, and a block flags the user. Use this unless
//                    the next line applies.
//  - a direct send   timeliness beats durability (the "rest is over" push: a retry minutes later is
//                    worse than a drop), or the recipient IS the owner and this is the alert
//                    channel that monitors the outbox itself. Replies to the person who just acted
//                    (ctx.reply) are not notifications at all.
//
// Two adapters sit behind it, which is what makes the seam real: grammY's `bot.api` (webhook and
// cron) and rawTelegramApi (Mini App requests, no Bot instance).
import type { Transformer } from "grammy";
import { enqueueAndDeliver, type DeliveryResult, type OutboxSender } from "./schedulerOutbox";
import { chatMuted } from "./adapters/d1/v2Notifications";
import { sendBestEffort } from "./adapters/telegram/rawApi";
import type { Env } from "./types";

export type { DeliveryResult, OutboxSender };

/** Who gets it. `userId` is the account the outbox row and a block flag belong to. */
export interface Recipient {
  userId: number;
  chatId: number;
}

export interface Message {
  /** What it is, for the outbox row and the owner's delivery stats: "trainer_workout_done". */
  kind: string;
  /** Idempotency key: the same key is delivered at most once. Make it name the event, not the
   * attempt -- `${date}:${clientId}`, not a timestamp. */
  key: string;
  text: string;
  /** Telegram sendMessage options: parse_mode, reply_markup, ... */
  extra?: unknown;
}

/** Delivered, or safely queued for retry, or already handled (or muted by the recipient). Only
 * "failed" and "blocked" mean it is gone, and only then should a dedup mark be left unwritten. */
export function isDurable(result: DeliveryResult): boolean {
  return result === "sent" || result === "retrying" || result === "duplicate" || result === "muted";
}

export function notify(env: Env, sender: OutboxSender, to: Recipient, msg: Message): Promise<DeliveryResult> {
  return enqueueAndDeliver(env, sender, { userId: to.userId, chatId: to.chatId, kind: msg.kind, idempotencyKey: msg.key, text: msg.text, extra: msg.extra });
}

/** notify() for a side message of a handler that must not fail because of it: a queueing error is
 * logged and reported as "failed" instead of unwinding the handler's own reply. */
export function notifySafely(env: Env, sender: OutboxSender, to: Recipient, msg: Message): Promise<DeliveryResult> {
  return notify(env, sender, to, msg).catch((err: unknown) => {
    console.error("notify", msg.kind, err);
    return "failed" as const;
  });
}

// "All notifications off" (profile.remindersOff holds "all") means nothing from the bot reaches
// that person unless they asked for it just now. notify() enforces it in the outbox; the two
// helpers below cover the sends that still go straight to Telegram: the Mini App's best-effort
// pings to someone else, and bot handlers messaging a person other than the one who acted.

/** A best-effort message to ANOTHER person (a trainer's client, a client's trainer, the owner's
 * nudge): skipped, as "not sent", when they muted everything. */
export async function pingOther(env: Pick<Env, "DB" | "TELEGRAM_BOT_TOKEN">, chatId: number, text: string, replyMarkup?: unknown): Promise<boolean> {
  if (await chatMuted(env.DB, chatId).catch(() => false)) return false;
  return sendBestEffort(env, chatId, text, replyMarkup);
}

const OUTGOING = new Set(["sendMessage", "sendPhoto", "sendDocument", "sendVideo", "sendAnimation", "sendVoice", "sendMediaGroup", "copyMessage", "forwardMessage"]);

/** grammY transformer for one update: a message to a private chat other than the acting user's is
 * dropped when that person muted everything. The handler gets a stand-in result, as if sent --
 * the same as the outbox's "muted", the event is handled and must not be retried. */
export function skipMutedRecipients(db: D1Database, selfChatId: number): Transformer {
  return async (prev, method, payload, signal) => {
    const chatId = (payload as { chat_id?: unknown }).chat_id;
    if (OUTGOING.has(method) && typeof chatId === "number" && chatId > 0 && chatId !== selfChatId && (await chatMuted(db, chatId).catch(() => false))) {
      return { ok: true, result: { message_id: 0, date: 0, chat: { id: chatId, type: "private" } } } as never;
    }
    return prev(method, payload, signal);
  };
}
