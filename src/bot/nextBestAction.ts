// Roadmap item 5: gathers the signals resolveNextBestAction needs and renders the chosen action
// for cmdStart's returning-onboarded-user branch. Deliberately thin — first_workout/
// today_workout/rest all delegate straight to cmdToday (already the right rendering: deload,
// phase, readiness, videos) rather than re-deriving it; this file's only real new logic is the
// priority gate in front of it (recovery / checkin / post-workout nutrition), each a short lead-
// in line before falling through to the normal screen it's nudging toward.
import { countCompletedWorkouts, workoutLogsSince } from "../adapters/d1/v2Workouts";
import { getActivePlan } from "../adapters/d1/v2Plans";
import { getDailyCheckin } from "../adapters/d1/v2Tracking";
import { getDayMeals } from "../adapters/d1/v2Nutrition";
import { missedConsecutiveWorkouts } from "../domain/atrisk";
import { localParts } from "../domain/progression";
import { resolveNextBestAction } from "../domain/nextBestAction";
import { upcomingSessions } from "../render";
import { t } from "../locales/i18n";
import { type MyContext, reply } from "../adapters/telegram/context";
import { cmdToday, cmdWellbeing, cmdNutrition, localCutoff } from "../bot";

export async function showNextBestAction(ctx: MyContext): Promise<void> {
  const lang = ctx.user.lang;
  const tz = ctx.user.profile.timezone;
  const { date } = localParts(tz);

  const plan = await getActivePlan(ctx.db, ctx.user._id);
  if (!plan || !plan.split.length) {
    // No plan yet (e.g. a client whose trainer hasn't assigned one) — nothing to prioritize.
    await reply(ctx, ctx.user.role === "client" ? t(lang, "client_no_plan_yet") : t(lang, "no_plan"));
    return;
  }

  const [recentLogs, checkin, totalCompleted, mealsToday] = await Promise.all([
    workoutLogsSince(ctx.db, ctx.user._id, localCutoff(tz, 21)),
    getDailyCheckin(ctx.db, ctx.user._id, date).catch(() => null),
    countCompletedWorkouts(ctx.db, ctx.user._id),
    getDayMeals(ctx.db, ctx.user._id, date).catch(() => []),
  ]);
  const logs = recentLogs.map((l) => ({ date: l.date, completed: l.completed }));
  const sessions = upcomingSessions(lang, plan, tz, logs, 6);
  const todayPending = sessions.some((s) => s.date === date && s.status === "pending");
  const completedWorkoutToday = recentLogs.some((l) => l.date === date && l.completed);

  // Same "lapse" definition the trainer at-risk alert uses (scheduler.ts) — floored to the later
  // of plan-start / account-creation so a brand-new plan/user is never credited with "missed"
  // sessions that predate them.
  const genD = plan.generatedAt.toISOString().slice(0, 10);
  const joinD = ctx.user.createdAt.toISOString().slice(0, 10);
  const floor = genD > joinD ? genD : joinD;
  const missedLapse = !!missedConsecutiveWorkouts(
    plan.split.map((d) => d.weekday),
    recentLogs.filter((l) => l.completed).map((l) => l.date),
    date,
    floor,
  );

  const action = resolveNextBestAction({
    totalCompletedWorkouts: totalCompleted,
    todayPending,
    missedLapse,
    checkedInToday: !!checkin,
    completedWorkoutToday,
    loggedNutritionToday: mealsToday.length > 0,
  });

  switch (action.kind) {
    case "first_workout":
      await reply(ctx, t(lang, "nba_first_workout"));
      await cmdToday(ctx);
      return;
    case "today_workout":
    case "rest":
      await cmdToday(ctx);
      return;
    case "recovery":
      await reply(ctx, t(lang, "nba_recovery"));
      await cmdToday(ctx);
      return;
    case "checkin":
      await reply(ctx, t(lang, "nba_checkin"));
      await cmdWellbeing(ctx);
      return;
    case "post_workout_nutrition":
      await reply(ctx, t(lang, "nba_nutrition"));
      await cmdNutrition(ctx);
      return;
  }
}
