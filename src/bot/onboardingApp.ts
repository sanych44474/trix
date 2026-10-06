// Onboarding lives in the Mini App. These helpers hand out the button that opens the
// questionnaire: from the bot (pairing with a trainer, /interview) and from ctx-free senders
// (reminders, trainer and owner nudges). The chat itself is retired, see launcher.ts.
//
// Without a Mini App URL (local dev, a fork without WORKER_URL) they report "not handled" and the
// bot falls back to the chat wizard in onboarding.ts.
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

/** Push the app button into another user's chat (e.g. a trainer just accepted them). */
export async function sendOnboardingPromptTo(ctx: MyContext, chatId: number, lang: Lang, prefix: string): Promise<boolean> {
  const url = onboardingUrl();
  if (!url) return false;
  await ctx.api
    .sendMessage(chatId, `${prefix}\n\n${t(lang, "ob_app_prompt")}`, { ...HTML, reply_markup: onboardingAppKb(lang, url) })
    .catch(() => {});
  return true;
}
