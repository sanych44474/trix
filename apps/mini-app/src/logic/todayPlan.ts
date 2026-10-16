// What Today leads with: one workout block (start / continue / done / rest day) and the week as
// seven days. Pure, so the states are tested without rendering (test/mini-app-today-plan.test.ts).
import { isSetFilled, type LoggerDraft } from "./logger";

export type TodayState = "start" | "continue" | "done" | "rest";
export type DayMark = "done" | "missed" | "planned" | "rest";

export interface TodayPlan {
  state: TodayState;
  /** Exercise names for today (the plan's, or the draft's once a session is under way). */
  exercises: string[];
  /** Exercises with at least one logged set in the draft (continue) or in today's log (done). */
  started: number;
  /** Sets logged today (done) or so far (continue). */
  sets: number;
  week: Array<{ date: string; weekday: number; mark: DayMark; today: boolean }>;
  weekDone: number;
  weekPlanned: number;
}

export interface TodayInput {
  today: string; // YYYY-MM-DD
  planExercises: string[]; // dashboard.logForm.exercises
  plannedWeekdays: number[]; // ISO 1..7 from calendar.split
  days: Array<{ date: string; s: "done" | "missed" | "rest" }>;
  logs: Array<{ date: string; done: boolean; ex: Array<{ n: string; s: number }> }>;
  draft: LoggerDraft | null;
}

const DAY_MS = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const weekdayOf = (date: string) => { const d = new Date(`${date}T00:00:00Z`).getUTCDay(); return d === 0 ? 7 : d; };

export function todayPlan(input: TodayInput): TodayPlan {
  const { today, planExercises, plannedWeekdays, days, logs, draft } = input;
  const planned = new Set(plannedWeekdays.filter((w) => w >= 1 && w <= 7));
  const byDate = new Map(days.map((d) => [d.date, d.s]));
  const todayLog = logs.find((log) => log.date === today && log.done);

  // Monday..Sunday of this week.
  const todayMs = Date.parse(`${today}T00:00:00Z`);
  const monday = todayMs - (weekdayOf(today) - 1) * DAY_MS;
  const week = Array.from({ length: 7 }, (_, i) => {
    const date = iso(monday + i * DAY_MS);
    const weekday = i + 1;
    const isToday = date === today;
    const loggedDone = byDate.get(date) === "done" || (isToday && Boolean(todayLog));
    const mark: DayMark = loggedDone ? "done"
      : date < today && byDate.get(date) === "missed" ? "missed"
      : planned.has(weekday) && date >= today ? "planned"
      : "rest";
    return { date, weekday, mark, today: isToday };
  });
  const weekDone = week.filter((d) => d.mark === "done").length;
  const weekPlanned = Math.max(planned.size, weekDone);

  if (todayLog) {
    return { state: "done", exercises: todayLog.ex.map((e) => e.n), started: todayLog.ex.length, sets: todayLog.ex.reduce((n, e) => n + e.s, 0), week, weekDone, weekPlanned };
  }
  // A session under way on this phone (today's draft, not a back-filled day).
  const live = draft && draft.date === today && !draft.logDate ? draft : null;
  const liveSets = live ? live.exercises.reduce((n, e) => n + (e.setsDone ?? []).filter(isSetFilled).length, 0) : 0;
  if (live && liveSets > 0) {
    return {
      state: "continue",
      exercises: live.exercises.map((e) => e.name),
      started: live.exercises.filter((e) => (e.setsDone ?? []).some(isSetFilled)).length,
      sets: liveSets, week, weekDone, weekPlanned,
    };
  }
  if (planExercises.length) return { state: "start", exercises: planExercises, started: 0, sets: 0, week, weekDone, weekPlanned };
  return { state: "rest", exercises: [], started: 0, sets: 0, week, weekDone, weekPlanned };
}
