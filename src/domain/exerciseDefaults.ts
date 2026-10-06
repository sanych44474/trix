// Pure exercise helpers: pulling an exercise name out of a message, dropping equipment words,
// default sets and start weight for a catalog exercise, and muscle-group enum mapping.
import type { CatalogExercise, ExerciseMetric } from "../types";
import { parseWorkoutText } from "./workoutText";

export function extractExerciseQuery(text: string): string {
  const trimmed = text.trim().replace(/\s+/g, " ");
  if (!trimmed) return trimmed;

  const parsed = parseWorkoutText(trimmed);
  if (parsed.length > 0 && parsed[0].exercise.trim()) {
    return parsed[0].exercise.trim();
  }

  const markers = [
    /\b\d+(?:[.,]\d+)?\s*[xх×•·]\s*\d+\b/iu,
    /\b\d+(?:[.,]\d+)?\s*(?:kg|кг)\b/iu,
    /\b\d+\s*підход[а-я]*\b/iu,
    /\b\d+\s*раз[а-я]*\b/iu,
    /\b(?:bw|bodyweight|власна|своя)\b/iu,
  ];
  let cut = trimmed.length;
  for (const re of markers) {
    const match = trimmed.match(re);
    if (match?.index !== undefined) cut = Math.min(cut, match.index);
  }
  return trimmed.slice(0, cut).replace(/[\s,;:–—•·-]+$/u, "").trim() || trimmed;
}

// Drop the implement/equipment qualifier so a movement matches regardless of dumbbell/kettlebell/
// barbell/machine — e.g. "goblet squat with dumbbell" / "присідання кубком з гантеллю" → "goblet squat".
export function stripEquipmentWords(s: string): string {
  return s
    .replace(/\b(?:dumbbells?|kettlebells?|barbells?|cable|machine|smith|resistance bands?|band|plate)\b/gi, " ")
    .replace(/\bз\s+(?:гантел\w*|гир\w*)\b/giu, " ")
    .replace(/\bзі?\s+штанг\w*\b/giu, " ")
    .replace(/\b(?:на|у|в)\s+тренажер\w*\b/giu, " ")
    .replace(/\b(?:with|using|on)\b/gi, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function defaultSetsForExercise(catalog: CatalogExercise): string {
  switch (catalog.difficulty) {
    case "expert":
      return "4 × 6-8";
    case "intermediate":
      return "4 × 8-10";
    default:
      return "3 × 10-12";
  }
}

export function defaultStartWeightForExercise(catalog: CatalogExercise): string {
  const eq = catalog.equipments.join(" ").toLowerCase();
  const bodyweightish = catalog.type?.toLowerCase().includes("bodyweight") || eq.includes("bodyweight");
  return bodyweightish ? "Bodyweight" : "—";
}

// Default sets string by metric: timed holds → seconds, cardio → duration, else reps by difficulty.
export function defaultSetsForMetric(metric: ExerciseMetric, catalog: CatalogExercise): string {
  if (metric === "time") return "3 × 30-45s";
  if (metric === "distance") return "10 min";
  return defaultSetsForExercise(catalog);
}

// Maps localized/English muscle group display names to catalog muscle enum values.
export function muscleGroupToEnum(group: string): string | null {
  const g = group.toLowerCase();
  const map: [string, string][] = [
    ["shoulder", "shoulders"], ["плеч", "shoulders"],
    ["chest", "chest"], ["груд", "chest"],
    ["back", "middle back"], ["спин", "middle back"],
    ["lat", "lats"], ["широч", "lats"],
    ["leg", "quadriceps"], ["квадр", "quadriceps"], ["ног", "quadriceps"],
    ["hamstr", "hamstrings"], ["підколін", "hamstrings"],
    ["glute", "glutes"], ["сідн", "glutes"],
    ["bicep", "biceps"], ["біцеп", "biceps"],
    ["tricep", "triceps"], ["трицеп", "triceps"],
    ["abs", "abdominals"], ["прес", "abdominals"], ["черев", "abdominals"],
    ["calf", "calves"], ["ікр", "calves"],
    ["trap", "traps"], ["трапец", "traps"],
    ["forearm", "forearms"], ["передпліч", "forearms"],
  ];
  for (const [key, val] of map) {
    if (g.includes(key)) return val;
  }
  return null;
}

// ============ Plan-day management: add / delete whole days ============
// Moved to bot/planDays.ts (god-file split); re-exported below so existing `from "./bot"`
// imports (router.ts) keep working.

// swapMenu/showSwapAlternatives/swapFromCatalog/showLogSwapAlternatives/showGymSwapPicker/
// applyGymSwap/logSwapFromCatalog/logBackToPick/startSwapCustom/swapExerciseByName/
// handleSwapCustom/setExerciseWeight/setExerciseSets/adjustDifficulty/openWeightEditor/
// openSetsEditor/selfEditDayKb/endSelfEdit moved to bot/planExerciseEdit.ts as one file (see
// its header comment for why they were not split further); re-exported below.

// showReorder/moveExercise/endReorder/selectExerciseWeight/selectExerciseSets/handleWeightEdit/
// handleSetsEdit moved to bot/planExerciseEdit.ts (same file, same reasons as the swap family).

// The guided per-exercise logger (LogDraft type, cmdLog/cmdLogPast/logPickExercise/logFinish,
// the exit guard, and the free-text switch) moved to bot/guidedLog.ts (god-file split; it was
// filed under the unrelated "Reorder exercises" banner). Re-exported below.
