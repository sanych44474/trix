// Plate-loading & warm-up calculator — pure, no DB. Gym-standard kg plates per side and a
// percentage-based warm-up ramp toward a working weight.

// Standard kg plates, heaviest first. 1.25 is the smallest commonly available pair.
export const KG_PLATES = [25, 20, 15, 10, 5, 2.5, 1.25] as const;
export const DEFAULT_BAR = 20;

export interface PlatePlan {
  perSide: number[]; // plates to load on ONE side, heaviest first
  loaded: number; // the weight actually achievable (bar + plates)
  leftover: number; // kg that couldn't be matched by available plates (0 = exact)
}

/**
 * Greedy per-side plate breakdown for a target total. Returns the closest achievable load at or
 * below target plus any unmatched remainder. Returns null if the target is below the bar.
 */
export function platePlan(target: number, bar = DEFAULT_BAR, plates: readonly number[] = KG_PLATES): PlatePlan | null {
  if (target < bar) return null;
  let perSideKg = (target - bar) / 2;
  const perSide: number[] = [];
  for (const p of plates) {
    while (perSideKg >= p - 1e-9) {
      perSide.push(p);
      perSideKg -= p;
    }
  }
  const loaded = bar + perSide.reduce((a, b) => a + b, 0) * 2;
  const leftover = Math.round((target - loaded) * 100) / 100;
  return { perSide, loaded, leftover };
}

export interface WarmupSet {
  weight: number; // loadable weight (rounded to nearest achievable)
  reps: number;
  pct: number; // % of working weight (0 = empty bar)
}

/**
 * A percentage warm-up ramp toward a working weight: empty bar, then ~40/60/80%, each rounded to
 * the nearest achievable load. Light working weights (≤ bar) get a single empty-bar set.
 */
export function warmupRamp(workWeight: number, bar = DEFAULT_BAR, plates: readonly number[] = KG_PLATES): WarmupSet[] {
  if (!(workWeight > bar)) return [{ weight: bar, reps: 8, pct: 0 }];
  const round = (w: number) => {
    const p = platePlan(Math.max(bar, w), bar, plates);
    return p ? p.loaded : bar;
  };
  const steps: { pct: number; reps: number }[] = [
    { pct: 0, reps: 8 }, // empty bar
    { pct: 0.4, reps: 5 },
    { pct: 0.6, reps: 3 },
    { pct: 0.8, reps: 2 },
  ];
  const out: WarmupSet[] = [];
  for (const s of steps) {
    const weight = s.pct === 0 ? bar : round(workWeight * s.pct);
    // Skip a ramp step that isn't heavier than the previous one (avoids dupes on light loads).
    if (out.length && weight <= out[out.length - 1].weight) continue;
    out.push({ weight, reps: s.reps, pct: Math.round(s.pct * 100) });
  }
  return out;
}
