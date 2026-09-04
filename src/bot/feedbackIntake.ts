// Free-text feedback and one-tap quality ratings — both land in the `feedback` table and
// forward to the owner if one is registered. Extracted from bot.ts (god-file split; same
// barrel seam via bot.ts's `export * from "./bot/feedbackIntake"`).
import { getOwnerChatId, insertFeedback } from "../db/repos";
import { localParts } from "../domain/progression";
import { escapeHtml, t } from "../locales/i18n";
import { type MyContext, HTML, menuBtn, reply, setMode } from "../bot";

export async function handleFeedback(ctx: MyContext, text: string) {
  const lang = ctx.user.lang;
  const { date } = localParts(ctx.user.profile.timezone);
  const username = ctx.from?.username;
  await insertFeedback(ctx.db, { userId: ctx.user._id, username, text, date });
  // Forward to the owner if one is registered.
  const ownerChatId = await getOwnerChatId(ctx.db);
  if (ownerChatId) {
    const who = username ? `@${username}` : `id ${ctx.user._id}`;
    await ctx.api
      .sendMessage(ownerChatId, `✍️ <b>Feedback</b> from ${escapeHtml(who)}:\n${escapeHtml(text)}`, HTML)
      .catch(() => {});
  }
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
  await reply(ctx, t(lang, "quality_rate_thanks", { stars: "⭐".repeat(stars) }), menuBtn(lang));
}
