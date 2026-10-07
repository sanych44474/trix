// Activity views: the compliance score and the calendar activity cells.


/** Weekly compliance: % of scheduled workouts completed and % of days with a food log.
 * `scheduledWorkouts` = training days that fell in the window; `windowDays` = nutrition denom. */
export function complianceScore(args: {
  completedWorkouts: number;
  scheduledWorkouts: number;
  nutritionDays: number;
  windowDays: number;
}): { workoutPct: number; nutritionPct: number } {
  const pct = (n: number, d: number) => (d > 0 ? Math.min(100, Math.round((n / d) * 100)) : 0);
  return {
    workoutPct: pct(args.completedWorkouts, args.scheduledWorkouts),
    nutritionPct: pct(args.nutritionDays, args.windowDays),
  };
}

// ---------- activity grid (streak calendar) ----------

export interface ActivityCell {
  date: string;
  workout: boolean;
  nutrition: boolean;
}

/** Build the last `days` calendar cells ending at `today` (oldest first), each flagged with
 * whether a workout was completed and/or food was logged that day. Pure — drives /progress. */
export function buildActivityCells(
  today: string,
  workoutDates: Set<string>,
  nutritionDates: Set<string>,
  days = 28,
): ActivityCell[] {
  const end = Date.parse(today);
  const cells: ActivityCell[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(end - i * 86_400_000).toISOString().slice(0, 10);
    cells.push({ date, workout: workoutDates.has(date), nutrition: nutritionDates.has(date) });
  }
  return cells;
}
