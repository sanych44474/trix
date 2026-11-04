// Which weekdays a person trains on, and the macro targets for a given day. One rule for every
// surface: the active plan's days when the plan has any, else the profile's chosen weekdays.
//
// It used to be decided in seven places two ways. The scheduler put the plan first; the Fuel
// screen, the 12-week calendar, the bot's nutrition, progress and check-in put the profile first.
// The Mini App's profile save changes profile.trainingWeekdays without touching the plan, so after
// moving Monday to Tuesday the reminder still came on Monday (and so did the Today workout, which
// reads the plan) while Fuel showed rest-day macros on Monday and training macros on Tuesday.
// The plan wins because it is what the person is actually shown to train.
import type { NutritionTargets, Weekday } from "../types";

interface DaysInput {
  profile: { trainingWeekdays?: number[] };
  plan?: { split?: Array<{ weekday: number }> } | null;
}

/** ISO weekdays (1 = Mon) the person trains on, ascending, without duplicates. */
export function trainingWeekdaysOf({ profile, plan }: DaysInput): Weekday[] {
  const fromPlan = (plan?.split ?? []).map((d) => d.weekday);
  const source = fromPlan.length ? fromPlan : (profile.trainingWeekdays ?? []);
  return [...new Set(source.filter((d) => Number.isInteger(d) && d >= 1 && d <= 7))].sort((a, b) => a - b) as Weekday[];
}

export function isTrainingDay(input: DaysInput, weekday: number): boolean {
  return trainingWeekdaysOf(input).includes(weekday as Weekday);
}

/** The day's macro targets: the plan's rest-day set on a rest day when it has one, else the user's. */
export function dayTargets(
  input: DaysInput & { plan?: { split?: Array<{ weekday: number }>; restDayNutrition?: NutritionTargets } | null; nutrition?: NutritionTargets | null },
  weekday: number,
): { targets: NutritionTargets | null; isRestDay: boolean } {
  const isRestDay = !isTrainingDay(input, weekday) && !!input.plan?.restDayNutrition;
  return { targets: (isRestDay ? input.plan?.restDayNutrition : undefined) ?? input.nutrition ?? null, isRestDay };
}
