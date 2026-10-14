// Reorder exercises within a day (drag-free up/down), for the athlete and for a trainer/owner,
// plus the self-edit day keyboard and its exit, which the reorder screen shares with the editors.
import { InlineKeyboard } from "grammy";
import type { Lang, Weekday } from "../types";
import { getActivePlan, updateActivePlanSplit } from "../adapters/d1/v2Plans";
import { getPlanDay } from "../domain/progression";
import { t } from "../locales/i18n";
import { renderToday } from "../render";
import { weekdayName } from "../render";
import { type MyContext, getActivePlanOrReply, isEditingOther, planOwnerId, reply } from "../adapters/telegram/context";
import { reRenderEditDay } from "./planView";
import { videosForDays } from "../features/plan/exerciseVideos";
import { menuBtn } from "../adapters/telegram/keyboards";

// Self plan-edit day menu — the editing hub for one's OWN plan (mirrors the trainer's editDayKb,
// but with self callbacks and no logging buttons). After every self edit we re-show THIS, so the
// full edit menu is always one glance away — tap another action or ✅ Done to finish.
export function selfEditDayKb(lang: Lang, weekday: number): InlineKeyboard {
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
    .text(t(lang, "edit_done"), "menu:plan");
}

// Re-show the self edit-day hub (day + full edit menu). Called after each self edit and when the
// user opens a day from the day manager or taps ✅ Done in a picker.
export async function endSelfEdit(ctx: MyContext, arg: string) {
  const lang = ctx.user.lang;
  if (arg === "x") {
    await reply(ctx, t(lang, "edit_done"), menuBtn(lang));
    return;
  }
  const weekday = Number(arg) as Weekday;
  const plan = await getActivePlan(ctx.db, ctx.user._id);
  const day = plan ? getPlanDay(plan, weekday) : undefined;
  if (!day) {
    await reply(ctx, t(lang, "no_plan"), menuBtn(lang));
    return;
  }
  await reply(
    ctx,
    renderToday(lang, day, weekdayName(lang, weekday as Weekday), undefined, await videosForDays(ctx, [day]), { noCta: true }),
    selfEditDayKb(lang, weekday),
  );
}

// ============ Reorder exercises within a day (drag-free ⬆️/⬇️) — self and trainer/owner ============
// Operates on the plan being edited (planOwnerId), so it serves both a user editing their own
// program and a trainer/owner editing a client's. After each move the list re-renders in place.
export async function showReorder(ctx: MyContext, weekday: Weekday) {
  const lang = ctx.user.lang;
  const plan = await getActivePlanOrReply(ctx);
  if (!plan) return;
  const day = getPlanDay(plan, weekday);
  if (!day || !day.exercises.length) { await reply(ctx, t(lang, "error_generic")); return; }
  const kb = new InlineKeyboard();
  day.exercises.forEach((ex, i) => {
    kb.text(`${i + 1}. ${ex.name}`.slice(0, 40), "ord:noop");
    kb.text(i > 0 ? "⬆️" : " ", i > 0 ? `ord:up:${weekday}:${i}` : "ord:noop");
    kb.text(i < day.exercises.length - 1 ? "⬇️" : " ", i < day.exercises.length - 1 ? `ord:down:${weekday}:${i}` : "ord:noop");
    kb.row();
  });
  kb.text(t(lang, "back"), `ord:back:${weekday}`);
  await reply(ctx, t(lang, "reorder_title"), kb);
}

export async function moveExercise(ctx: MyContext, weekday: Weekday, index: number, dir: "up" | "down") {
  const plan = await getActivePlanOrReply(ctx);
  if (!plan) return;
  const day = getPlanDay(plan, weekday);
  if (!day) return;
  const j = dir === "up" ? index - 1 : index + 1;
  if (index < 0 || j < 0 || index >= day.exercises.length || j >= day.exercises.length) {
    await showReorder(ctx, weekday);
    return;
  }
  [day.exercises[index], day.exercises[j]] = [day.exercises[j], day.exercises[index]];
  await updateActivePlanSplit(ctx.db, planOwnerId(ctx), plan.split);
  await showReorder(ctx, weekday);
}

// Back from the reorder view → the edit-day menu of whichever context we're in.
export async function endReorder(ctx: MyContext, weekday: Weekday) {
  if (isEditingOther(ctx)) await reRenderEditDay(ctx, weekday);
  else await endSelfEdit(ctx, String(weekday));
}
