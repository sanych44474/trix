// Warm-up editing (self + trainer/owner editing a client's plan): show/edit the current warm-up
// steps, AI-suggest a warm-up for the day's muscle group, and the free-text handler that parses
// a typed reply into steps. Extracted from bot.ts (god-file split; same barrel seam via bot.ts's
// `export * from "./bot/warmup"`). The rest of the original "warm-up editing" banner in bot.ts
// was core plan-display/exercise-catalog infrastructure (cmdToday, createExerciseCatalogEntry,
// groundExercise, muscleGroupToEnum, the add/delete-exercise flow, ...) relied on by most other
// bot/*.ts files — left in bot.ts rather than moved, since dozens of files already depend on it
// living in the kernel.
import { InlineKeyboard } from "grammy";
import type { Weekday } from "../types";
import { aiJSON } from "../ai";
import * as P from "../ai/prompts";
import { getActivePlan, updateActivePlanSplit, updateUser } from "../db/repos";
import { getPlanDay } from "../domain/progression";
import { switchMode } from "../domain/session";
import { cleanAi, t } from "../locales/i18n";
import { renderToday } from "../render";
import { type MyContext, menuBtn, planOwnerId, planOwnerLang, reply, setMode, videosForDays } from "../bot";
import { deferAi } from "./router";

// Show the current warm-up for `weekday` and enter "warmup_edit" mode (typed reply = new steps).
export async function showWarmupEditor(ctx: MyContext, weekday: Weekday) {
  const lang = ctx.user.lang;
  const plan = await getActivePlan(ctx.db, planOwnerId(ctx));
  const day = plan ? getPlanDay(plan, weekday) : undefined;
  if (!plan || !day) {
    await reply(ctx, t(lang, "error_generic"), menuBtn(lang));
    return;
  }
  const session = switchMode(ctx.user.session, "warmup_edit", { targetId: weekday });
  await updateUser(ctx.db, ctx.user._id, { session });
  ctx.user.session = session;
  const current = day.warmUp?.length ? day.warmUp.map((s) => `• ${cleanAi(s)}`).join("\n") : t(lang, "warmup_empty");
  const kb = new InlineKeyboard()
    .text(t(lang, "warmup_ai_btn"), `wu:ai:${weekday}`)
    .row()
    .text(t(lang, "warmup_clear_btn"), `wu:clear:${weekday}`);
  await reply(ctx, t(lang, "warmup_edit_ask", { current }), kb);
}

// Persist `steps` as the warm-up for `weekday` (empty list clears it), then re-render the day.
export async function saveWarmup(ctx: MyContext, weekday: Weekday, steps: string[]) {
  const lang = ctx.user.lang;
  const plan = await getActivePlan(ctx.db, planOwnerId(ctx));
  const day = plan ? getPlanDay(plan, weekday) : undefined;
  if (!plan || !day) {
    await reply(ctx, t(lang, "error_generic"), menuBtn(lang));
    return;
  }
  const cleaned = steps.map((s) => cleanAi(s).trim()).filter(Boolean).slice(0, 8);
  if (cleaned.length) day.warmUp = cleaned;
  else delete day.warmUp;
  await updateActivePlanSplit(ctx.db, planOwnerId(ctx), plan.split);
  await setMode(ctx, "idle");
  await reply(ctx, t(lang, cleaned.length ? "warmup_saved" : "warmup_cleared"));
  await reply(ctx, renderToday(lang, day, undefined, undefined, await videosForDays(ctx, [day])));
}

// "🤖 Suggest a warm-up" → AI-generate steps for the day's muscle group, in the plan owner's language.
export async function suggestWarmup(ctx: MyContext, weekday: Weekday) {
  const lang = ctx.user.lang;
  const plan = await getActivePlan(ctx.db, planOwnerId(ctx));
  const day = plan ? getPlanDay(plan, weekday) : undefined;
  if (!plan || !day) {
    await reply(ctx, t(lang, "error_generic"), menuBtn(lang));
    return;
  }
  await ctx.replyWithChatAction("typing").catch(() => {});
  // Deferred past the webhook response (same reason as every other conversational AI call —
  // see deferAi's comment), using the fast "coach" kind/budget instead of "plan": a warm-up
  // suggestion is a small ask that doesn't need plan's heaviest model ladder and 28s deadline,
  // and blocking the webhook that long risked Telegram's retry/duplicate-delivery behavior.
  deferAi(ctx, "warmup_ai", async () => {
    const oLang = await planOwnerLang(ctx);
    const result = await aiJSON<P.WarmupResult>(ctx.env, {
      system: P.warmupSystem(oLang),
      user: P.warmupUser(day.muscleGroup, day.exercises.map((e) => e.name), ctx.user.profile.level ?? "beginner"),
      schema: P.WARMUP_SCHEMA,
      temperature: 0.4,
      kind: "coach",
      db: ctx.db,
      userId: ctx.user._id,
    });
    await saveWarmup(ctx, weekday, result.steps ?? []);
  });
}

// Text handler for "warmup_edit": split the reply into one warm-up step per line / "·" / ";".
export async function handleWarmupEdit(ctx: MyContext, text: string) {
  const weekday = (ctx.user.session.targetId ?? 0) as Weekday;
  const steps = text
    .split(/\r?\n/)
    .flatMap((line) => line.split(/[;·]/))
    .map((s) => s.replace(/^[\s•*-]+/, "").trim())
    .filter(Boolean);
  await saveWarmup(ctx, weekday, steps);
}
