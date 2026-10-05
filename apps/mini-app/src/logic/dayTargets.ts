// Which calorie/macro target a day is measured against: the plan's rest-day target on a day that
// wasn't a training day (when the plan has one), else the training-day target. The Fuel screen
// gets this from the server (/nutrition isRestDay); the Progress screen's macro history and
// today's donut measure each day client-side. Pure; test/mini-app-day-targets.test.ts.

export interface Targets { calories: number; protein: number; fats: number; carbs: number }

export function targetsForDay<T extends Targets>(training: boolean, trainingTargets?: T, restTargets?: T): { targets?: T; rest: boolean } {
  return !training && restTargets ? { targets: restTargets, rest: true } : { targets: trainingTargets, rest: false };
}
