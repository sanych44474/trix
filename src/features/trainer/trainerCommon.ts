// Pieces every trainer screen shares: the role guard and the client-card keyboards.
import { InlineKeyboard } from "grammy";
import type { Lang } from "../../types";
import { t } from "../../locales/i18n";
import { MyContext, reply } from "../../adapters/telegram/context";
import { trainerHubMenu } from "../../bot/keyboards";

export function clientCardKb(lang: Lang, id: number): InlineKeyboard {
  return new InlineKeyboard()
    .text(t(lang, "cc_plan"), `cl:${id}:plan`)
    .text(t(lang, "cc_schedule"), `cl:${id}:sched`)
    .row()
    .text(t(lang, "cc_progress"), `cl:${id}:prog`)
    .text(t(lang, "cc_body"), `cl:${id}:body`)
    .row()
    .text(t(lang, "cc_draft"), `cl:${id}:draft`)
    .text(t(lang, "cc_assign"), `cl:${id}:assign`)
    .row()
    .text(t(lang, "cc_edit"), `cl:${id}:edit`)
    .text(t(lang, "cc_message"), `cl:${id}:msg`)
    .row()
    .text(t(lang, "cc_thread"), `cl:${id}:thread`)
    .row()
    .text(t(lang, "cc_note"), `cl:${id}:note`)
    .text(t(lang, "cc_flag"), `cl:${id}:flag`)
    .row()
    .text(t(lang, "cc_templates"), `cl:${id}:tpl`)
    .text(t(lang, "cc_logs"), `cl:${id}:logs`)
    .row()
    .text(t(lang, "cc_photo"), `cl:${id}:photo`)
    .text(t(lang, "cc_week"), `cl:${id}:week`)
    .row()
    .text(t(lang, "cc_health"), `cl:${id}:health`)
    .text(t(lang, "cc_personal"), `cl:${id}:pers`)
    .text(t(lang, "cc_interview"), `cl:${id}:intv`);
}

// Trainer/owner edit keyboard for one day of a managed user's plan (no log buttons).
// `prefix` is the card namespace: "cl" (trainer→client) or "ou" (owner→any user).
export function editDayKb(lang: Lang, prefix: string, id: number, weekday: number): InlineKeyboard {
  return new InlineKeyboard()
    .text(t(lang, "swap_btn"), `swap:${weekday}`)
    .text(t(lang, "workout_add_btn"), `workout:add:${weekday}`)
    .row()
    .text(t(lang, "workout_delete_btn"), `workout:delete:${weekday}`)
    .text(t(lang, "reorder_btn"), `ord:open:${weekday}`)
    .row()
    .text(t(lang, "plan_diff_edit_weight"), `wt:open:${weekday}`)
    .text(t(lang, "plan_diff_edit_sets"), `st:open:${weekday}`)
    .row()
    .text(t(lang, "warmup_edit_btn"), `wu:open:${weekday}`)
    .text(t(lang, "video_btn"), `vid:pick:${weekday}`)
    .row()
    .text(t(lang, "edit_pick_day"), `${prefix}:${id}:edit`)
    .text(t(lang, "edit_done"), `${prefix}:${id}:editdone`);
}

export async function requireTrainer(ctx: MyContext): Promise<boolean> {
  if (ctx.user.role !== "trainer") {
    await reply(ctx, t(ctx.user.lang, "not_a_trainer"));
    return false;
  }
  return true;
}

// Trainer menu = the compact trainer hub (own training / clients / profile).
export function trainerMenu(lang: Lang): InlineKeyboard {
  return trainerHubMenu(lang);
}
