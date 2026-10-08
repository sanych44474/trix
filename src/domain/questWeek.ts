// One quest week, evaluated. The Mini App's Today card (adapters/d1/dashboardReader.ts) and the
// Monday close job (questClose.ts) each used to carry their own copy of "pick this week's quests,
// count the water / food / step days, work out which are done" -- the same twenty lines, with the
// week's boundaries written slightly differently in each. Pure; the callers fetch the rows.
import type { UserDoc, WorkoutLogDoc } from "../types";
import { resolveStepsGoal, resolveWaterGoal } from "./challenges";
import { pickQuests, plannedDayCount, questProgress, type QuestProgress } from "./quests";
import type { LoggedDay } from "./muscleLoad";
import { toLoggedDays } from "./recoverySwap";

const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** The rows a week's quests are judged from. Rows outside the week are ignored, except the week
 * before (workouts only), which the quest pick reads. */
export interface QuestWeekData {
  workouts: WorkoutLogDoc[];
  nutrition: Array<{ date: string; meals: unknown[] }>;
  steps: Array<{ date: string; steps: number }>;
  water: Array<{ date: string; ml: number }>;
  /** The active plan's days, for the planned-sessions target; absent when there is no plan. */
  split?: Array<{ weekday: number }>;
}

export interface QuestWeek {
  /** The week's logged days (everything before the week's end), for callers that also need the balance. */
  logs: LoggedDay[];
  quests: QuestProgress[];
  /** Codes of the quests that are done. */
  done: string[];
}

export function evaluateWeekQuests(profile: UserDoc["profile"], weekStart: string, data: QuestWeekData): QuestWeek {
  const weekEnd = addDays(weekStart, 7);
  const inWeek = <T extends { date: string }>(rows: T[]) => rows.filter((r) => r.date >= weekStart && r.date < weekEnd);
  const logs = toLoggedDays(data.workouts.filter((w) => w.date < weekEnd));
  const quests = questProgress(pickQuests(weekStart, logs, plannedDayCount(profile.trainingWeekdays, data.split)), weekStart, {
    logs,
    waterDays: inWeek(data.water).filter((w) => w.ml >= resolveWaterGoal(profile)).length,
    foodDays: new Set(inWeek(data.nutrition).filter((n) => n.meals.length > 0).map((n) => n.date)).size,
    stepsDays: inWeek(data.steps).filter((s) => s.steps >= resolveStepsGoal(profile)).length,
  });
  return { logs, quests, done: quests.filter((q) => q.done).map((q) => q.code) };
}
