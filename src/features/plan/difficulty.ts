// Whole-day difficulty step (one notch harder or easier) for the plan editor. Picks the swaps only;
// planEdits.ts persists the result, translates it and records the history row.
import type { CatalogExercise, PlanDay } from "../../types";
import type { DB } from "../../adapters/d1/shared";
import { getCatalogExercise, listExercisesByMusclesAnyLevel } from "../../adapters/d1/v2Catalog";
import { pickDifficultySwaps } from "../../domain/difficultySwap";

/**
 * Swap the exercises of one plan day to their next difficulty tier. Returns the new split and how
 * many exercises changed; null when the day is not in the plan.
 */
export async function pickDayDifficulty(
  db: DB,
  opts: { split: PlanDay[]; weekday: number; direction: "up" | "down" },
): Promise<{ split: PlanDay[]; swappedCount: number } | null> {
  const wd = opts.weekday;
  const targetDay = opts.split.find((d) => d.weekday === wd);
  if (!targetDay) return null;

  const usedIds = (targetDay.exercises ?? []).map((e) => e.exerciseId).filter(Boolean) as string[];

  // One catalog lookup per exercise (cheap PK reads) to know each one's own muscle/tier, then
  // ONE bulk candidate fetch across every distinct muscle in the day.
  const catalogByExerciseId = new Map<string, CatalogExercise>();
  for (const ex of targetDay.exercises ?? []) {
    if (!ex.exerciseId) continue;
    const catalog = await getCatalogExercise(db, ex.exerciseId);
    if (catalog) catalogByExerciseId.set(ex.exerciseId, catalog);
  }
  const muscles = [...new Set([...catalogByExerciseId.values()].map((c) => c.muscle))];
  const pool = await listExercisesByMusclesAnyLevel(db, muscles);
  const candidatesByMuscle = new Map<string, CatalogExercise[]>();
  for (const c of pool) {
    const bucket = candidatesByMuscle.get(c.muscle) ?? [];
    bucket.push(c);
    candidatesByMuscle.set(c.muscle, bucket);
  }

  const { exercises: updatedExercises, swappedCount } = pickDifficultySwaps(
    targetDay.exercises ?? [],
    opts.direction,
    catalogByExerciseId,
    candidatesByMuscle,
    usedIds,
  );

  const split = opts.split.map((day) => (day.weekday === wd ? { ...day, exercises: updatedExercises } : day));
  return { split, swappedCount };
}
