// Bi-weekly adaptive check-in: the coach reads the athlete's free-text answer and micro-adjusts the
// live plan (weights and sets). Shared by the bot's chat answer and the app's check-in route.
import { aiJSON } from "../../ai";
import * as P from "../../ai/prompts";
import { setActivePlan } from "../../adapters/d1/v2Plans";
import { recordAdjustment } from "../../adapters/d1/v2PlanHistory";
import { localParts } from "../../domain/localTime";
import { weeksSincePlan } from "../../domain/deload";
import { cleanAi, cleanAiText } from "../../locales/i18n";
import type { MyContext } from "../../adapters/telegram/context";
import type { PlanDoc } from "../../types";
import { coachContext } from "../coach/coachContext";

export type AdaptiveCtx = Pick<MyContext, "db" | "env" | "user">;

/** Asks the coach for micro-adjustments to `plan` (edited in place) and saves the plan when any changed. */
export async function applyAdaptiveCheckin(ctx: AdaptiveCtx, plan: PlanDoc, text: string): Promise<{ reply: string; applied: string[] }> {
  const lang = ctx.user.lang;
  const result = await aiJSON<P.AdaptiveResult>(ctx.env, {
    system: P.adaptiveAdjustmentSystem(lang, ctx.user.profile, await coachContext(ctx, ctx.user)),
    user: text,
    schema: P.ADAPTIVE_SCHEMA,
    temperature: 0.5,
    kind: "coach",
    db: ctx.db,
    userId: ctx.user._id,
  });
  // Apply each micro-adjustment to the live plan (only the fields the AI changed).
  const applied: string[] = [];
  for (const adj of result.adjustments ?? []) {
    const day = plan.split.find((d) => d.weekday === adj.weekday);
    const ex = day?.exercises[adj.index];
    if (!ex) continue;
    // Short plan fields ("4 × 8-10", "60 kg"): a runaway answer must not land in the plan whole.
    if (adj.sets) ex.sets = cleanAi(adj.sets).slice(0, 40);
    if (adj.startWeight) ex.startWeight = cleanAi(adj.startWeight).slice(0, 40);
    if (adj.sets || adj.startWeight) {
      applied.push(`${ex.name}: ${ex.sets} · ${ex.startWeight}`);
    }
  }
  if (applied.length) {
    await setActivePlan(ctx.db, plan);
    const week = weeksSincePlan(plan.generatedAt.toISOString(), localParts(ctx.user.profile.timezone).date);
    await recordAdjustment(ctx.db, ctx.user._id, week, JSON.stringify(result.adjustments ?? []));
  }
  return { reply: cleanAiText(result.reply), applied };
}
