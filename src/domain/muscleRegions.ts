// The six training regions (chest, back, legs, shoulders, arms, core) as groups of the body map's
// muscles. Every region-level count -- the weekly volume list, strength groups, the bot's /volume
// -- reads exercises through exerciseMuscles.ts, the one set of recognition rules, so a name the
// body map knows is counted the same everywhere. Pure; test/analysis.test.ts, test/parsers.test.ts.
import { musclesForExercise, type Slug } from "./exerciseMuscles";

// The six regions as groups of the body map's muscles, so the list under the map and the map
// itself count the same sets. They used to run two separate classifiers: the map knew "Розведення
// гантелей у сторони лежачи на лаві" is a chest fly, the list read "розведення гантел" as a
// shoulder raise -- and the same week showed 7.5 chest sets on the map and 3 under it.
const REGION_OF: Partial<Record<Slug, MuscleGroup>> = {
  chest: "chest",
  "upper-back": "back", "lower-back": "back", trapezius: "back",
  quadriceps: "legs", hamstring: "legs", gluteal: "legs", calves: "legs", adductors: "legs", tibialis: "legs",
  deltoids: "shoulders",
  biceps: "arms", triceps: "arms", forearm: "arms",
  abs: "core", obliques: "core",
};

/** Sets an exercise adds to each region: 1 per set where it is a primary mover, ½ where it only
 *  assists (the body map's rule), counted once per region. */
export function regionSets(name: string, sets: number): Array<[MuscleGroup, number]> {
  const m = musclesForExercise(name);
  if (!m) return [];
  const share = new Map<MuscleGroup, number>();
  for (const slug of m.secondary) { const g = REGION_OF[slug]; if (g) share.set(g, Math.max(share.get(g) ?? 0, 0.5)); }
  for (const slug of m.primary) { const g = REGION_OF[slug]; if (g) share.set(g, 1); }
  return [...share].map(([g, k]) => [g, sets * k]);
}


/** The region an exercise mainly trains (its first primary mover), or null when unknown. */
export function regionOf(name: string): MuscleGroup | null {
  const m = musclesForExercise(name);
  for (const slug of m?.primary ?? []) { const g = REGION_OF[slug]; if (g) return g; }
  return null;
}

export type MuscleGroup = "legs" | "back" | "chest" | "shoulders" | "arms" | "core";
