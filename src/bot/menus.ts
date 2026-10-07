// Menus: the main menu, the athlete / trainer / progress / more hubs, hiding the reply keyboard,
// and /help.
import { InlineKeyboard } from "grammy";
import type { Lang } from "../types";
import { getTrainer } from "../adapters/d1/v2Trainer";
import { t } from "../locales/i18n";
import { cmdReport } from "./report";
import { isOwner } from "./ownerAccess";
import { mainMenu, moreMenu, progressHubMenu, trainerHubMenu, trainerClientsMenu, appendOwnerRow, menuBtn } from "./keyboards";
import { cmdLog } from "./guidedLog";
import { HTML, clearEditOwner, reply, type MyContext } from "../adapters/telegram/context";
import { cmdProgress } from "./progressCmds";
import { cmdNutrition, cmdSteps } from "./nutritionCmds";
import { cmdSettings, cmdMeasure } from "./settingsCmds";
import { cmdCoach, cmdFeedback } from "./commonCmds";
import { cmdPlan, cmdToday } from "./planView";

export async function showMoreMenu(ctx: MyContext) {
  await reply(ctx, t(ctx.user.lang, "more_title"), moreMenu(ctx.user.lang, ctx.user.role === "solo"));
}

export async function showProgressHub(ctx: MyContext) {
  await reply(ctx, t(ctx.user.lang, "proghub_title"), progressHubMenu(ctx.user.lang));
}

// ================= Solo self-correct: user rewrites a past workout / nutrition day =================
// Mirrors the trainer's clog* flow but scoped to ctx.user._id so a solo athlete who logged the
// wrong weight (or wrong meal) yesterday doesn't have to wait for a coach. Both surfaces list the
// same 30-day window; picking a day shows a summary + a "Rewrite" button that re-parses the whole
// day in one message.

// Moved to bot/logSelfEdit.ts (god-file split); re-exported below so existing from "./bot"
// imports (router.ts) keep working.

// startMealMacroEdit/handleMealMacroEdit moved to bot/logSelfEdit.ts (they end by calling
// showMyLogNutritionDay, defined there) — re-exported via the barrel below.

// cmdTrainerReport/cmdTrainerBroadcast/handleTrainerBroadcast moved to features/trainer/trainer.ts;
// showOwnerHub moved to bot/owner.ts; difficultyKeyboard/todayWorkoutKeyboard/difficultyLabel
// moved to bot/keyboards.ts — each belongs to that file's existing concept, not this one.
// Re-exported via the barrel below.

// Persistent bottom button menu (reply keyboard) — always visible after onboarding.
// Map a tapped reply-keyboard label (in the user's language) to its command.
// Kept so a lingering legacy bottom keyboard (pre-update users) still routes correctly
// until ReplyKeyboardRemove clears it on their next plain reply.
export function menuActionFor(lang: Lang, text: string): ((c: MyContext) => Promise<void>) | undefined {
  const map: Record<string, (c: MyContext) => Promise<void>> = {
    [t(lang, "menu_today")]: cmdToday,
    [t(lang, "menu_plan")]: cmdPlan,
    [t(lang, "menu_log")]: cmdLog,
    [t(lang, "menu_progress")]: cmdProgress,
    [t(lang, "menu_nutrition")]: cmdNutrition,
    [t(lang, "menu_measure")]: cmdMeasure,
    [t(lang, "menu_steps")]: cmdSteps,
    [t(lang, "menu_report")]: cmdReport,
    [t(lang, "menu_coach")]: cmdCoach,
    [t(lang, "menu_feedback")]: cmdFeedback,
    [t(lang, "menu_help")]: cmdHelp,
    [t(lang, "menu_settings")]: cmdSettings,
    [t(lang, "menu_hide")]: cmdHideKeyboard,
  };
  return map[text];
}

// Open the menu — a single inline keyboard composed as common base + role extras.
// Everyone gets the full athlete menu; trainers/owner get extra rows appended (a user can
// be both a trainer AND the owner, so the rows are additive, not exclusive).
export async function cmdMenu(ctx: MyContext) {
  await clearEditOwner(ctx);
  const lang = ctx.user.lang;
  const owner = await isOwner(ctx);
  // Trainers get a compact hub (own training vs clients vs profile); everyone else the full
  // athlete menu. The owner row is additive in both cases.
  if (ctx.user.role === "trainer") {
    const kb = trainerHubMenu(lang);
    // Instructors (owner-granted) + owner get the "share a program" entry.
    const tr = await getTrainer(ctx.db, ctx.user._id).catch(() => null);
    if (owner || tr?.isInstructor) kb.row().text(t(lang, "menu_share_program"), "menu:share");
    if (owner) appendOwnerRow(kb, lang);
    await ctx.reply(t(lang, "trainer_hub_title"), { ...HTML, reply_markup: kb });
    return;
  }
  const kb = mainMenu(lang);
  // Find-a-trainer / become-a-trainer moved into the "More" screen (moreMenu) to keep the
  // top level light; the owner entry stays here as a single hub button.
  if (owner) appendOwnerRow(kb, lang);
  await ctx.reply(t(lang, "menu_title"), { ...HTML, reply_markup: kb });
}

// Trainer hub → "My training": the trainer's OWN athlete side (separate entity from their coach
// profile). If they never did the athlete interview, offer to start it; otherwise the full menu.
export async function showAthleteMenu(ctx: MyContext) {
  const lang = ctx.user.lang;
  if (!ctx.user.onboarded) {
    const kb = new InlineKeyboard()
      .text(t(lang, "tr_start_athlete"), "role:ai")
      .row()
      .text(t(lang, "tr_back_hub"), "menu:open");
    await ctx.reply(t(lang, "tr_athlete_intro"), { ...HTML, reply_markup: kb });
    return;
  }
  const kb = mainMenu(lang).row().text(t(lang, "tr_back_hub"), "menu:open");
  await ctx.reply(t(lang, "menu_title"), { ...HTML, reply_markup: kb });
}

// Trainer hub → "Clients": client list + incoming requests.
export async function showTrainerClientsMenu(ctx: MyContext) {
  const lang = ctx.user.lang;
  await ctx.reply(t(lang, "tr_clients_title"), { ...HTML, reply_markup: trainerClientsMenu(lang) });
}

// Hide the button menu (remove the reply keyboard).
export async function cmdHideKeyboard(ctx: MyContext) {
  await ctx.reply(t(ctx.user.lang, "kbd_hidden"), { ...HTML, reply_markup: { remove_keyboard: true } });
}

export async function cmdHelp(ctx: MyContext) {
  const lang = ctx.user.lang;
  const body =
    ctx.user.role === "trainer"
      ? t(lang, "help_body_trainer")
      : ctx.user.role === "client"
        ? t(lang, "help_body_client")
        : t(lang, "help_body");
  await reply(ctx, `${t(lang, "help_title")}\n\n${t(lang, "help_modes")}\n\n${body}`, menuBtn(lang));
}
