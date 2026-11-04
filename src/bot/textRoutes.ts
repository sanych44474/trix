// Free-text routing in the private chat. The chat is retired (ADR-0012): launcherGate lets a
// non-owner's typed text through only while they answer one of the bot's own asks, and the owner's
// text only matters for the owner tools below. Anything else from the owner opens the owner hub.
import { handleAnnounce, showOwnerHub } from "./owner";
import { handlePollPrice, handlePollWish } from "./pricePoll";
import { handleFeedbackReply } from "./feedbackReply";
import { handleVideoUrl } from "./ownerVideos";
import { handleInactiveFeedback } from "./cleanup";
import type { MyContext } from "../adapters/telegram/context";
import type { SessionMode } from "../types";

type TextHandler = (ctx: MyContext, text: string) => Promise<unknown>;

export const MODE_TEXT_HANDLERS: Partial<Record<SessionMode, TextHandler>> = {
  // Answers to the bot's own asks (launcher.ts CHAT_ANSWERED_MODES).
  inact_feedback: (ctx, text) => handleInactiveFeedback(ctx, text),
  poll_price: (ctx, text) => handlePollPrice(ctx, text),
  poll_wish: (ctx, text) => handlePollWish(ctx, text),
  // Owner tools.
  announce: (ctx, text) => handleAnnounce(ctx, text),
  video_url: (ctx, text) => handleVideoUrl(ctx, text),
  feedback_reply: (ctx, text) => handleFeedbackReply(ctx, text),
};

export async function routeUserText(ctx: MyContext, text: string) {
  const handler = MODE_TEXT_HANDLERS[ctx.user.session.mode];
  if (handler) { await handler(ctx, text); return; }
  await showOwnerHub(ctx);
}
