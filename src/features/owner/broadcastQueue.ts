// Owner broadcasts (release notes, announcements) through Cloudflare Queues. Without a queue one
// request can reach only ~25 chats (the Worker's subrequest budget), so the owner had to tap
// "send" again and again. Here one tap enqueues a message per recipient and the queue consumer
// delivers them in small batches, each in its own invocation: no budget to run out of, Telegram's
// rate limit is respected (one batch at a time, 429s retried after the delay Telegram asks for),
// and messages that keep failing land in the dead-letter queue instead of vanishing.
//
// Delivery is at-least-once. Release notes stay exactly-once per user because each delivery
// records reminders.releaseSent and the consumer skips users who already have it. An
// announcement has no per-user record; a duplicate needs a send that succeeded but whose ack was
// lost, which is rare enough not to be worth a table.
//
// When the BROADCAST_QUEUE binding is missing (tests, a local run without queues) callers fall
// back to the old batched sends.
import { GrammyError } from "grammy";
import { telegramCall } from "../../adapters/telegram/rawApi";
import { getUser, listOnboardedUsers, updateUser } from "../../adapters/d1/v2Users";
import { recordAudit } from "../../adapters/d1/v2Admin";
import { latestRelease, releaseBody } from "../../releaseNotes";
import { hasAnsweredPoll } from "../../adapters/d1/v2PricePoll";
import { pricePollKb, pricePollText } from "./pricePoll";
import { releaseRecipients } from "../../domain/releaseDelivery";
import { appMarkup } from "../../notify/appKeyboard";
import { escapeHtml, t } from "../../locales/i18n";
import type { Env } from "../../types";

export type BroadcastMessage =
  | { kind: "release"; userId: number; version: string }
  | { kind: "announce"; userId: number; text: string }
  | { kind: "poll"; userId: number };

/** Queue.sendBatch accepts at most 100 messages per call. */
const SEND_BATCH = 100;
/** Retry delay for a failure Telegram gave no retry_after for. */
const RETRY_DELAY_SEC = 30;

export function broadcastQueue(env: Env): Queue<BroadcastMessage> | null {
  return (env.BROADCAST_QUEUE as Queue<BroadcastMessage> | undefined) ?? null;
}

async function enqueue(queue: Queue<BroadcastMessage>, messages: BroadcastMessage[]): Promise<void> {
  for (let i = 0; i < messages.length; i += SEND_BATCH) {
    await queue.sendBatch(messages.slice(i, i + SEND_BATCH).map((body) => ({ body })));
  }
}

/** Queue the latest release note for everyone still owed it. Returns how many were queued. */
export async function queueReleaseBroadcast(env: Env, queue: Queue<BroadcastMessage>, ownerId: number): Promise<{ version: string; queued: number }> {
  const note = latestRelease();
  const due = releaseRecipients(await listOnboardedUsers(env.DB), note.version);
  await enqueue(queue, due.map((u) => ({ kind: "release", userId: u._id, version: note.version })));
  await recordAudit(env.DB, ownerId, "release_notes", undefined, `${note.version} queued ${due.length}`).catch(() => {});
  return { version: note.version, queued: due.length };
}

/** Queue an announcement for every onboarded user who can be reached. Returns how many were queued. */
export async function queueAnnouncement(env: Env, queue: Queue<BroadcastMessage>, ownerId: number, text: string): Promise<{ queued: number }> {
  const recipients = (await listOnboardedUsers(env.DB)).filter((u) => !u.blocked && !u.botBlocked);
  await enqueue(queue, recipients.map((u) => ({ kind: "announce", userId: u._id, text })));
  await recordAudit(env.DB, ownerId, "broadcast", undefined, `queued ${recipients.length}: ${text.slice(0, 80)}`).catch(() => {});
  return { queued: recipients.length };
}

type Outcome = { ack: true } | { ack: false; delaySeconds: number; rateLimited?: boolean };

async function deliver(env: Env, msg: BroadcastMessage): Promise<Outcome> {
  const user = await getUser(env.DB, msg.userId);
  // Gone, banned or unreachable since it was queued: nothing to send.
  if (!user || user.blocked || user.botBlocked) return { ack: true };
  if (msg.kind === "release" && user.reminders?.releaseSent === msg.version) return { ack: true };
  // The poll is sent once per person: a re-send (or a redelivery) skips whoever already answered.
  if (msg.kind === "poll" && (await hasAnsweredPoll(env.DB, user._id))) return { ack: true };
  const markup = msg.kind === "poll" ? pricePollKb(user.lang) : appMarkup(env, t(user.lang, "launch_open_btn"), "today");
  const text = msg.kind === "release" ? releaseBody(user.lang, latestRelease()) : msg.kind === "poll" ? pricePollText(user.lang) : `📢 ${escapeHtml(msg.text)}`;
  try {
    await telegramCall(env, "sendMessage", { chat_id: user.chatId, text, parse_mode: "HTML", ...(markup ? { reply_markup: markup } : {}) });
  } catch (err) {
    if (err instanceof GrammyError && err.error_code === 403) {
      await updateUser(env.DB, user._id, { botBlocked: true }).catch(() => {});
      return { ack: true };
    }
    const retryAfter = err instanceof GrammyError ? err.parameters?.retry_after : undefined;
    return { ack: false, delaySeconds: retryAfter ?? RETRY_DELAY_SEC, rateLimited: retryAfter !== undefined };
  }
  if (msg.kind === "release") {
    await updateUser(env.DB, user._id, { reminders: { ...user.reminders, releaseSent: msg.version } }).catch(() => {});
  }
  return { ack: true };
}

/** The queue consumer. Messages are acked one by one, so a failure retries only itself. Once
 *  Telegram rate-limits us, the rest of the batch waits out the same delay instead of being sent. */
export async function handleBroadcastBatch(batch: MessageBatch<BroadcastMessage>, env: Env): Promise<void> {
  let pauseFor = 0;
  for (const message of batch.messages) {
    if (pauseFor) {
      message.retry({ delaySeconds: pauseFor });
      continue;
    }
    let outcome: Outcome;
    try {
      outcome = await deliver(env, message.body);
    } catch {
      outcome = { ack: false, delaySeconds: RETRY_DELAY_SEC };
    }
    if (outcome.ack) {
      message.ack();
      continue;
    }
    message.retry({ delaySeconds: outcome.delaySeconds });
    if (outcome.rateLimited) pauseFor = outcome.delaySeconds;
  }
}
