// Roadmap item 5: what ONE thing should the home screen (cmdStart, for a returning onboarded
// solo/client) lead with — replacing a generic "welcome back" + full menu with a single
// prioritized action, per the "today -> do it -> log it -> get feedback -> see what's next"
// cycle. Pure: the caller (bot/nextBestAction.ts) gathers the signals, this just orders them.
export type NextBestAction =
  | { kind: "first_workout" } // never completed a workout -- get them into their very first one
  | { kind: "today_workout" } // today's plan has a pending (not yet logged) session
  | { kind: "recovery" } // missed 2 consecutive planned sessions -- re-engage before menu clutter
  | { kind: "checkin" } // no daily check-in yet today
  | { kind: "post_workout_nutrition" } // trained today, hasn't logged food yet
  | { kind: "rest" }; // nothing urgent -- fall through to the normal schedule/next-session view

export interface NextBestActionInput {
  totalCompletedWorkouts: number;
  todayPending: boolean;
  missedLapse: boolean;
  checkedInToday: boolean;
  completedWorkoutToday: boolean;
  loggedNutritionToday: boolean;
}

export function resolveNextBestAction(input: NextBestActionInput): NextBestAction {
  if (input.totalCompletedWorkouts === 0) return { kind: "first_workout" };
  if (input.todayPending) return { kind: "today_workout" };
  if (input.missedLapse) return { kind: "recovery" };
  if (!input.checkedInToday) return { kind: "checkin" };
  if (input.completedWorkoutToday && !input.loggedNutritionToday) return { kind: "post_workout_nutrition" };
  return { kind: "rest" };
}
