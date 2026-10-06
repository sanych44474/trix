// Buttons for notifications. The chat is retired, so a reminder's buttons open the Mini App at the
// screen that does the job (web_app buttons), not chat callbacks. Without a Mini App URL (local
// dev, tests) a button falls back to its old callback so the chat flow still works there.
import { InlineKeyboard } from "grammy";
import type { InlineKeyboardButton } from "grammy/types";
import { appViewUrlFromEnv } from "../bot/appLinks";

/** Screens the Mini App opens from ?view= (apps/mini-app/src/App.tsx viewFromLocation). */
export type AppView =
  | "today" | "train" | "plan" | "fuel" | "progress" | "more" | "settings" | "library" | "inbox" | "coach" | "role" | "onboarding";

/** Extra deep-link parameters the Mini App understands. */
export interface AppParams {
  /** Trainer workspace: open this client's card. */
  client?: number;
  /** Coach screen: a question pre-filled in the box (the user still taps send). */
  ask?: string;
}

type AppEnv = { WORKER_URL?: string; V2_APP_ENABLED?: string };

/** True when notification buttons can open the Mini App (WORKER_URL set). */
export function appKeyboardEnabled(env: AppEnv): boolean {
  return !!env.WORKER_URL;
}

export function appLink(env: AppEnv, view: AppView, params?: AppParams): string | undefined {
  const base = appViewUrlFromEnv(env, view);
  if (!base) return undefined;
  const q = new URLSearchParams();
  if (params?.client) q.set("client", String(params.client));
  if (params?.ask) q.set("ask", params.ask.slice(0, 300));
  const extra = q.toString();
  return extra ? `${base}&${extra}` : base;
}

export interface AppButton {
  text: string;
  view: AppView;
  params?: AppParams;
  /** callback_data used only when there is no Mini App URL. */
  fallback?: string;
}

/**
 * One row per inner array. Web-app buttons when the Mini App is configured; otherwise each button's
 * fallback callback (buttons without one are dropped). Undefined when nothing is left to show.
 */
export function appKeyboard(env: AppEnv, rows: AppButton[][]): InlineKeyboard | undefined {
  const built = rows
    .map((row) => row.flatMap((b): InlineKeyboardButton[] => {
      const url = appLink(env, b.view, b.params);
      if (url) return [InlineKeyboard.webApp(b.text, url)];
      return b.fallback ? [InlineKeyboard.text(b.text, b.fallback)] : [];
    }))
    .filter((row) => row.length > 0);
  return built.length ? InlineKeyboard.from(built) : undefined;
}

/** A single app button as raw reply_markup (for senders that call the Bot API with fetch). */
export function appMarkup(env: AppEnv, text: string, view: AppView, params?: AppParams) {
  const url = appLink(env, view, params);
  return url ? { inline_keyboard: [[{ text, web_app: { url } }]] } : undefined;
}
