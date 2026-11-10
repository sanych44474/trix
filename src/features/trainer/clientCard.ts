// The owner's view of a user's plan in the bot (owner tools, ADR-0012): the day picker and one
// day, read-only. The trainer's chat client card that also lived here was retired with the chat.
import { InlineKeyboard } from "grammy";
import type { Weekday } from "../../types";
import { getActivePlan, getDraftPlan } from "../../adapters/d1/v2Plans";
import { getUser } from "../../adapters/d1/v2Users";
import { getPlanDay } from "../../domain/progression";
import { t } from "../../locales/i18n";
import { renderToday, weekdayName } from "../../render";
import { type MyContext, reply, setEditOwner } from "../../adapters/telegram/context";
import { healPlanNamesForDisplay } from "../exercise/catalog";
import { videosForDays } from "../plan/exerciseVideos";
import { editDayKb } from "./trainerCommon";

// Enter "edit this user's plan" mode → show a day picker. Shared by trainer & owner.
export async function showPlanEditPicker(ctx: MyContext, targetId: number, prefix: string, headerName: string) {
  const lang = ctx.user.lang;
  const plan = await getActivePlan(ctx.db, targetId);
  if (!plan || !plan.split.length) {
    // The editor works on the ACTIVE plan only -- but cc_plan (viewing) already falls back to a
    // draft, so a client sitting on an unassigned draft (or an active plan orphaned by a leave/
    // rejoin, see unlinkClient in v2Trainer.ts) could be viewed but never edited. Offer to assign
    // the draft right here instead of a dead-end "no plan" message.
    const draft = await getDraftPlan(ctx.db, targetId);
    if (draft && draft.split.length) {
      const kb = new InlineKeyboard().text(t(lang, "cc_assign"), `${prefix}:${targetId}:assign`);
      await reply(ctx, t(lang, "client_draft_only_trainer", { name: headerName }), kb);
      return;
    }
    await reply(ctx, t(lang, "client_no_plan_trainer"));
    return;
  }
  await setEditOwner(ctx, targetId, prefix === "ou" ? "ou" : "cl");
  const kb = new InlineKeyboard();
  for (const d of [...plan.split].sort((a, b) => a.weekday - b.weekday)) {
    kb.text(`${weekdayName(lang, d.weekday)} — ${d.muscleGroup}`.slice(0, 60), `${prefix}:${targetId}:eday:${d.weekday}`).row();
  }
  kb.text(t(lang, "edit_done"), `${prefix}:${targetId}:editdone`);
  await reply(ctx, t(lang, "edit_pick_day_header", { name: headerName }), kb);
}

// Show one day of a managed user's plan with edit buttons. Shared by trainer & owner.
export async function showPlanEditDay(ctx: MyContext, targetId: number, prefix: string, wd: Weekday) {
  const lang = ctx.user.lang;
  await setEditOwner(ctx, targetId, prefix === "ou" ? "ou" : "cl");
  const target = await getUser(ctx.db, targetId).catch(() => null);
  let plan = await getActivePlan(ctx.db, targetId);
  if (!plan) {
    // Same fallback as showPlanEditPicker: reachable directly via a stale eday button (e.g. from
    // an old chat message) even when the picker itself was never re-opened.
    const draft = await getDraftPlan(ctx.db, targetId);
    if (draft && draft.split.length) {
      const kb = new InlineKeyboard().text(t(lang, "cc_assign"), `${prefix}:${targetId}:assign`);
      await reply(ctx, t(lang, "client_draft_only_trainer", { name: target?.profile.name ?? `id ${targetId}` }), kb);
      return;
    }
    await reply(ctx, t(lang, "client_no_plan_trainer"));
    return;
  }
  // Self-heal English names on view (a pre-localization template/shared assign), in the CLIENT's
  // language, and persist — so the client also sees the corrected plan, not just this editor.
  plan = await healPlanNamesForDisplay(ctx, plan, target?.lang ?? lang);
  const day = getPlanDay(plan, wd);
  if (!day) { await reply(ctx, t(lang, "error_generic")); return; }
  // Editing a plan is NOT logging — suppress the "record workout" CTA and prefix the day with
  // whose plan this is, so a trainer with their own program never confuses it with a client's.
  const header = t(lang, "edit_day_banner", { name: target?.profile.name ?? `id ${targetId}` });
  await reply(
    ctx,
    `${header}\n\n${renderToday(lang, day, weekdayName(lang, wd), undefined, await videosForDays(ctx, [day]), { noCta: true })}`,
    editDayKb(lang, prefix, targetId, wd),
  );
}
