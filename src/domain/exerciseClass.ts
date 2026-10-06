// Exercise classification: API muscle list, lower-body detection, how a weight is entered
// (total / per side / per hand) and the coarse muscle group of an exercise name.
import { regionOf, type MuscleGroup } from "./muscleRegions";

// API Ninjas muscle enums, ordered major/compound first so a candidate cap keeps the useful
// ones. Used to pull a broad real-exercise candidate set for plan generation (single-pass).
export const API_MUSCLES = [
  "chest", "lats", "quadriceps", "hamstrings", "glutes", "middle_back", "triceps", "biceps",
  "abdominals", "traps", "calves", "lower_back", "forearms", "abductors", "adductors", "neck",
] as const;

export const LOWER_HINTS = ["leg", "squat", "ногами", "ноги", "ніг", "присід", "присед", "deadlift", "становая", "станова", "lunge", "випад", "выпад", "hip thrust", "glute", "сідни", "ягодич", "calf", "ікр", "икр", "step-up", "step up", "good morning"];

/** Lower-body lift (bigger load step). The body map's region rules first, then name hints for
 *  what they file elsewhere (a deadlift counts as back there, but loads like a leg lift). */
export function isLowerBody(exercise: string): boolean {
  if (regionOf(exercise) === "legs") return true;
  const e = exercise.toLowerCase();
  return LOWER_HINTS.some((h) => e.includes(h));
}

/** Classify an exercise (UA or EN name) into a major training region, for the relative-strength
 * balance chart. Ordered so the specific patterns win before the generic "row/тяга" → back. */
export type WeightMode = "total" | "perSide" | "perHand";

// Resolve how a logged weight should be read: explicit tag wins; otherwise inferred from the
// name. "perSide" = one limb at a time (one-arm row, single-leg); "perHand" = one dumbbell in a
// two-dumbbell movement. The number itself is never transformed — this only labels/contextualizes.
export function resolveWeightMode(name: string, explicit?: "perSide" | "perHand"): WeightMode {
  if (explicit) return explicit;
  const s = (name || "").toLowerCase();
  // Unilateral: one arm / one leg at a time.
  if (/одн[іио][єe]ю рукою|одн[іио][єe]ю ногою|на одну руку|на одну ногу|поперем[іи]нн|поочеред|one[\s-]?arm|single[\s-]?arm|single[\s-]?leg|one[\s-]?leg|unilateral|\balternating\b/.test(s)) {
    return "perSide";
  }
  // Two dumbbells: the entered weight is per dumbbell (unless the name says otherwise).
  if (/гантел|dumbbell|\bdb\b/.test(s)) return "perHand";
  return "total";
}

/** The training region an exercise belongs to. Kept as the long-standing name; the rules are
 *  the body map's (muscleRegions.ts), so a region here always agrees with the map. */
export function muscleGroupOf(name: string): MuscleGroup | null {
  return regionOf(name);
}
