// Free-text feedback and one-tap quality ratings — both land in the `feedback` table and
// forward to the owner if one is registered. Extracted from bot.ts (god-file split; same
// barrel seam via bot.ts's `export * from "./bot/feedbackIntake"`).
import { InlineKeyboard } from "grammy";
import { getOwnerChatId, insertFeedback } from "../adapters/d1/v2Admin";
import { localParts } from "../domain/progression";
import { escapeHtml, t } from "../locales/i18n";
import { type MyContext, HTML, reply, setMode } from "../adapters/telegram/context";
import { menuBtn } from "../bot";

/** Store a feedback row and forward it to the owner, if one is registered. `viaCoach` carries the
 *  user's own message when the AI coach summarised it (bot/coach.ts "feedback" action), so the
 *  owner reads both the summary and the words it came from. */
export async function recordFeedback(ctx: MyContext, text: string, viaCoach?: { original?: string }) {
  const { date } = localParts(ctx.user.profile.timezone);
  const username = ctx.from?.username;
  const original = viaCoach?.original?.trim();
  const stored = viaCoach ? `[AI coach] ${text}${original && original !== text ? `\n— "${original}"` : ""}` : text;
  await insertFeedback(ctx.db, { userId: ctx.user._id, username, text: stored, date });
  const ownerChatId = await getOwnerChatId(ctx.db);
  if (!ownerChatId) return;
  const who = username ? `@${username}` : `id ${ctx.user._id}`;
  const body = viaCoach
    ? `🤖 <b>Feedback via AI coach</b> from ${escapeHtml(who)}:\n${escapeHtml(text)}${original && original !== text ? `\n\n<i>Their message:</i> ${escapeHtml(original)}` : ""}`
    : `✍️ <b>Feedback</b> from ${escapeHtml(who)}:\n${escapeHtml(text)}`;
  await ctx.api.sendMessage(ownerChatId, body, HTML).catch(() => {});
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
