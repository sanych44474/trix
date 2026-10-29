// Storing a piece of user feedback (the inbox the owner triages), shared by the bot's feedback
// flow and the Mini App coach's "send as feedback" action. Moved from bot/feedbackIntake.ts.
import { getOwnerChatId } from "../../adapters/d1/v2Admin";
import { feedbackReplyMarkup } from "./replyFeedback";
import { insertFeedback } from "../../adapters/d1/v2Feedback";
import { localParts } from "../../domain/localTime";
import { escapeHtml } from "../../locales/i18n";
import type { Env } from "../../types";
import { triageFeedbackCategory } from "./triageFeedback";

/** Store a feedback row and forward it to the owner, if one is registered. `viaCoach` carries the
 *  user's own message when the AI coach summarised it (the coach "feedback" action, in the bot
 *  and in the Mini App), so the owner reads both the summary and the words it came from. The Clef
 *  second opinion runs through `defer` (ctx.waitUntil) when the caller has one, else is awaited. */
export async function storeFeedback(
  env: Env,
  notify: (chatId: number, html: string, replyMarkup?: unknown) => Promise<unknown>,
  who: { userId: number; username?: string; timezone?: string },
  text: string,
  viaCoach?: { original?: string },
  defer?: (p: Promise<unknown>) => void,
): Promise<void> {
  const db = env.DB;
  const { date } = localParts(who.timezone);
  const original = viaCoach?.original?.trim();
  const stored = viaCoach ? `[AI coach] ${text}${original && original !== text ? `\n— "${original}"` : ""}` : text;
  const id = await insertFeedback(db, { userId: who.userId, username: who.username, text: stored, date });
  const triage = id ? triageFeedbackCategory(env, id, stored) : null;
  const ownerChatId = await getOwnerChatId(db);
  if (ownerChatId) {
    const tag = who.username ? `@${who.username}` : `id ${who.userId}`;
    const body = viaCoach
      ? `🤖 <b>Feedback via AI coach</b> from ${escapeHtml(tag)}:\n${escapeHtml(text)}${original && original !== text ? `\n\n<i>Their message:</i> ${escapeHtml(original)}` : ""}`
      : `✍️ <b>Feedback</b> from ${escapeHtml(tag)}:\n${escapeHtml(text)}`;
    await notify(ownerChatId, body, feedbackReplyMarkup(id)).catch(() => {});
  }
  if (triage) {
    if (defer) defer(triage);
    else await triage;
  }
}
