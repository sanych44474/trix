// Whole-day difficulty step (one notch harder or easier): the bot's "harder / easier" buttons and
// the Mini App's plan action both call this, so the swap rules live in one place.
import type { CatalogExercise, Env, Lang, PlanDay } from "../../types";
import type { DB } from "../../adapters/d1/shared";
import { getCatalogExercise, listExercisesByMusclesAnyLevel } from "../../adapters/d1/v2Catalog";
import { updateActivePlanSplit } from "../../adapters/d1/v2Plans";
import { pickDifficultySwaps } from "../../domain/difficultySwap";
import { translatePlanExercises } from "./planBuild";

/**
 * Swap the exercises of one plan day to their next difficulty tier and persist the split.
 * [ownerId] is the plan's owner; [actorId] is who asked (translation is billed to them).
 * Returns the new split and how many exercises changed; null when the day is not in the plan.
 */
export async function adjustDayDifficulty(
  env: Env,
  opts: { db: DB; ownerId: number; actorId: number; lang: Lang; split: PlanDay[]; weekday: number; direction: "up" | "down" },
): Promise<{ split: PlanDay[]; swappedCount: number } | null> {
  const { db, lang, weekday: wd, direction } = opts;
  const targetDay = opts.split.find((d) => d.weekday === wd);
  if (!targetDay) return null;

  const usedIds = (targetDay.exercises ?? []).map((e) => e.exerciseId).filter(Boolean) as string[];

  // One catalog lookup per exercise (cheap PK reads) to know each one's own muscle/tier, then
  // ONE bulk candidate fetch across every distinct muscle in the day — replacing what used to be
  // up to 4 sequential RANDOM()-ordered bucket scans PER exercise (one per difficulty tier tried).
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
    direction,
    catalogByExerciseId,
    candidatesByMuscle,
    usedIds,
  );

  const newSplit = opts.split.map((day) =>
    day.weekday === wd ? { ...day, exercises: updatedExercises } : day
  );
  let finalSplit = newSplit;
  if (swappedCount > 0 && lang !== "en") {
    finalSplit = await translatePlanExercises(env, lang, newSplit, db, opts.actorId);
  }
  await updateActivePlanSplit(db, opts.ownerId, finalSplit);
  return { split: finalSplit, swappedCount };
}
