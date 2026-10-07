// Registers the Telegram webhook (with secret token), the command menu and the bot's profile
// description (the text a new user sees before tapping Start).
//
// Only the WEBHOOK needs this script now: the Worker applies the command menu, profile texts and
// menu button itself after each deploy (src/telegramSetup.ts, versioned). Keep the texts below in
// sync with that file if you still run this for a fresh bot.
// Usage: node scripts/setup-telegram.mjs https://trix.<subdomain>.workers.dev [ownerChatId]
// Reads TELEGRAM_BOT_TOKEN / TELEGRAM_WEBHOOK_SECRET / OWNER_CHAT_ID from env or .dev.vars.
// If an owner chat id is provided, the owner-only commands (/users, /ownerreport, /admin)
// are added to the command menu of THAT chat only, via a per-chat command scope.
import { readFileSync } from "node:fs";

function fromDevVars(key) {
  try {
    const txt = readFileSync(new URL("../.dev.vars", import.meta.url), "utf8");
    const m = txt.match(new RegExp(`^${key}="?([^"\\n]+)"?`, "m"));
    return m?.[1];
  } catch {
    return undefined;
  }
}

const token = process.env.TELEGRAM_BOT_TOKEN || fromDevVars("TELEGRAM_BOT_TOKEN");
const secret =
  process.env.TELEGRAM_WEBHOOK_SECRET || fromDevVars("TELEGRAM_WEBHOOK_SECRET");
const base = process.argv[2] || process.env.WORKER_URL;
const ownerChatId = process.argv[3] || process.env.OWNER_CHAT_ID || fromDevVars("OWNER_CHAT_ID");

if (!token || !secret || !base) {
  console.error("Need TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET and a worker URL arg.");
  process.exit(1);
}

const api = (m) => `https://api.telegram.org/bot${token}/${m}`;
const webhookUrl = `${base.replace(/\/$/, "")}/webhook`;

// Slash menu = ONE gateway button. Everything lives behind /menu (the role-based inline
// keyboard); every other command still works when typed, just isn't listed here. Bilingual.
// The chat is retired (src/bot/launcher.ts): everything happens in the Mini App, so the command
// list is just /start, which answers with the Open-app button.
const COMMANDS = [
  { command: "start", en: "Open trix", uk: "Відкрити trix" },
];

// Alphabetical by command, with /start pinned first by convention.
const byCmd = (a, b) =>
  a.command === "start" ? -1 : b.command === "start" ? 1 : a.command.localeCompare(b.command);
const toList = (arr, lang) =>
  [...arr].sort(byCmd).map((c) => ({ command: c.command, description: c[lang] }));

async function post(method, body) {
  const res = await fetch(api(method), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  console.log(method, "->", JSON.stringify(data));
  if (!data.ok) process.exitCode = 1;
}

await post("setWebhook", {
  url: webhookUrl,
  secret_token: secret,
  // pre_checkout_query: Telegram Stars support payments (src/bot/support.ts) must be confirmed.
  allowed_updates: ["message", "callback_query", "pre_checkout_query"],
  drop_pending_updates: true,
});
// Default menu (English) for everyone, plus a Ukrainian override (uk clients get uk).
await post("setMyCommands", { commands: toList(COMMANDS, "en") });
await post("setMyCommands", { commands: toList(COMMANDS, "uk"), language_code: "uk" });

// Bot profile texts (also in marketing/botfather.md): the description is what a new user sees
// in the empty chat before tapping Start (max 512 chars), the short description shows on the
// profile page and in shares/search (max 120). English default plus a Ukrainian override.
const PROFILE = {
  en: {
    short: "Free AI personal trainer: a workout plan for your days and gear, progression, macros from a photo. 💪",
    description:
      "🏋️ trix is a free AI personal trainer in Telegram.\n\n" +
      "• A workout plan for your days, equipment and injuries — at home or in the gym\n" +
      "• Log sets in one tap; it decides when to add weight\n" +
      "• Body map: weekly load, recovery and 12-week trend per muscle\n" +
      "• Technique pictures and a form check from a video\n" +
      "• Macros from a photo of your plate\n\n" +
      "No subscription, no ads. Tap Start — a 2-minute interview and your plan is ready.",
  },
  uk: {
    short: "Безкоштовний AI-тренер: програма під твої дні й обладнання, прогресія, КБЖУ за фото. 💪",
    description:
      "🏋️ trix — безкоштовний AI-тренер у Telegram.\n\n" +
      "• Програма під твої дні, обладнання й травми — вдома чи в залі\n" +
      "• Запис підходів в один дотик, сам вирішує, коли додати вагу\n" +
      "• Карта тіла: навантаження, відновлення і тренд кожного м'яза\n" +
      "• Фото техніки й перевірка техніки за відео\n" +
      "• КБЖУ за фото тарілки\n\n" +
      "Без підписки й реклами. Натисни «Старт» — 2 хвилини інтерв'ю, і план готовий.",
  },
};
for (const [lang, p] of Object.entries(PROFILE)) {
  if (p.description.length > 512 || p.short.length > 120) throw new Error(`profile text too long (${lang})`);
  const language_code = lang === "en" ? undefined : lang;
  await post("setMyDescription", { description: p.description, ...(language_code ? { language_code } : {}) });
  await post("setMyShortDescription", { short_description: p.short, ...(language_code ? { language_code } : {}) });
}

// Persistent chat menu button → the Mini App dashboard (text is global, not per-language).
// Path follows V2_APP_ENABLED (matches src/bot.ts's setAppUrl) so this stays in sync with
// whichever Mini App bundle the bot itself is currently pointing users at -- override with
// MINI_APP_PATH if you need to force one explicitly (e.g. testing the legacy bundle).
const miniAppPath =
  process.env.MINI_APP_PATH || (process.env.V2_APP_ENABLED === "1" ? "/app-v2" : "/app");
await post("setChatMenuButton", {
  menu_button: { type: "web_app", text: "trix", web_app: { url: `${base}${miniAppPath}` } },
});

// Owner chat scope: a per-chat command list OVERRIDES the default, so an old run that
// scoped the full list to the owner's chat would keep showing it. Re-apply the minimal
// list (both languages) to overwrite that stale scope. Owner actions live in the /menu
// inline keyboard (Users / Owner report rows).
if (ownerChatId) {
  const scope = { type: "chat", chat_id: Number(ownerChatId) };
  await post("setMyCommands", { commands: toList(COMMANDS, "en"), scope });
  await post("setMyCommands", { commands: toList(COMMANDS, "uk"), language_code: "uk", scope });
  console.log(`Owner chat ${ownerChatId} command scope reset to the minimal list.`);
} else {
  console.log("No OWNER_CHAT_ID — pass it (2nd arg / OWNER_CHAT_ID) to reset a stale owner chat scope.");
}

await post("getWebhookInfo", {});
