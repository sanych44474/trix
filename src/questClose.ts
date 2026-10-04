// Close a finished quest week: record the quests that were done. The Mini App's Today card
// records completions as it renders (dashboardReader.ts), but a quest finished on Sunday night,
// or by someone who only uses the bot, was never recorded — the XP (and the quest_sweep badge)
// silently went missing. The Monday scheduler pass calls this for the week that just ended;
// recording is idempotent per (week, code), so a week the app already recorded is a no-op.
import type { DB } from "./db/repos/shared";
import type { UserDoc } from "./types";
import { workoutLogsSince } from "./adapters/d1/v2Workouts";
import { nutritionLogsSince } from "./adapters/d1/v2Nutrition";
import { stepLogsSince, waterLogsSince } from "./adapters/d1/v2Tracking";
import { getActivePlan } from "./adapters/d1/v2Plans";
import { awardAchievement, recordQuestsDone } from "./adapters/d1/v2Gamification";
import { pickQuests, plannedDayCount, questProgress } from "./domain/quests";
import { toLoggedDays } from "./domain/recoverySwap";
import { resolveStepsGoal, resolveWaterGoal } from "./domain/challenges";

const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Record the done quests of the week starting `weekStart` (a Monday). Returns the new codes. */
export async function closeQuestWeek(db: DB, user: UserDoc, weekStart: string): Promise<string[]> {
  const weekEnd = addDays(weekStart, 7);
  const inWeek = <T extends { date: string }>(rows: T[]) => rows.filter((r) => r.date >= weekStart && r.date < weekEnd);
  const [workouts, nutrition, steps, water, plan] = await Promise.all([
    workoutLogsSince(db, user._id, addDays(weekStart, -7)), // the pick reads the week before
    nutritionLogsSince(db, user._id, weekStart),
    stepLogsSince(db, user._id, weekStart),
    waterLogsSince(db, user._id, weekStart),
    getActivePlan(db, user._id).catch(() => null),
  ]);
  const logs = toLoggedDays(workouts.filter((w) => w.date < weekEnd));
  const quests = questProgress(pickQuests(weekStart, logs, plannedDayCount(user.profile.trainingWeekdays, plan?.split)), weekStart, {
    logs,
    waterDays: inWeek(water).filter((w) => w.ml >= resolveWaterGoal(user.profile)).length,
    foodDays: new Set(inWeek(nutrition).filter((n) => n.meals.length > 0).map((n) => n.date)).size,
    stepsDays: inWeek(steps).filter((s) => s.steps >= resolveStepsGoal(user.profile)).length,
  });
  const done = quests.filter((q) => q.done).map((q) => q.code);
  const fresh = await recordQuestsDone(db, user._id, weekStart, done);
  if (quests.length && done.length === quests.length && fresh.length) await awardAchievement(db, user._id, "quest_sweep").catch(() => false);
  return fresh;
}
