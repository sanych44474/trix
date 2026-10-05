// Adaptive calories: the logged weight trend against the goal's rate nudges the kcal target
// (Mondays, at most every 2 weeks, solo/trainer-own only). Called by processUser.
import { updateUser } from "../adapters/d1/v2Users";
import { nutritionLogsSince } from "../adapters/d1/v2Nutrition";
import { calorieAdjustment } from "../domain/adaptiveCalories";
import { t } from "../locales/i18n";
import { isoDaysAgo } from "./shared";
import type { UserPass } from "./userPass";

export async function adaptiveCalories(p: UserPass): Promise<boolean> {
  const { user, db, lang, markSent, send, bodyAll } = p;
  let claimed = false;
  // processUser's condition already requires both; restated so the types narrow here too.
  const nutrition = user.nutrition;
  const goalWeight = user.profile.goalWeight;
  if (!nutrition || !goalWeight) return false;
  const windowDays = 21;
  const [bodyLogs, nLogs] = await Promise.all([
    bodyAll(),
    nutritionLogsSince(db, user._id, isoDaysAgo(windowDays)),
  ]);
  const since = isoDaysAgo(windowDays);
  const adj = calorieAdjustment({
    currentCalories: nutrition.calories,
    goalWeight,
    weights: bodyLogs
      .filter((b) => b.date >= since && typeof b.weight === "number" && (b.weight as number) > 0)
      .map((b) => ({ date: b.date, weight: b.weight as number })),
    loggedNutritionDays: new Set(nLogs.map((l) => l.date)).size,
    windowDays,
  });
  if (adj) {
    await updateUser(db, user._id, { nutrition: { ...nutrition, calories: adj.newCalories } });
    await send(
      t(lang, adj.deltaKcal < 0 ? "cal_adjust_down" : "cal_adjust_up", {
        old: nutrition.calories,
        new: adj.newCalories,
        trend: Math.abs(adj.slopePerWeek).toFixed(2),
        target: Math.abs(adj.targetPerWeek).toFixed(2),
      }),
    );
    claimed = true; // this tick's one user-facing message
  }
  // Cooldown runs from the last EVALUATION (even a no-op), so a borderline trend isn't re-tested daily.
  markSent("cal_adjust");
  return claimed;
}
