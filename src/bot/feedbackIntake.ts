// Free-text feedback and one-tap quality ratings — both land in the `feedback` table and
// forward to the owner if one is registered. Extracted from bot.ts (god-file split; same
// barrel seam via bot.ts's `export * from "./bot/feedbackIntake"`).
import { InlineKeyboard } from "grammy";
import { getOwnerChatId } from "../adapters/d1/v2Admin";
import { insertFeedback } from "../adapters/d1/v2Feedback";
import { localParts } from "../domain/localTime";
import { escapeHtml, t } from "../locales/i18n";
import { type MyContext, HTML, reply, setMode } from "../adapters/telegram/context";
import { menuBtn } from "./keyboards";

/** Store a feedback row and forward it to the owner, if one is registered. `viaCoach` carries the
 *  user's own message when the AI coach summarised it (the coach "feedback" action, in the bot
 *  and in the Mini App), so the owner reads both the summary and the words it came from. */
export async function storeFeedback(
  db: D1Database,
  notify: (chatId: number, html: string) => Promise<unknown>,
  who: { userId: number; username?: string; timezone?: string },
  text: string,
  viaCoach?: { original?: string },
): Promise<void> {
  const { date } = localParts(who.timezone);
  const original = viaCoach?.original?.trim();
  const stored = viaCoach ? `[AI coach] ${text}${original && original !== text ? `\n— "${original}"` : ""}` : text;
  await insertFeedback(db, { userId: who.userId, username: who.username, text: stored, date });
  const ownerChatId = await getOwnerChatId(db);
  if (!ownerChatId) return;
  const tag = who.username ? `@${who.username}` : `id ${who.userId}`;
  const body = viaCoach
    ? `🤖 <b>Feedback via AI coach</b> from ${escapeHtml(tag)}:\n${escapeHtml(text)}${original && original !== text ? `\n\n<i>Their message:</i> ${escapeHtml(original)}` : ""}`
    : `✍️ <b>Feedback</b> from ${escapeHtml(tag)}:\n${escapeHtml(text)}`;
  await notify(ownerChatId, body).catch(() => {});
}

export async function recordFeedback(ctx: MyContext, text: string, viaCoach?: { original?: string }) {
  await storeFeedback(
    ctx.db,
    (chatId, html) => ctx.api.sendMessage(chatId, html, HTML),
    { userId: ctx.user._id, username: ctx.from?.username, timezone: ctx.user.profile.timezone },
    text,
    viaCoach,
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
  await insertFeedback(ctx.db, {
    userId: ctx.user._id,
    username: ctx.from?.username,
    text: `⭐ ${stars}/5 (rating)`,
    date,
  });
  const ownerChatId = await getOwnerChatId(ctx.db);
  if (ownerChatId) {
    const who = ctx.from?.username ? `@${ctx.from.username}` : `id ${ctx.user._id}`;
    await ctx.api.sendMessage(ownerChatId, `⭐ <b>Rating ${stars}/5</b> from ${escapeHtml(who)}`, HTML).catch(() => {});
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
