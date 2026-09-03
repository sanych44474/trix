// Pure keyboard / menu builders (lang -> InlineKeyboard). Extracted from bot.ts (god-file
// split); behavior unchanged. These depend only on the locale layer + two bot-level constants
// (COMMON_TZ, dashboardUrl) that are referenced lazily inside function bodies, so the value-cycle
// with ../bot is load-safe.
import { InlineKeyboard } from "grammy";
import type { Lang } from "../types";
import { t } from "../locales/i18n";
import { COMMON_TZ, dashboardUrl } from "../bot";

// Common athlete menu — shown to EVERY role (trainers/owner get extra rows appended in cmdMenu).
// Kept deliberately light: daily actions only; everything else lives one tap away in "More"
// (moreMenu) and the progress hub, and the Mini App dashboard carries the stats/logger.
export function mainMenu(lang: Lang): InlineKeyboard {
  const kb = new InlineKeyboard();
  const app = dashboardUrl();
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

// Second-level "More" screen — every entry that used to crowd the top menu, nothing removed.
export function moreMenu(lang: Lang, isSolo: boolean): InlineKeyboard {
  const kb = new InlineKeyboard()
    .text(t(lang, "menu_mealplan"), "menu:mealplan")
    .text(t(lang, "menu_measure"), "menu:measure")
    .row()
    .text(t(lang, "menu_steps"), "menu:steps")
    .text(t(lang, "menu_water"), "menu:water")
    .row()
    .text(t(lang, "menu_calendar"), "menu:cal")
    .text(t(lang, "menu_library"), "menu:library")
    .row()
    .text(t(lang, "set_vacation_btn"), "menu:vacation")
    .text(t(lang, "menu_interview"), "menu:interview")
    .row()
    .text(t(lang, "menu_feedback"), "menu:feedback")
    .text(t(lang, "menu_help"), "menu:help")
    .row()
    .text(t(lang, "menu_invite"), "invite")
    .text(t(lang, "menu_photo_self"), "photo:self")
    .row()
    .text(t(lang, "menu_meso"), "meso:open");
  if (isSolo) {
    kb.row()
      .text(t(lang, "menu_find_trainer"), "role:find")
      .text(t(lang, "menu_become_trainer"), "role:trainer");
  }
  return kb.row().text(t(lang, "menu_open"), "menu:open");
}

// Progress & stats hub — groups the analytics-adjacent screens (progress, report, records,
// challenges, check-in, week card) that used to crowd the top-level menu.
export function progressHubMenu(lang: Lang): InlineKeyboard {
  return new InlineKeyboard()
    .text(t(lang, "menu_progress"), "menu:progress")
    .text(t(lang, "menu_report"), "menu:report")
    .row()
    .text(t(lang, "menu_records"), "menu:records")
    .text(t(lang, "menu_challenges"), "menu:challenges")
    .row()
    .text(t(lang, "menu_checkin"), "menu:checkin")
    .text(t(lang, "wcard_btn"), "share:week")
    .row()
    // Self-serve fix for "logged wrong weight / wrong meal yesterday".
    .text(t(lang, "mylog_btn"), "mylog:open")
    .text(t(lang, "menu_open"), "menu:open");
}

// Trainer top-level hub: keeps the trainer's own training separate from client management.
export function trainerHubMenu(lang: Lang): InlineKeyboard {
  return new InlineKeyboard()
    .text(t(lang, "tr_menu_training"), "trmenu:athlete")
    .text(t(lang, "tr_menu_clients"), "trmenu:clients")
    .row()
    .text(t(lang, "tr_menu_profile"), "trmenu:profile")
    .text(t(lang, "menu_calendar"), "menu:tcal")
    .row()
    .text(t(lang, "tr_menu_finance"), "menu:finance")
    .text(t(lang, "tr_menu_questions"), "menu:questions")
    .row()
    .text(t(lang, "tr_menu_report"), "menu:trreport")
    .text(t(lang, "tr_menu_group"), "tr:group")
    .row()
    .text(t(lang, "menu_whatsnew"), "menu:whatsnew");
}

// Clients sub-menu (reached from the trainer hub): client list + incoming requests.
export function trainerClientsMenu(lang: Lang): InlineKeyboard {
  return new InlineKeyboard()
    .text(t(lang, "menu_clients"), "menu:clients")
    .text(t(lang, "menu_requests"), "menu:requests")
    .row()
    .text(t(lang, "tr_broadcast_btn"), "tr:broadcast")
    .row()
    .text(t(lang, "tr_back_hub"), "menu:open");
}

// One compact entry instead of three top-level buttons — the tools live in the owner hub.
export function appendOwnerRow(kb: InlineKeyboard, lang: Lang): InlineKeyboard {
  return kb.row().text(t(lang, "menu_owner_hub"), "menu:ownerhub");
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

// Plan view for a user: change-video + day management entry points plus the menu.
export function planViewKb(lang: Lang): InlineKeyboard {
  return new InlineKeyboard()
    .text(t(lang, "video_change_btn"), "vid:pick:0")
    .text(t(lang, "pday_manage_btn"), "pday:open")
    .row()
    .text(t(lang, "menu_open"), "menu:open");
}

export function langMenu(): InlineKeyboard {
  return new InlineKeyboard()
    .text("🇺🇦 Українська", "lang:uk")
    .text("🇷🇺 Русский", "lang:ru")
    .text("🇬🇧 English", "lang:en");
}

export function roleMenu(lang: Lang): InlineKeyboard {
  return new InlineKeyboard()
    .text(t(lang, "role_ai"), "role:ai")
    .row()
    .text(t(lang, "role_find"), "role:find")
    .row()
    .text(t(lang, "role_trainer"), "role:trainer");
}

export function settingsMenu(lang: Lang, optedIn: boolean, sex?: "male" | "female", isClient?: boolean): InlineKeyboard {
  const kb = new InlineKeyboard()
    .text(t(lang, "edit_hour"), "set:hour")
    .text(t(lang, "edit_days"), "set:days")
    .row()
    .text(t(lang, "edit_tz"), "set:tz")
    .text(t(lang, "edit_lang"), "set:lang")
    .row()
    .text(t(lang, optedIn ? "edit_compete_on" : "edit_compete_off"), "set:compete")
    .text(t(lang, "edit_alias"), "set:alias")
    .row()
    .text(t(lang, "edit_body"), "set:body")
    .text(t(lang, "edit_goalweight"), "set:goalweight")
    .row()
    .text(t(lang, "edit_replan"), "set:replan")
    .text(t(lang, "set_reminders_btn"), "set:reminders")
    .row()
    .text(t(lang, "inj_report_btn"), "set:injury")
    .text(t(lang, "set_vacation_btn"), "set:vacation");
  // Cycle tracking is an opt-in surfaced only to female profiles — avoids adding a dead button
  // for male users and keeps the topic sensitive.
  if (sex === "female") kb.row().text(t(lang, "set_cycle_btn"), "set:cycle");
  // Sharing consent only makes sense for users linked to a trainer.
  if (isClient) kb.row().text(t(lang, "set_share_btn"), "set:share");
  return kb;
}

export function hourMenu(): InlineKeyboard {
  const kb = new InlineKeyboard();
  const hours = [6, 7, 8, 9, 10, 12, 14, 16, 17, 18, 19, 20, 21, 22];
  hours.forEach((h, i) => {
    kb.text(`${h}:00`, `hour:${h}`);
    if ((i + 1) % 4 === 0) kb.row();
  });
  return kb;
}

export function tzMenu(): InlineKeyboard {
  const kb = new InlineKeyboard();
  COMMON_TZ.forEach((z, i) => {
    kb.text(z, `tz:${z}`);
    if ((i + 1) % 2 === 0) kb.row();
  });
  return kb;
}

export function aliasMenu(lang: Lang): InlineKeyboard {
  return new InlineKeyboard()
    .text(t(lang, "alias_use_name"), "alias:name")
    .text(t(lang, "alias_anon"), "alias:anon")
    .row()
    .text(t(lang, "alias_custom"), "alias:custom");
}

// Inline keyboard shown under a bank-selected plan: regenerate via Gemini, or open the menu.
export function planActionsKb(lang: Lang): InlineKeyboard {
  return new InlineKeyboard().text(t(lang, "plan_regen_ai"), "plan:ai").row().text(t(lang, "menu_open"), "menu:open");
}

// 1-5 inline scale; callback data e.g. "checkin:energy:4".
export function checkinScale(step: "energy" | "sleep" | "stress"): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (let i = 1; i <= 5; i++) kb.text(String(i), `checkin:${step}:${i}`);
  return kb;
}

// Inline keyboard under a template meal plan: regenerate via Gemini, or open the menu.
export function mealActionsKb(lang: Lang): InlineKeyboard {
  return new InlineKeyboard().text(t(lang, "meal_regen_ai"), "meal:ai").row().text(t(lang, "menu_open"), "menu:open");
}
