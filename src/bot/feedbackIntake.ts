// Free-text feedback and one-tap quality ratings — both land in the `feedback` table and
// forward to the owner if one is registered. Extracted from bot.ts (god-file split; same
// barrel seam via bot.ts's `export * from "./bot/feedbackIntake"`).
import { InlineKeyboard } from "grammy";
import { getOwnerChatId } from "../adapters/d1/v2Admin";
import { insertFeedback } from "../adapters/d1/v2Feedback";
import { localParts } from "../domain/localTime";
import { escapeHtml, t } from "../locales/i18n";
import { type MyContext, HTML, reply, setMode } from "../adapters/telegram/context";
import { menuBtn } from "../adapters/telegram/keyboards";
import { storeFeedback } from "../features/feedback/storeFeedback";
import { feedbackReplyMarkup } from "../features/feedback/replyFeedback";

export async function recordFeedback(ctx: MyContext, text: string, viaCoach?: { original?: string }) {
  await storeFeedback(
    ctx.env,
    (chatId, html, replyMarkup) => ctx.api.sendMessage(chatId, html, { ...HTML, ...(replyMarkup ? { reply_markup: replyMarkup as InlineKeyboard } : {}) }),
    { userId: ctx.user._id, username: ctx.from?.username, timezone: ctx.user.profile.timezone },
    text,
    viaCoach,
    (p) => ctx.waitUntil(p),
  );
}

export async function handleFeedback(ctx: MyContext, text: string) {
  const lang = ctx.user.lang;
  await recordFeedback(ctx, text);
  await setMode(ctx, "idle");
  await reply(ctx, t(lang, "feedback_saved"), menuBtn(lang));
}

// One-tap quality rating from the recurring nudge (qr:1..5). Stored as a feedback row so it
// shows in the owner report next to written notes; the reply invites a written detail.
export async function onQualityRating(ctx: MyContext, n: number) {
  const lang = ctx.user.lang;
  const stars = Math.max(1, Math.min(5, n));
  const { date } = localParts(ctx.user.profile.timezone);
  const feedbackId = await insertFeedback(ctx.db, {
    userId: ctx.user._id,
    username: ctx.from?.username,
    text: `⭐ ${stars}/5 (rating)`,
    date,
  });
  const ownerChatId = await getOwnerChatId(ctx.db);
  if (ownerChatId) {
    const who = ctx.from?.username ? `@${ctx.from.username}` : `id ${ctx.user._id}`;
    await ctx.api.sendMessage(ownerChatId, `⭐ <b>Rating ${stars}/5</b> from ${escapeHtml(who)}`, { ...HTML, reply_markup: feedbackReplyMarkup(feedbackId) }).catch(() => {});
  }
  await ctx.answerCallbackQuery({ text: t(lang, "quality_rate_ack") }).catch(() => {});
  // A low rating is a clear "something's wrong" signal — ask directly instead of hoping they
  // remember to type /feedback on their own later. 4-5 stars just gets a thank-you.
  if (stars <= 3) {
    await setMode(ctx, "feedback");
    const kb = new InlineKeyboard().text(t(lang, "inact_fb_skip"), "qr:skip");
    await reply(ctx, t(lang, "quality_rate_followup", { stars: "⭐".repeat(stars) }), kb);
  } else {
    await reply(ctx, t(lang, "quality_rate_thanks", { stars: "⭐".repeat(stars) }), menuBtn(lang));
  }
}

export async function onQualityFollowupSkip(ctx: MyContext) {
  await setMode(ctx, "idle");
  await reply(ctx, t(ctx.user.lang, "quality_rate_ack"), menuBtn(ctx.user.lang));
}
