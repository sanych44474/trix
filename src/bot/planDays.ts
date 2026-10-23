// Plan-day management: add/delete whole training days. Shared by self-edits and trainer/owner
// edits (planOwnerId / isEditingOther context, same as the exercise-level editors in bot.ts). A
// new day is auto-filled from the exercise catalog by muscle group so it's immediately usable;
// exercises are then tweaked with the existing day editor. Extracted from bot.ts (god-file
// split; same barrel seam via bot.ts's `export * from "./bot/planDays"`).
//
// Note: the exercise-level plan-time swap (swapMenu/showSwapAlternatives/swapFromCatalog),
// on-the-fly non-mutating log swap, gym-swap, weight/sets direct-edit, difficulty-adjust and
// reorder all live in the same region of bot.ts as this used to and share several of its
// helpers (getActivePlanOrReply, planOwnerId, isEditingOther, translatePlanExercises, and more).
// They resist the same one-concept-per-file split without either moving those shared helpers
// too or creating a web of tiny mutually-dependent files — left as their own, larger, future
// pass rather than forced into boundaries the code doesn't actually have.
import { InlineKeyboard } from "grammy";
import type { Weekday } from "../types";
import { t } from "../locales/i18n";
import { weekdayName } from "../render";
import { DAY_GROUPS } from "../domain/dayGroups";
import { runPlanEdit } from "./planEditRun";
import { type MyContext, getActivePlanOrReply, isEditingOther, planOwnerId, reply } from "../adapters/telegram/context";


export async function showDayManager(ctx: MyContext) {
  const lang = ctx.user.lang;
  const plan = await getActivePlanOrReply(ctx);
  if (!plan) return;
  const kb = new InlineKeyboard();
  const other = isEditingOther(ctx);
  const prefix = ctx.user.session.editPlanPrefix ?? "cl";
  const ownerId = planOwnerId(ctx);
  for (const d of [...plan.split].sort((a, b) => a.weekday - b.weekday)) {
    const label = `${weekdayName(lang, d.weekday)} — ${d.muscleGroup} (${d.exercises.length})`.slice(0, 56);
    kb.text(label, other ? `${prefix}:${ownerId}:eday:${d.weekday}` : `eds:done:${d.weekday}`)
      .text("🗑", `pday:del:${d.weekday}`)
      .row();
  }
  if (plan.split.length < 7) kb.text(t(lang, "pday_add_btn"), "pday:add").row();
  kb.text(t(lang, "back"), other ? `${prefix}:${ownerId}:edit` : "menu:plan");
  await reply(ctx, t(lang, "pday_title"), kb);
}

export async function showAddDayPicker(ctx: MyContext) {
  const lang = ctx.user.lang;
  const plan = await getActivePlanOrReply(ctx);
  if (!plan) return;
  const taken = new Set(plan.split.map((d) => d.weekday));
  const free = ([1, 2, 3, 4, 5, 6, 7] as Weekday[]).filter((w) => !taken.has(w));
  if (!free.length) {
    await reply(ctx, t(lang, "pday_full"));
    await showDayManager(ctx);
    return;
  }
  const kb = new InlineKeyboard();
  free.forEach((w, i) => {
    kb.text(weekdayName(lang, w), `pday:wd:${w}`);
    if (i % 4 === 3) kb.row();
  });
  kb.row().text(t(lang, "back"), "pday:open");
  await reply(ctx, t(lang, "pday_pick_weekday"), kb);
}

export async function showDayGroupPicker(ctx: MyContext, weekday: Weekday) {
  const lang = ctx.user.lang;
  const kb = new InlineKeyboard();
  DAY_GROUPS.forEach((g, i) => {
    kb.text(t(lang, `pday_g_${g.id}` as Parameters<typeof t>[1]), `pday:new:${weekday}:${g.id}`);
    if (i % 2 === 1) kb.row();
  });
  kb.row().text(t(lang, "back"), "pday:add");
  await reply(ctx, t(lang, "pday_pick_group"), kb);
}

export async function createPlanDay(ctx: MyContext, weekday: Weekday, groupId: string) {
  const lang = ctx.user.lang;
  const plan = await getActivePlanOrReply(ctx);
  if (!plan) return;
  const group = DAY_GROUPS.find((g) => g.id === groupId);
  if (!group || plan.split.some((d) => d.weekday === weekday)) {
    await showDayManager(ctx);
    return;
  }
  const out = await runPlanEdit(ctx, planOwnerId(ctx), { kind: "dayadd", weekday, group: groupId });
  if (!out.ok) {
    await reply(ctx, t(lang, "error_generic"));
    await showDayManager(ctx);
    return;
  }
  const added = out.split.find((d) => d.weekday === weekday);
  await reply(ctx, t(lang, "pday_added", { day: weekdayName(lang, weekday), group: added?.muscleGroup ?? "", n: added?.exercises.length ?? 0 }));
  await showDayManager(ctx);
}

export async function confirmDeleteDay(ctx: MyContext, weekday: Weekday) {
  const lang = ctx.user.lang;
  const plan = await getActivePlanOrReply(ctx);
  if (!plan) return;
  const day = plan.split.find((d) => d.weekday === weekday);
  if (!day) {
    await showDayManager(ctx);
    return;
  }
  if (plan.split.length <= 1) {
    await reply(ctx, t(lang, "pday_last"));
    await showDayManager(ctx);
    return;
  }
  const kb = new InlineKeyboard()
    .text(t(lang, "pday_del_yes"), `pday:delok:${weekday}`)
    .text(t(lang, "back"), "pday:open");
  await reply(ctx, t(lang, "pday_del_confirm", { day: weekdayName(lang, weekday), group: day.muscleGroup }), kb);
}

export async function deletePlanDay(ctx: MyContext, weekday: Weekday) {
  const lang = ctx.user.lang;
  const plan = await getActivePlanOrReply(ctx);
  if (!plan) return;
  if (plan.split.length <= 1) {
    await reply(ctx, t(lang, "pday_last"));
    await showDayManager(ctx);
    return;
  }
  const out = await runPlanEdit(ctx, planOwnerId(ctx), { kind: "daydel", weekday });
  if (!out.ok) {
    await reply(ctx, t(lang, "error_generic"));
    await showDayManager(ctx);
    return;
  }
  await reply(ctx, t(lang, "pday_deleted"));
  await showDayManager(ctx);
}
