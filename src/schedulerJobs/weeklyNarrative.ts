// The Monday motivational note for solo/trainer-own users with recent activity (one AI call a
// week, within the pass's narrative budget). Called by processUser.
import { dailyCheckinsSince } from "../adapters/d1/v2Tracking";
import { nutritionLogsSince } from "../adapters/d1/v2Nutrition";
import { adherenceDeloadDue, computePlanProgression, deloadWeekDue } from "../domain/progression";
import { escapeHtml, t } from "../locales/i18n";
import { aiText } from "../ai/index";
import { weeklyNarrativeSystem } from "../ai/prompts";
import { logSchedulerError, isoDaysAgo } from "./shared";
import type { UserPass } from "./userPass";

export async function weeklyNarrative(p: UserPass): Promise<void> {
  const { env, user, pass, db, lang, date, activePlan, markSent, send, workouts21, bodyAll } = p;
  const since = isoDaysAgo(7);
  const wl = (await workouts21()).filter((l) => l.date >= since); // 7-day slice of the 21-day pull
  if (wl.length) {
    pass.narrativeBudget--;
    markSent("weekly_narrative");
    const nl = await nutritionLogsSince(db, user._id, since);
    const recentBody = (await bodyAll()).filter((b) => typeof b.weight === "number" && b.date >= since);
    const weightDelta =
      recentBody.length >= 2
        ? +(((recentBody[recentBody.length - 1].weight as number) - (recentBody[0].weight as number)).toFixed(1))
        : 0;
    // Periodization context the app already decided on its own this week (mesocycle phase,
    // an autopilot deload, a plateau swap) — folded into the SAME narrative call as the "why"
    // behind what the user saw, instead of leaving those as unexplained separate pings. Cheap:
    // pure date/array math plus one extra checkins read, reusing the already-cached plan/logs.
    const plan = activePlan;
    const mesocyclePhase = plan?.mesocycle
      ? `${plan.mesocycle.phase}, week ${plan.mesocycle.weekInBlock}/${plan.mesocycle.blockLength}`
      : undefined;
    let deloadThisWeek = false;
    let plateauExercises: string[] = [];
    if (plan) {
      const logs21 = await workouts21();
      deloadThisWeek =
        deloadWeekDue(plan.generatedAt.toISOString().slice(0, 10), date) || adherenceDeloadDue(logs21);
      if (plan.split.length) {
        const checkins = await dailyCheckinsSince(db, user._id, isoDaysAgo(7)).catch(() => []);
        plateauExercises = computePlanProgression(plan, logs21, checkins).plateau;
      }
    }
    const summary = {
      workoutsDone: wl.filter((l) => l.completed).length,
      workoutsSkipped: wl.filter((l) => !l.completed).length,
      nutritionDaysLogged: nl.length,
      weightDeltaKg: weightDelta,
      ...(mesocyclePhase ? { mesocyclePhase } : {}),
      ...(deloadThisWeek ? { deloadThisWeek } : {}),
      ...(plateauExercises.length ? { plateauExercises } : {}),
    };
    try {
      const text = await aiText(env, {
        system: weeklyNarrativeSystem(lang),
        user: JSON.stringify(summary),
        temperature: 0.6,
        kind: "report",
        db,
        userId: user._id,
      });
      await send(`${t(lang, "weekly_narrative_header")}\n\n${escapeHtml(text)}`);
    } catch (err) {
      logSchedulerError(db, "weekly_narrative", err, user._id);
    }
  }
}
