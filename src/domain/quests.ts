// Weekly quests: three small goals per Monday–Sunday week, picked from what the user actually
// does — a workout count from their plan, the muscle last week's report says lagged, and one
// habit (water / food log / steps) rotating by week. Picking is deterministic from last week's
// logs, so nothing about a week's quests is stored; only completion is (v2_quests), which is
// what the XP formula counts (domain/gamification.ts). Progress is recomputed live from logs.
// Pure; test/quests.test.ts.
import { weeklyMuscleSets, type LoggedDay, type Lookup } from "./muscleLoad";
import { musclesForExercise, type Slug } from "./exerciseMuscles";
import { weeklyReport } from "./weeklyReport";
export { QUEST_XP } from "./gamification";

export type QuestKind = "workouts" | "muscle_sets" | "balance" | "water_days" | "food_days" | "steps_days";

export interface Quest {
  code: string; // stable within a week: kind (+ muscle), e.g. "muscle_sets:hamstring"
  kind: QuestKind;
  target: number;
  muscle?: Slug;
}

export interface QuestProgress extends Quest {
  current: number;
  done: boolean;
}

const HABITS: QuestKind[] = ["water_days", "food_days", "steps_days"];

/** Days since 1970-01-05 (a Monday) / 7 — the week number the habit rotation keys on. */
function weekIndex(weekStart: string): number {
  return Math.floor((Date.parse(`${weekStart}T00:00:00Z`) - Date.parse("1970-01-05T00:00:00Z")) / (7 * 86_400_000));
}

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * The week's quests. `logs` must reach back to the previous Monday (last week's report is read
 * from them); `plannedDays` is the active plan's training days (0 = no plan).
 */
export function pickQuests(weekStart: string, logs: LoggedDay[], plannedDays: number, lookup: Lookup = musclesForExercise): Quest[] {
  const lastStart = addDays(weekStart, -7);
  // Only what was logged before the week began: back-filling a missed day of last week on
  // Wednesday must not swap this week's muscle quest for a new one (a second, free completion).
  const lastWeek = logs.filter((l) => l.date >= lastStart && l.date < weekStart && !(l.loggedOn && l.loggedOn >= weekStart));
  const lastWorkouts = new Set(lastWeek.filter((l) => l.done).map((l) => l.date)).size;
  // Planned days when there is a plan; otherwise one more than last week, between 2 and 4.
  const target = plannedDays > 0 ? Math.min(6, Math.max(2, plannedDays)) : Math.min(4, Math.max(2, lastWorkouts + 1));
  const quests: Quest[] = [{ code: "workouts", kind: "workouts", target }];
  if (lastWorkouts > 0) {
    const report = weeklyReport(lastWeek, lastStart, lookup);
    const lag = report.lagging[0];
    if (lag) quests.push({ code: `muscle_sets:${lag.slug}`, kind: "muscle_sets", target: lag.mev, muscle: lag.slug });
    else quests.push({ code: "balance", kind: "balance", target: 90 });
  }
  const habit = HABITS[((weekIndex(weekStart) % HABITS.length) + HABITS.length) % HABITS.length]!;
  quests.push({ code: habit, kind: habit, target: 5 });
  return quests;
}

/** What the week's counters read (the caller fetches this week's water/food/steps days). */
export interface QuestInputs {
  logs: LoggedDay[]; // this week's (older rows are ignored)
  waterDays: number; // days the water goal was met
  foodDays: number; // days with a food log
  stepsDays: number; // days the steps goal was met
}

export function questProgress(quests: Quest[], weekStart: string, inp: QuestInputs, lookup: Lookup = musclesForExercise): QuestProgress[] {
  const week = inp.logs.filter((l) => l.date >= weekStart);
  const workouts = new Set(week.filter((l) => l.done).map((l) => l.date)).size;
  const muscles = weeklyMuscleSets(week, weekStart, lookup);
  const balance = weeklyReport(week, weekStart, lookup).balance;
  return quests.map((q) => {
    const current =
      q.kind === "workouts" ? workouts
      : q.kind === "muscle_sets" ? Math.floor((muscles.find((m) => m.slug === q.muscle)?.sets ?? 0) * 2) / 2
      : q.kind === "balance" ? balance
      : q.kind === "water_days" ? inp.waterDays
      : q.kind === "food_days" ? inp.foodDays
      : inp.stepsDays;
    return { ...q, current, done: current >= q.target };
  });
}

/** Training days per week: the profile's chosen weekdays, else the plan's days. */
export function plannedDayCount(trainingWeekdays: number[] | undefined, split: Array<{ weekday: number }> | undefined): number {
  return new Set(trainingWeekdays?.length ? trainingWeekdays : (split ?? []).map((d) => d.weekday)).size;
}
