export interface V2ParityResult {
  ok: boolean;
  legacy: { plans: number; workouts: number; nutrition: number; measurements: number };
  v2: { plans: number; workouts: number; nutrition: number; measurements: number };
}

/** Small shadow-read comparison for one account; never changes the request result. */
export async function compareV2UserParity(db: D1Database, accountId: number): Promise<V2ParityResult> {
  const row = await db.prepare(
    `SELECT
       (SELECT COUNT(*) FROM plans WHERE userId = ? AND active = 1) AS legacyPlans,
       (SELECT COUNT(*) FROM v2_plans WHERE accountId = ? AND status = 'active') AS v2Plans,
       (SELECT COUNT(*) FROM workout_logs WHERE userId = ?) AS legacyWorkouts,
       (SELECT COUNT(*) FROM v2_workout_sessions WHERE accountId = ?) AS v2Workouts,
       (SELECT COUNT(*) FROM nutrition_logs WHERE userId = ?) AS legacyNutrition,
       (SELECT COUNT(*) FROM v2_nutrition_days WHERE accountId = ?) AS v2Nutrition,
       (SELECT COUNT(*) FROM body_logs WHERE userId = ?) AS legacyMeasurements,
       (SELECT COUNT(*) FROM v2_measurements WHERE accountId = ?) AS v2Measurements`,
  ).bind(accountId, accountId, accountId, accountId, accountId, accountId, accountId, accountId).first<{
    legacyPlans: number; v2Plans: number; legacyWorkouts: number; v2Workouts: number;
    legacyNutrition: number; v2Nutrition: number; legacyMeasurements: number; v2Measurements: number;
  }>();
  const legacy = { plans: row?.legacyPlans ?? 0, workouts: row?.legacyWorkouts ?? 0, nutrition: row?.legacyNutrition ?? 0, measurements: row?.legacyMeasurements ?? 0 };
  const v2 = { plans: row?.v2Plans ?? 0, workouts: row?.v2Workouts ?? 0, nutrition: row?.v2Nutrition ?? 0, measurements: row?.v2Measurements ?? 0 };
  return { ok: Object.keys(legacy).every((key) => legacy[key as keyof typeof legacy] === v2[key as keyof typeof v2]), legacy, v2 };
}
