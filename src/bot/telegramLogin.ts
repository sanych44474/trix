// Signing in to the standalone app with Telegram. The app opens t.me/<bot>?start=login_<id>; the
// bot then ASKS, showing the same match code the app shows, and only a tap on Confirm signs the app
// in. Opening the link alone must never do it: someone could send that link to a victim, who taps
// Start, and the sender's app would be signed in to the victim's account.
import { InlineKeyboard } from "grammy";
import { t } from "../locales/i18n";
import { HTML, reply, type MyContext } from "../adapters/telegram/context";
import { confirmTelegramLogin, pendingTelegramLogin, rejectTelegramLogin } from "../adapters/d1/v2TelegramLogin";

export async function promptTelegramLogin(ctx: MyContext, challengeId: string): Promise<void> {
  const lang = ctx.user.lang;
  const pending = await pendingTelegramLogin(ctx.db, challengeId).catch(() => null);
  if (!pending) {
    await reply(ctx, t(lang, "tglogin_expired")).catch(() => {});
    return;
  }
  const kb = new InlineKeyboard()
    .text(t(lang, "tglogin_confirm_btn"), `tglogin:ok:${challengeId}`)
    .row()
    .text(t(lang, "tglogin_deny_btn"), `tglogin:no:${challengeId}`);
  await reply(ctx, t(lang, "tglogin_prompt", { code: pending.matchCode }), kb);
}

export async function answerTelegramLogin(ctx: MyContext, challengeId: string, approve: boolean): Promise<void> {
  const lang = ctx.user.lang;
  const done = approve
    ? await confirmTelegramLogin(ctx.db, challengeId, ctx.user._id).catch(() => false)
    : await rejectTelegramLogin(ctx.db, challengeId).catch(() => false);
  const text = !done ? t(lang, "tglogin_expired") : approve ? t(lang, "tglogin_confirmed") : t(lang, "tglogin_denied");
  // Replace the prompt so its buttons can't be tapped again.
  await ctx.editMessageText(text, HTML).catch(() => reply(ctx, text).catch(() => {}));
}
