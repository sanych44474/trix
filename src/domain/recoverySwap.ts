// "Chest is still recovering from yesterday -- swap today with Thursday's legs?" When most of
// today's planned work lands on muscles that are still recovering (./muscleLoad.ts
// muscleRecovery), offer the nearest LATER plan day whose muscles are ready, so today's session
// moves to a day when it can be trained properly. The swap is a real plan change (two days trade
// weekdays): every surface that reads the plan by weekday -- logger, reminders, calendar, bot --
// then agrees without a per-date override. Pure; test/recovery-swap.test.ts.
import type { PlanDoc, PlanDay, Weekday, WorkoutLogDoc } from "../types";
import { musclesForExercise, type Slug } from "./exerciseMuscles";
import { muscleRecovery, planSetCount, type LoggedDay, type Lookup, type MuscleRecovery, type PlanDayLike } from "./muscleLoad";

export interface RecoverySwap {
  weekday: number; // today
  other: number; // the later plan day to trade with
  tired: Slug[]; // today's main muscles that are still recovering
  because: string[]; // what tired them (the last session's exercises)
}

/** Share of a day's primary-mover sets that land on muscles in `tired`. */
function tiredShare(day: PlanDayLike, tired: Set<Slug>, lookup: Lookup): { share: number; hit: Set<Slug> } {
  let total = 0;
  let onTired = 0;
  const hit = new Set<Slug>();
  for (const ex of day.exercises) {
    const m = lookup(ex.name);
    if (!m || !m.primary.length) continue;
    const n = planSetCount(ex.sets);
    total += n;
    const tiredHere = m.primary.filter((s) => tired.has(s));
    if (tiredHere.length) {
      onTired += n * (tiredHere.length / m.primary.length);
      tiredHere.forEach((s) => hit.add(s));
    }
  }
  return { share: total ? onTired / total : 0, hit };
}

/**
 * The swap to offer today, or null. Only when at least 40% of today's planned sets hit
 * still-recovering muscles, and only with a later day this week that puts under 15% on them
 * (the nearest such day). An earlier day isn't offered: that would move today's session into the
 * past, which is skipping it, not rescheduling it.
 */
export function recoverySwap(
  days: PlanDayLike[],
  recovery: MuscleRecovery[],
  todayWeekday: number,
  lookup: Lookup = musclesForExercise,
): RecoverySwap | null {
  const today = days.find((d) => d.weekday === todayWeekday);
  if (!today) return null;
  const tired = new Set(recovery.filter((r) => r.status === "recovering").map((r) => r.slug));
  if (!tired.size) return null;
  const mine = tiredShare(today, tired, lookup);
  if (mine.share < 0.4) return null;
  const other = days
    .filter((d) => d.weekday > todayWeekday)
    .sort((a, b) => a.weekday - b.weekday)
    .find((d) => tiredShare(d, tired, lookup).share < 0.15);
  if (!other) return null;
  const because = [...new Set(recovery.filter((r) => mine.hit.has(r.slug)).flatMap((r) => r.exercises))];
  return { weekday: todayWeekday, other: other.weekday, tired: [...mine.hit], because };
}

/** Two plan days trade weekdays (content moves, the set of training weekdays stays the same). */
export function swapPlanDays(split: PlanDay[], a: Weekday, b: Weekday): PlanDay[] | null {
  if (a === b || !split.some((d) => d.weekday === a) || !split.some((d) => d.weekday === b)) return null;
  return split
    .map((d) => (d.weekday === a ? { ...d, weekday: b } : d.weekday === b ? { ...d, weekday: a } : d))
    .sort((x, y) => x.weekday - y.weekday);
}

/** Workout logs in the shape the muscle-load helpers read (unskipped exercises, sets done). */
export function toLoggedDays(workouts: WorkoutLogDoc[]): LoggedDay[] {
  return workouts.map((w) => ({
    date: w.date,
    done: w.completed,
    ex: w.exercises.filter((e) => !e.skipped).map((e) => ({ n: e.name, s: e.setsDone.length })),
    ...(w.createdAt instanceof Date && !Number.isNaN(w.createdAt.getTime()) ? { loggedOn: w.createdAt.toISOString().slice(0, 10) } : {}),
  }));
}

/** The swap to offer for `today` from the active plan and recent logs -- none once today already
 *  has logged sets (the session happened, or is under way). */
export function recoverySwapFor(plan: PlanDoc | null, workouts: WorkoutLogDoc[], today: string, todayWeekday: Weekday): (RecoverySwap & { todayGroup: string; otherGroup: string }) | null {
  if (!plan) return null;
  const logs = toLoggedDays(workouts);
  if (logs.some((l) => l.date === today && l.ex.some((e) => e.s > 0))) return null;
  const swap = recoverySwap(plan.split, muscleRecovery(logs, today), todayWeekday);
  if (!swap) return null;
  const group = (w: number) => plan.split.find((d) => d.weekday === w)?.muscleGroup ?? "";
  return { ...swap, todayGroup: group(swap.weekday), otherGroup: group(swap.other) };
}
