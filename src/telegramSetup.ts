// The bot's Telegram-side setup -- command list, profile texts, the chat menu button -- applied by
// the Worker itself, once per TELEGRAM_SETUP_VERSION, from the cron right after a deploy. This
// used to be a manual step (scripts/setup-telegram.mjs) that needed the bot token on someone's
// machine; the Worker already has the token, so a change here ships with the deploy.
//
// The webhook is NOT set here: it carries the secret token and drop_pending_updates, and a working
// webhook should never be touched by a routine deploy. scripts/setup-telegram.mjs still does that.
import { getOwnerChatId, getSetting, setSetting } from "./adapters/d1/v2Admin";
import { logError, logInfo } from "./log";
import type { Env } from "./types";

/** Bump when anything below changes; the next cron after the deploy re-applies it. */
export const TELEGRAM_SETUP_VERSION = "2026-10-07-profile";
const SETTING_KEY = "telegram_setup_version";

// The chat is retired (src/bot/launcher.ts): the command list is just /start (the Open-app button).
export const COMMANDS = [{ command: "start", en: "Open trix", uk: "Відкрити trix" }];

// Bot profile texts (also in marketing/botfather.md). description: the empty chat before Start
// (max 512); short: profile page, shares and search (max 120).
export const PROFILE = {
  en: {
    short: "Free AI personal trainer: a workout plan for your days and gear, progression, macros from a photo. 💪",
    description:
      "🏋️ trix is a free AI personal trainer — all in one Telegram app.\n\n" +
      "• A workout plan for your days, equipment and injuries — at home or in the gym\n" +
      "• Log sets in one tap; it decides when to add weight\n" +
      "• Macros from a photo of your plate, form check from a video, voice notes\n" +
      "• Body map: weekly load, recovery and trend per muscle\n" +
      "• Train with AI or pick a coach and chat in the app; squads with friends\n\n" +
      "No subscription, no ads. Tap Start — a 2-minute questionnaire and your plan is ready.",
  },
  uk: {
    short: "Безкоштовний AI-тренер: програма під твої дні й обладнання, прогресія, КБЖУ за фото. 💪",
    description:
      "🏋️ trix — безкоштовний AI-тренер, усе в одному застосунку в Telegram.\n\n" +
      "• Програма під твої дні, обладнання й травми — вдома чи в залі\n" +
      "• Запис підходів в один дотик, сам вирішує, коли додати вагу\n" +
      "• КБЖУ за фото тарілки, перевірка техніки за відео, голосові нотатки\n" +
      "• Карта тіла: навантаження, відновлення і тренд кожного м'яза\n" +
      "• Тренуйся з AI або обери тренера й спілкуйся в застосунку; сквади з друзями\n\n" +
      "Без підписки й реклами. Натисни «Старт» — 2 хвилини анкети, і план готовий.",
  },
} as const;

type Call = { method: string; body: Record<string, unknown> };

/** Every Bot API call the setup makes, in order. Pure, so it is unit-tested. */
export function setupCalls(miniAppUrl: string, ownerChatId?: number): Call[] {
  const list = (lang: "en" | "uk") => COMMANDS.map((c) => ({ command: c.command, description: c[lang] }));
  const calls: Call[] = [
    { method: "setMyCommands", body: { commands: list("en") } },
    { method: "setMyCommands", body: { commands: list("uk"), language_code: "uk" } },
  ];
  // A per-chat command list overrides the default, so an old owner scope with the full command
  // list would keep showing it: reset it to the same minimal list.
  if (ownerChatId) {
    const scope = { type: "chat", chat_id: ownerChatId };
    calls.push({ method: "setMyCommands", body: { commands: list("en"), scope } });
    calls.push({ method: "setMyCommands", body: { commands: list("uk"), language_code: "uk", scope } });
  }
  for (const lang of ["en", "uk"] as const) {
    const p = PROFILE[lang];
    const language_code = lang === "en" ? {} : { language_code: lang };
    calls.push({ method: "setMyDescription", body: { description: p.description, ...language_code } });
    calls.push({ method: "setMyShortDescription", body: { short_description: p.short, ...language_code } });
  }
  calls.push({ method: "setChatMenuButton", body: { menu_button: { type: "web_app", text: "trix", web_app: { url: miniAppUrl } } } });
  return calls;
}

/** Apply the setup once per version. Records the version only when every call succeeded. */
export async function ensureTelegramSetup(env: Env): Promise<void> {
  const workerUrl = String(env.WORKER_URL ?? "");
  if (!env.TELEGRAM_BOT_TOKEN || !workerUrl) return;
  if ((await getSetting(env.DB, SETTING_KEY).catch(() => null)) === TELEGRAM_SETUP_VERSION) return;
  // Claim before calling so the next minute's cron doesn't run it again concurrently; a failure
  // clears the claim below so it retries.
  await setSetting(env.DB, SETTING_KEY, TELEGRAM_SETUP_VERSION);
  const base = workerUrl.replace(/\/$/, "");
  const owner = await getOwnerChatId(env.DB).catch(() => undefined);
  const failed: string[] = [];
  for (const call of setupCalls(`${base}${String(env.V2_APP_ENABLED) === "1" ? "/app-v2" : "/app"}`, owner)) {
    const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${call.method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(call.body),
    }).then((r) => r.json() as Promise<{ ok?: boolean; description?: string }>).catch((e: unknown) => ({ ok: false, description: String(e) }));
    if (!res.ok) failed.push(`${call.method}: ${res.description ?? "?"}`);
  }
  if (failed.length) {
    await setSetting(env.DB, SETTING_KEY, "failed").catch(() => {});
    logError("telegram_setup_failed", new Error(failed.join("; ").slice(0, 300)));
    return;
  }
  logInfo("telegram_setup_applied", { version: TELEGRAM_SETUP_VERSION, ownerScope: !!owner });
}
