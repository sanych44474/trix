// Block periodization (mesocycles): an OVERLAY on the existing adaptive engine, not a rewrite.
// A plan optionally carries a block phase + week counter; the scheduler advances it weekly, the
// UI surfaces it, and AI plan-regen is told the target phase. The per-phase guidance below is
// what the coach/AI aims for — the concrete set/rep math stays in the progression engine.

export type MesoPhase = "hypertrophy" | "strength" | "peak" | "deload";

export interface Mesocycle {
  phase: MesoPhase;
  weekInBlock: number; // 1-based week within the current phase
  blockLength: number; // weeks per phase before advancing (deload is always 1 week)
}

// Classic linear order: build muscle → build strength → peak → unload → repeat.
const ORDER: MesoPhase[] = ["hypertrophy", "strength", "peak", "deload"];

export function defaultMesocycle(blockLength = 4): Mesocycle {
  return { phase: "hypertrophy", weekInBlock: 1, blockLength };
}

/** Advance one week. Returns the next state; deload lasts exactly one week regardless of
 * blockLength (an unload week, then back to hypertrophy). */
export function advanceMesocycle(m: Mesocycle): Mesocycle {
  const len = m.phase === "deload" ? 1 : Math.max(1, m.blockLength);
  if (m.weekInBlock < len) return { ...m, weekInBlock: m.weekInBlock + 1 };
  const next = ORDER[(ORDER.indexOf(m.phase) + 1) % ORDER.length];
  return { ...m, phase: next, weekInBlock: 1 };
}

/** Per-phase programming guidance — rep range, intensity cue, and an emoji for the UI. */
export function phaseGuidance(phase: MesoPhase): { reps: string; intensity: string; emoji: string } {
  switch (phase) {
    case "hypertrophy":
      return { reps: "8–12", intensity: "RPE 7–8", emoji: "🧱" };
    case "strength":
      return { reps: "3–6", intensity: "RPE 8–9", emoji: "🏋️" };
    case "peak":
      return { reps: "1–3", intensity: "RPE 9–10", emoji: "🔺" };
    case "deload":
      return { reps: "8–10", intensity: "RPE 5–6 (light)", emoji: "🌙" };
  }
}

/** i18n key for the phase name (both catalogs define meso_phase_*). */
export function phaseKey(phase: MesoPhase): string {
  return `meso_phase_${phase}`;
}
