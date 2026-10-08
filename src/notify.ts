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
import { enqueueAndDeliver, type DeliveryResult, type OutboxSender } from "./schedulerOutbox";
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

/** Delivered, or safely queued for retry, or already handled -- the message is not lost. Only
 * "failed" and "blocked" mean it is gone, and only then should a dedup mark be left unwritten. */
export function isDurable(result: DeliveryResult): boolean {
  return result === "sent" || result === "retrying" || result === "duplicate";
}

export function notify(env: Env, sender: OutboxSender, to: Recipient, msg: Message): Promise<DeliveryResult> {
  return enqueueAndDeliver(env, sender, { userId: to.userId, chatId: to.chatId, kind: msg.kind, idempotencyKey: msg.key, text: msg.text, extra: msg.extra });
}
