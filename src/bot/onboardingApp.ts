// Onboarding lives in the Mini App. The bot only hands out a button that opens it, and until an
// athlete finishes it, every other message or tap gets that same button back instead of a menu:
// the plan depends on the answers, so nothing else is useful before them.
//
// Without a Mini App URL (local dev, a fork without WORKER_URL) everything here reports "not
// handled" and the bot falls back to the chat wizard in onboarding.ts.
import { InlineKeyboard } from "grammy";
import type { Env, Lang } from "../types";
import { t } from "../locales/i18n";
import { APP_VERSION } from "../webapp/appVersion";
import { dashboardUrl } from "./appLinks";
import { HTML, reply, type MyContext, type TKey } from "../adapters/telegram/context";

/** Mini App onboarding link inside a bot update (the app URL is captured in createBot). */
export function onboardingUrl(): string | undefined {
  const base = dashboardUrl();
  return base ? `${base}&view=onboarding` : undefined;
}

/** Same link for ctx-free senders (scheduler, webapp handlers), built from env. */
export function onboardingUrlFromEnv(env: Pick<Env, "WORKER_URL" | "V2_APP_ENABLED">): string | undefined {
  if (!env.WORKER_URL) return undefined;
  const path = env.V2_APP_ENABLED === "1" ? "/app-v2" : "/app";
  return `${env.WORKER_URL}${path}?v=${APP_VERSION}&view=onboarding`;
}

export function onboardingAppKb(lang: Lang, url: string): InlineKeyboard {
  return new InlineKeyboard().webApp(t(lang, "ob_app_btn"), url);
}

/** reply_markup for a raw Bot API sendMessage (no grammY context available). */
export function onboardingAppMarkup(lang: Lang, url: string) {
  return { inline_keyboard: [[{ text: t(lang, "ob_app_btn"), web_app: { url } }]] };
}

/** Send the "fill in the questionnaire" message with the app button. False when there is no app. */
export async function sendOnboardingPrompt(ctx: MyContext, key: TKey = "ob_app_prompt", prefix = ""): Promise<boolean> {
  const url = onboardingUrl();
  if (!url) return false;
  await reply(ctx, prefix + t(ctx.user.lang, key), onboardingAppKb(ctx.user.lang, url));
  return true;
}

/** First contact for a brand-new user: what trix is, then one choice per row. */
export async function sendWelcomeEntry(ctx: MyContext, prefix = ""): Promise<boolean> {
  const url = onboardingUrl();
  if (!url) return false;
  const lang = ctx.user.lang;
  const kb = new InlineKeyboard()
    .webApp(t(lang, "ob_app_start_btn"), url)
    .row()
    .text(t(lang, "role_find"), "role:find")
    .row()
    .text(t(lang, "role_trainer"), "role:trainer");
  await reply(ctx, `${prefix}${t(lang, "ob_app_welcome")}\n\n${t(lang, "disclaimer")}`, kb);
  return true;
}

/** Push the app button into another user's chat (e.g. a trainer just accepted them). */
export async function sendOnboardingPromptTo(ctx: MyContext, chatId: number, lang: Lang, prefix: string): Promise<boolean> {
  const url = onboardingUrl();
  if (!url) return false;
  await ctx.api
    .sendMessage(chatId, `${prefix}\n\n${t(lang, "ob_app_prompt")}`, { ...HTML, reply_markup: onboardingAppKb(lang, url) })
    .catch(() => {});
  return true;
}

// What a not-yet-onboarded athlete may still do in the chat.
const ALLOWED_CALLBACKS = ["lang:", "role:", "find:", "req:"];
const ALLOWED_COMMANDS = new Set(["start", "support", "paysupport", "deleteme"]);
// client_code / trainer_setup: typing a trainer's code or setting up as a trainer.
// plan_pending: the questionnaire is done and the plan is being built.
const ALLOWED_MODES = new Set(["client_code", "trainer_setup", "plan_pending"]);

/**
 * True when the update was answered with the questionnaire button and must not go further.
 * Applies to solo athletes and trainers' clients who have not finished onboarding.
 */
export async function onboardingGate(ctx: MyContext): Promise<boolean> {
  const u = ctx.user;
  if (!u || u.onboarded || (u.role !== "solo" && u.role !== "client")) return false;
  if ((ctx.chat?.type ?? "private") !== "private") return false;
  if (ALLOWED_MODES.has(u.session.mode)) return false;
  if (!onboardingUrl()) return false;
  const data = ctx.callbackQuery?.data;
  if (data !== undefined) {
    if (ALLOWED_CALLBACKS.some((p) => data.startsWith(p))) return false;
    await ctx.answerCallbackQuery().catch(() => {});
  } else {
    const msg = ctx.message;
    if (!msg || msg.successful_payment) return false;
    const cmd = msg.text?.match(/^\/([A-Za-z_]+)/)?.[1]?.toLowerCase();
    if (cmd && ALLOWED_COMMANDS.has(cmd)) return false;
  }
  return sendOnboardingPrompt(ctx, "ob_app_reminder");
}
