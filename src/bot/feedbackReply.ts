// The owner's Reply button under forwarded feedback: ask for the text, then hand it to
// replyToFeedback (features/feedback/replyFeedback.ts), the same path the owner console uses.
import { updateUser } from "../adapters/d1/v2Users";
import { type MyContext, reply, setMode } from "../adapters/telegram/context";
import { menuBtn } from "../adapters/telegram/keyboards";
import { switchMode } from "../domain/session";
import { replyToFeedback } from "../features/feedback/replyFeedback";
import { isOwner } from "../features/owner/ownerAccess";
import { t } from "../locales/i18n";

export async function onFeedbackReplyButton(ctx: MyContext, rest: string) {
  const id = Number(rest);
  if (!Number.isInteger(id) || id <= 0 || !(await isOwner(ctx))) return;
  const session = switchMode(ctx.user.session, "feedback_reply", { targetId: id });
  await updateUser(ctx.db, ctx.user._id, { session });
  ctx.user.session = session;
  await reply(ctx, t(ctx.user.lang, "fb_reply_prompt"));
}

export async function handleFeedbackReply(ctx: MyContext, text: string) {
  const lang = ctx.user.lang;
  const id = ctx.user.session.targetId;
  await setMode(ctx, "idle");
  if (!id || !(await isOwner(ctx))) return;
  const result = await replyToFeedback(ctx.env, { api: ctx.api }, id, text);
  const key = result === "sent" ? "fb_reply_sent" : result === "queued" ? "fb_reply_queued" : "fb_reply_gone";
  await reply(ctx, t(lang, key), menuBtn(lang));
}
