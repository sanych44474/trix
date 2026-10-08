// Close a finished quest week: record the quests that were done. The Mini App's Today card
// records completions as it renders (dashboardReader.ts), but a quest finished on Sunday night,
// or by someone who only uses the bot, was never recorded — the XP (and the quest_sweep badge)
// silently went missing. The Monday scheduler pass calls this for the week that just ended;
// recording is idempotent per (week, code), so a week the app already recorded is a no-op.
import type { DB } from "./adapters/d1/shared";
import type { UserDoc } from "./types";
import { workoutLogsSince } from "./adapters/d1/v2Workouts";
import { nutritionLogsSince } from "./adapters/d1/v2Nutrition";
import { stepLogsSince, waterLogsSince } from "./adapters/d1/v2Tracking";
import { getActivePlan } from "./adapters/d1/v2Plans";
import { settleQuests } from "./adapters/d1/v2Gamification";
import { evaluateWeekQuests } from "./domain/questWeek";

const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Record the done quests of the week starting `weekStart` (a Monday). Returns the new codes. */
export async function closeQuestWeek(db: DB, user: UserDoc, weekStart: string): Promise<string[]> {
  const [workouts, nutrition, steps, water, plan] = await Promise.all([
    workoutLogsSince(db, user._id, addDays(weekStart, -7)), // the pick reads the week before
    nutritionLogsSince(db, user._id, weekStart),
    stepLogsSince(db, user._id, weekStart),
    waterLogsSince(db, user._id, weekStart),
    getActivePlan(db, user._id).catch(() => null),
  ]);
  const week = evaluateWeekQuests(user.profile, weekStart, { workouts, nutrition, steps, water, split: plan?.split });
  return (await settleQuests(db, user._id, weekStart, week)).fresh;
}
