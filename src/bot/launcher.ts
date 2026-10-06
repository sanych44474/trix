// The chat is retired: everything happens in the Mini App. In a private chat the bot answers any
// message, command or button with one "Open trix" button, deep-linked to the screen the old
// command or button belonged to. It still processes what cannot live in the app: payments, the
// owner's tools, and /start deep links that pair a user with a trainer or a buddy.
//
// Group chats (squads) are untouched here. Without a Mini App URL (local dev) nothing is gated
// and the old chat flows run.
import { InlineKeyboard } from "grammy";
import { t } from "../locales/i18n";
import { dashboardUrl } from "./appLinks";
import { isOwner } from "./ownerAccess";
import { updateUser } from "../adapters/d1/v2Users";
import { HTML, reply, type MyContext } from "../adapters/telegram/context";
import type { AppView } from "../notify/appKeyboard";

export type { AppView };

/** Mini App link, optionally opening a given screen. */
export function appUrl(view?: AppView): string | undefined {
  const base = dashboardUrl();
  if (!base) return undefined;
  return view ? `${base}&view=${view}` : base;
}

// Old callback_data prefixes and commands → the screen that now does the same job.
const CALLBACK_VIEWS: Array<[string, AppView]> = [
  ["menu:settings", "settings"], ["set:", "settings"], ["share:", "settings"], ["lang:", "settings"],
  ["menu:today", "today"], ["today", "today"], ["nba:", "today"],
  ["gl:", "train"], ["log", "train"], ["wk:", "train"], ["warm", "train"], ["rest", "train"],
  ["plan", "plan"], ["pd:", "plan"], ["pe:", "plan"], ["day", "plan"], ["meso", "plan"], ["swap", "plan"],
  ["food", "fuel"], ["nut", "fuel"], ["meal", "fuel"], ["mp:", "fuel"], ["gro", "fuel"], ["water", "fuel"], ["steps", "fuel"],
  ["prog", "progress"], ["rec", "progress"], ["measure", "progress"], ["chk", "progress"], ["checkin", "progress"], ["report", "progress"], ["cal", "progress"],
  ["coach", "coach"], ["ask", "coach"],
  ["tr:", "role"], ["tw", "role"], ["cl:", "role"], ["cc:", "role"], ["req:", "role"], ["owner", "role"],
  ["chal", "more"], ["board", "more"], ["squad", "more"], ["lib", "library"],
];

const COMMAND_VIEWS: Record<string, AppView> = {
  today: "today", menu: "today", log: "train", plan: "plan", schedule: "plan", replan: "plan",
  nutrition: "fuel", mealplan: "fuel", grocery: "fuel", water: "fuel", steps: "fuel",
  progress: "progress", records: "progress", measure: "progress", checkin: "progress", report: "progress", calendar: "progress",
  coach: "coach", feedback: "coach", settings: "settings", lang: "settings", export: "settings", deleteme: "settings",
  clients: "role", requests: "role", trainer: "role", becometrainer: "more", leavetrainer: "settings",
  challenges: "more", plates: "more", whatsnew: "more", support: "more", paysupport: "more",
};

export function viewForCallback(data: string): AppView | undefined {
  return CALLBACK_VIEWS.find(([prefix]) => data.startsWith(prefix))?.[1];
}

export function viewForCommand(cmd: string): AppView | undefined {
  return COMMAND_VIEWS[cmd.toLowerCase()];
}

/** Answer with the Open-app button. New athletes get the welcome; the rest a short pointer. */
export async function sendLauncher(ctx: MyContext, view?: AppView): Promise<boolean> {
  const u = ctx.user;
  const athlete = u.role === "solo" || u.role === "client";
  const target: AppView | undefined = athlete && !u.onboarded ? "onboarding" : view;
  const url = appUrl(target);
  if (!url) return false;
  const lang = u.lang;
  // The old reply keyboard stays on screen until a message removes it; do that once.
  if (!u.profile.chatRetired) {
    await ctx.reply(t(lang, "launch_chat_retired"), { ...HTML, reply_markup: { remove_keyboard: true } }).catch(() => {});
    u.profile = { ...u.profile, chatRetired: true };
    await updateUser(ctx.db, u._id, { profile: u.profile }).catch(() => {});
  }
  const fresh = athlete && !u.onboarded;
  const text = fresh ? `${t(lang, "ob_app_welcome")}\n\n${t(lang, "disclaimer")}` : t(lang, "launch_text");
  const kb = new InlineKeyboard().webApp(t(lang, fresh ? "ob_app_start_btn" : "launch_open_btn"), url);
  await reply(ctx, text, kb);
  return true;
}

const START_PAYLOADS = ["tr_", "trp_", "ref_", "buddy_"];

/**
 * True when the update was answered with the Open-app button and must go no further.
 * Lets through: payments, the owner, and /start deep links that pair with a trainer or buddy.
 */
export async function launcherGate(ctx: MyContext): Promise<boolean> {
  if (!ctx.user || (ctx.chat?.type ?? "private") !== "private") return false;
  if (!appUrl()) return false;
  if (ctx.preCheckoutQuery || ctx.message?.successful_payment) return false;
  if (await isOwner(ctx).catch(() => false)) return false;
  const data = ctx.callbackQuery?.data;
  if (data !== undefined) {
    await ctx.answerCallbackQuery().catch(() => {});
    return sendLauncher(ctx, viewForCallback(data));
  }
  const text = ctx.message?.text ?? "";
  const cmd = text.match(/^\/([A-Za-z_]+)(?:@\w+)?(?:\s+(\S+))?/);
  if (cmd?.[1].toLowerCase() === "start") {
    const payload = cmd[2] ?? "";
    if (START_PAYLOADS.some((p) => payload.startsWith(p))) return false; // pairing runs, then points to the app
    return sendLauncher(ctx, payload.startsWith("prog_") ? "library" : undefined);
  }
  return sendLauncher(ctx, cmd ? viewForCommand(cmd[1]) : undefined);
}
