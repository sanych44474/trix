// Pure "make this day harder/easier" swap picker — used by bot.ts's adjustDifficulty, which
// fetches each exercise's own catalog entry plus one bulk candidate pool (all difficulty tiers,
// the day's muscles) up front, so this function itself makes no DB calls.
import type { CatalogExercise, PlanExercise } from "../types";

const LEVEL_ORDER = ["beginner", "intermediate", "advanced", "expert"];

export interface DifficultySwapOutcome {
  exercises: PlanExercise[];
  swappedCount: number;
}

/** Difficulty tiers to try, nearest first, for one step in `direction` from `currentLevel`.
 * "up" from expert (or an unrecognized level) yields nothing — already at the top. "down" from
 * beginner falls back to another beginner-tier pick (same tier), since there's nothing lower —
 * matching the DB-backed findEasierExercise this replaces, which had the same fallback. */
function candidateTiers(currentLevel: string, direction: "up" | "down"): string[] {
  const idx = LEVEL_ORDER.indexOf(currentLevel);
  if (direction === "up") return LEVEL_ORDER.slice(idx + 1);
  const start = Math.max(idx - 1, 0);
  return LEVEL_ORDER.slice(0, start + 1).reverse();
}

/** For each exercise with a catalog id and a known catalog entry, try to swap it for a random
 * same-muscle exercise one-or-more tiers `direction` from its current difficulty, skipping ids
 * already used elsewhere in the day (own exercises included, so a day never gets a duplicate).
 * Exercises with no catalog id, no catalog entry, or no eligible candidate at any tier are kept
 * unchanged. */
export function pickDifficultySwaps(
  exercises: PlanExercise[],
  direction: "up" | "down",
  catalogByExerciseId: Map<string, CatalogExercise>,
  candidatesByMuscle: Map<string, CatalogExercise[]>,
  usedIds: Iterable<string>,
  rand: () => number = Math.random,
): DifficultySwapOutcome {
  const used = new Set(usedIds);
  let swappedCount = 0;
  const out: PlanExercise[] = [];
  for (const ex of exercises) {
    const catalog = ex.exerciseId ? catalogByExerciseId.get(ex.exerciseId) : undefined;
    if (!catalog) { out.push(ex); continue; }
    const currentLevel = catalog.difficulty ?? "beginner";
    const pool = candidatesByMuscle.get(catalog.muscle) ?? [];
    let swap: CatalogExercise | null = null;
    for (const level of candidateTiers(currentLevel, direction)) {
      const bucket = pool.filter((c) => (c.difficulty ?? "beginner") === level && !used.has(c.id));
      if (bucket.length) { swap = bucket[Math.floor(rand() * bucket.length)]; break; }
    }
    if (!swap) { out.push(ex); continue; }
    used.add(swap.id);
    swappedCount++;
    out.push({ ...ex, exerciseId: swap.id, canonicalName: swap.name, name: swap.name, technique: swap.instructions ?? ex.technique, muscles: swap.muscle });
  }
  return { exercises: out, swappedCount };
}
