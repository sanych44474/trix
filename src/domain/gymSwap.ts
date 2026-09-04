// "Not my gym today" — pick a same-muscle substitute for every exercise in a session, filtered
// to what the user actually has on hand right now (bodyweight / dumbbells / a band). Purely a
// today's-session override: nothing here touches the stored plan, so tomorrow's session reverts
// on its own the same way the existing single-exercise on-the-fly swap already does.
export type EquipmentPreset = "bodyweight" | "dumbbells" | "band";

// Equipment tags in the catalog are free text from an external API ("Dumbbells", "dumbbell",
// "flat bench") — messy casing and singular/plural, so every check is lowercase substring, not
// an exact set match. An exercise with equipment fully covered by TRIVIAL_EQUIPMENT (a bench, a
// wall, a mat...) counts as bodyweight-compatible regardless of the chosen preset.
// Real tags are short phrases ("exercise mat", "flat bench", "sturdy chair"), not bare words —
// unanchored so "incline bench" and "wall" both count as trivial without needing every phrasing
// listed explicitly.
const TRIVIAL_EQUIPMENT = /\b(mat|wall|chair|floor|bench|box|towel|pillow|partner|step)s?\b/;
// Only consulted for dumbbells/band — bodyweight is decided entirely by the "no real equipment
// left" check in fitsEquipmentPreset below, so it has no entry here.
const PRESET_MATCH: Record<Exclude<EquipmentPreset, "bodyweight">, RegExp> = {
  dumbbells: /dumbbell/,
  band: /\bband\b/,
};

/** Does this exercise's equipment list fit inside what the preset makes available? */
export function fitsEquipmentPreset(equipments: string[], preset: EquipmentPreset): boolean {
  const nonTrivial = equipments.map((e) => e.toLowerCase().trim()).filter((e) => e && !TRIVIAL_EQUIPMENT.test(e));
  if (!nonTrivial.length) return true; // bodyweight-only exercise fits every preset
  if (preset === "bodyweight") return false; // has real equipment, bodyweight-only can't cover it
  return nonTrivial.every((e) => PRESET_MATCH[preset].test(e));
}

export interface GymSwapSlot {
  index: number;
  exerciseId?: string;
  muscle: string; // catalog muscle enum for THIS exercise, already resolved by the caller
}

export interface GymSwapCandidate {
  id: string;
  name: string;
  canonicalName?: string;
  equipments: string[];
}

/**
 * One substitute per slot, matched by muscle and filtered by preset. A slot with no fitting
 * candidate is left out of the result — the caller keeps that exercise as originally planned
 * rather than force a mismatched substitute onto it.
 */
export function pickGymSwaps(
  slots: GymSwapSlot[],
  candidatesByMuscle: Map<string, GymSwapCandidate[]>,
  preset: EquipmentPreset,
): Map<number, GymSwapCandidate> {
  const used = new Set<string>();
  const out = new Map<number, GymSwapCandidate>();
  for (const slot of slots) {
    const pool = (candidatesByMuscle.get(slot.muscle) ?? []).filter(
      (c) => c.id !== slot.exerciseId && !used.has(c.id) && fitsEquipmentPreset(c.equipments, preset),
    );
    if (!pool.length) continue;
    const pick = pool[0];
    used.add(pick.id);
    out.set(slot.index, pick);
  }
  return out;
}
