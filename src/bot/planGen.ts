// Plan-generation triggers: level-up, goal-switch, resuming a plan generation that was still
// pending when the user's session was last touched, and persisting the onboarding baseline
// bodyweight/measurements as the first body_logs row. Extracted from bot.ts (god-file split;
// same barrel seam via bot.ts's `export * from "./bot/planGen"`).
import { saveBaselineBody as saveBaselineBodyDb, recordPlanSource, updateUser } from "../db/repos";
import { localParts, nextLevel } from "../domain/progression";
import { t } from "../locales/i18n";
import { generateClientDraft, generatePlan, regenBankPlan } from "./plan";
import { type MyContext, menuBtn, reply } from "../bot";
import type { UserDoc } from "../types";

// "Level up" button → bump the trainee one experience tier and rebuild a harder bank plan.
export async function onLevelUp(ctx: MyContext) {
  const lang = ctx.user.lang;
  await ctx.answerCallbackQuery().catch(() => {});
  if (ctx.user.role === "client") return;
  const next = nextLevel(ctx.user.profile.level ?? "beginner");
  if (!next) {
    await reply(ctx, t(lang, "levelup_max"), menuBtn(lang));
    return;
  }
  const profile = { ...ctx.user.profile, level: next };
  ctx.user.profile = profile;
  await updateUser(ctx.db, ctx.user._id, { profile });
  await recordPlanSource(ctx.db, ctx.user._id, "level_up", "bank").catch(() => {});
  await reply(ctx, t(lang, "plan_generating"));
  ctx.waitUntil(regenBankPlan(ctx, profile, "levelup_done"));
}

// "Switch to maintenance" button → flip a met fat-loss goal to recomposition and rebuild.
export async function onGoalMaintain(ctx: MyContext) {
  const lang = ctx.user.lang;
  await ctx.answerCallbackQuery().catch(() => {});
  if (ctx.user.role === "client") return;
  const profile = { ...ctx.user.profile, goal: lang === "uk" ? "рекомпозиція / підтримання форми" : "recomposition / maintenance" };
  ctx.user.profile = profile;
  await updateUser(ctx.db, ctx.user._id, { profile });
  await recordPlanSource(ctx.db, ctx.user._id, "goal_switch", "bank").catch(() => {});
  await reply(ctx, t(lang, "plan_generating"));
  ctx.waitUntil(regenBankPlan(ctx, profile, "goal_switch_done"));
}

export async function resumePendingPlan(ctx: MyContext) {
  if (ctx.user.session.mode !== "plan_pending") return false;
  if (ctx.user.role === "client" && ctx.user.trainerId) {
    await generateClientDraft(ctx, ctx.user.profile);
  } else {
    await generatePlan(ctx, ctx.user.profile);
  }
  return true;
}

export async function saveBaselineBody(ctx: MyContext, profile: UserDoc["profile"]) {
  if (!profile.weightKg && !profile.measurements) return;
  const { date } = localParts(profile.timezone);
  await saveBaselineBodyDb(ctx.db, ctx.user._id, date, profile.weightKg, profile.measurements);
}
