// The chat side of the recovery swap (domain/recoverySwap.ts): under /today's workout, when the
// day's muscles are still recovering, one button trades today's plan day with the suggested
// later one. The Mini App shows the same suggestion on its Today screen (dashboard.recoverySwap).
import { InlineKeyboard } from "grammy";
import type { PlanDoc, Weekday, WorkoutLogDoc } from "../types";
import { t } from "../locales/i18n";
import { weekdayName } from "../render";
import { recoverySwapFor } from "../domain/recoverySwap";
import { type MyContext, reply } from "../adapters/telegram/context";
import { runPlanEdit } from "./planEditRun";

/** Sent right after today's workout when a swap is worth offering; silent otherwise. */
export async function offerRecoverySwap(ctx: MyContext, plan: PlanDoc, workouts: WorkoutLogDoc[], today: string, weekday: Weekday): Promise<void> {
  if (ctx.user.role === "client") return; // a client's plan is the trainer's to rearrange
  const swap = recoverySwapFor(plan, workouts, today, weekday);
  if (!swap) return;
  const lang = ctx.user.lang;
  const muscles = swap.tired.map((s) => t(lang, `mus_${s.replace("-", "_")}` as Parameters<typeof t>[1])).join(", ");
  const other = weekdayName(lang, swap.other as Weekday);
  const kb = new InlineKeyboard().text(t(lang, "rswap_btn", { day: other }), `rswap:${swap.weekday}:${swap.other}`);
  await reply(ctx, t(lang, "rswap_msg", { muscles, because: swap.because.join(", "), day: other, group: swap.otherGroup }), kb);
}

export async function applyRecoverySwap(ctx: MyContext, a: number, b: number): Promise<void> {
  await ctx.answerCallbackQuery().catch(() => {});
  const lang = ctx.user.lang;
  if (ctx.user.role === "client") return;
  const out = await runPlanEdit(ctx, ctx.user._id, { kind: "dayswap", weekday: a, other: b });
  if (!out.ok) {
    await reply(ctx, t(lang, "rswap_stale"));
    return;
  }
  await ctx.editMessageReplyMarkup().catch(() => {});
  await reply(ctx, t(lang, "rswap_done", { a: weekdayName(lang, a as Weekday), b: weekdayName(lang, b as Weekday) }));
}
