// The owner answers a piece of feedback -- from the bot (the Reply button under the forwarded
// feedback) or from the owner console in either app. One path for both, so the author always gets
// it the same way: through the notification outbox (Telegram, or a push for app-only accounts) and
// in their in-app inbox.
import { saveFeedbackReply } from "../../adapters/d1/v2Feedback";
import { recordInbox } from "../../adapters/d1/v2Inbox";
import { getUser } from "../../adapters/d1/v2Users";
import { HTML } from "../../adapters/telegram/context";
import { escapeHtml, t } from "../../locales/i18n";
import { isDurable, notify, type OutboxSender } from "../../notify";
import type { Env } from "../../types";

export const MAX_FEEDBACK_REPLY = 1500;

/** The button under every feedback forwarded to the owner. */
export function feedbackReplyMarkup(feedbackId: number | null): { inline_keyboard: { text: string; callback_data: string }[][] } | undefined {
  return feedbackId ? { inline_keyboard: [[{ text: "↩️ Reply", callback_data: `fbr:${feedbackId}` }]] } : undefined;
}

export type ReplyResult = "sent" | "queued" | "not_delivered" | "not_found";

export async function replyToFeedback(env: Env, sender: OutboxSender, feedbackId: number, rawReply: string): Promise<ReplyResult> {
  const reply = rawReply.trim().slice(0, MAX_FEEDBACK_REPLY);
  if (!reply) return "not_found";
  const saved = await saveFeedbackReply(env.DB, feedbackId, reply);
  if (!saved) return "not_found";
  const author = await getUser(env.DB, saved.userId).catch(() => null);
  if (!author || author.blocked) return "not_delivered";
  const preview = saved.text.replace(/^\[AI coach\]\s*/, "").split("\n")[0]!.slice(0, 140);
  await recordInbox(env.DB, author._id, "feedback_reply", { preview, reply: reply.slice(0, 500) }).catch(() => {});
  const result = await notify(env, sender, { userId: author._id, chatId: author.chatId }, {
    kind: "feedback_reply",
    key: `feedback_reply:${feedbackId}:${saved.repliedAt}`,
    text: t(author.lang, "feedback_reply_user", { text: escapeHtml(preview), reply: escapeHtml(reply) }),
    extra: HTML,
  });
  if (result === "sent") return "sent";
  return isDurable(result) ? "queued" : "not_delivered";
}
