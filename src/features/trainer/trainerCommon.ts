// Pieces every trainer screen shares: the role guard and the client-card keyboards.
import { InlineKeyboard } from "grammy";
import type { Lang } from "../../types";
import { t } from "../../locales/i18n";
import { trainerHubMenu } from "../../adapters/telegram/keyboards";

// Trainer/owner edit keyboard for one day of a managed user's plan (no log buttons).
// `prefix` is the card namespace: "cl" (trainer→client) or "ou" (owner→any user).
export function editDayKb(lang: Lang, prefix: string, id: number, _weekday: number): InlineKeyboard {
  // Navigation only. The day's edit buttons (swap, add, delete, reorder, weight, sets, warm-up,
  // video) were chat flows retired with ADR-0012 and routed nowhere since; plans are edited in the app.
  return new InlineKeyboard()
    .text(t(lang, "edit_pick_day"), `${prefix}:${id}:edit`)
    .text(t(lang, "edit_done"), `${prefix}:${id}:editdone`);
}

// Trainer menu = the compact trainer hub (own training / clients / profile).
export function trainerMenu(lang: Lang): InlineKeyboard {
  return trainerHubMenu(lang);
}

export function shortCode(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 8);
}

