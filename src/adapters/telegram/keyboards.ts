// Pure keyboard / menu builders (lang -> InlineKeyboard). Extracted from bot.ts (god-file
// split); behavior unchanged. These depend only on the locale layer + two bot-level constants
// (COMMON_TZ) referenced lazily inside function bodies, so the value-cycle with ../bot is load-safe.
// The Mini App URL comes in as an argument: infrastructure does not import the application layer.
import { InlineKeyboard } from "grammy";
import type { Lang } from "../../types";
import { t } from "../../locales/i18n";

// Common athlete menu — shown to EVERY role (trainers/owner get extra rows appended in cmdMenu).
// Kept deliberately light: daily actions only; everything else lives one tap away in "More"
// (moreMenu) and the progress hub, and the Mini App dashboard carries the stats/logger.
export function mainMenu(lang: Lang, app?: string): InlineKeyboard {
  const kb = new InlineKeyboard();
  if (app) kb.webApp(t(lang, "menu_dashboard"), app).row();
  return kb
    .text(t(lang, "menu_today"), "menu:today")
    .text(t(lang, "menu_plan"), "menu:plan")
    .row()
    .text(t(lang, "menu_log"), "menu:log")
    .text(t(lang, "menu_nutrition"), "menu:nutrition")
    .row()
    .text(t(lang, "menu_coach"), "menu:coach")
    .text(t(lang, "menu_proghub"), "menu:proghub")
    .row()
    .text(t(lang, "menu_settings"), "menu:settings")
    .text(t(lang, "menu_more"), "menu:more")
    .row()
    .text(t(lang, "menu_whatsnew"), "menu:whatsnew");
}

// Trainer top-level hub: keeps the trainer's own training separate from client management.
export function trainerHubMenu(lang: Lang): InlineKeyboard {
  return new InlineKeyboard()
    .text(t(lang, "tr_menu_training"), "trmenu:athlete")
    .text(t(lang, "tr_menu_clients"), "trmenu:clients")
    .row()
    .text(t(lang, "tr_menu_profile"), "trmenu:profile")
    .text(t(lang, "tr_menu_questions"), "menu:questions")
    .row()
    .text(t(lang, "tr_menu_report"), "menu:trreport")
    .row()
    .text(t(lang, "menu_whatsnew"), "menu:whatsnew");
}

export function ownerHubMenu(lang: Lang): InlineKeyboard {
  return new InlineKeyboard()
    .text(t(lang, "menu_users"), "menu:users")
    .text(t(lang, "menu_ownerreport"), "menu:ownerreport")
    .row()
    .text(t(lang, "menu_whatsnew"), "menu:whatsnew")
    .row()
    .text(t(lang, "menu_open"), "menu:open");
}

// A single compact button attached to replies — expands to the full menu on tap,
// so the 11-button block doesn't clutter every message.
export function menuBtn(lang: Lang): InlineKeyboard {
  return new InlineKeyboard().text(t(lang, "menu_open"), "menu:open");
}
