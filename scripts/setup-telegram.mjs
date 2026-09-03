// Registers the Telegram webhook (with secret token) and the command menu.
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
const COMMANDS = [
  { command: "start", en: "Set up / restart your coaching", uk: "Налаштувати / перезапустити" },
  { command: "menu", en: "Open the menu", uk: "Відкрити меню" },
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
  allowed_updates: ["message", "callback_query"],
  drop_pending_updates: true,
});
// Default menu (English) for everyone, plus a Ukrainian override (uk clients get uk).
await post("setMyCommands", { commands: toList(COMMANDS, "en") });
await post("setMyCommands", { commands: toList(COMMANDS, "uk"), language_code: "uk" });

// Persistent chat menu button → the Mini App dashboard (text is global, not per-language).
await post("setChatMenuButton", {
  menu_button: { type: "web_app", text: "📊 Dashboard", web_app: { url: `${base}/app` } },
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
