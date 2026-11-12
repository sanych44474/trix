// What an athlete can say about automatic progression, and how it limits the engine's targets.
//
// A tester put it this way: his dumbbells stop at 30 kg, yet every session the app proposed 32,
// and he overrode it by hand each time. Two settings fix that:
//  - `auto: false` turns automatic increases off (weights and reps stay where the athlete put them);
//  - a per-exercise ceiling (`caps`): the heaviest load he has. Below it the engine still adds
//    load, but never past it; at it, it keeps adding reps instead of a load that does not exist.
//
// Pure. Stored in profile.progression (types.ts UserProfile); edited through POST /api/v2/settings
// (action "progression"); applied by nextTargetSet (today's target) and computePlanProgression
// (the weekly plan update).

import { gearFor } from "./equipmentFit";

/** The `caps` key for "every exercise that needs nothing but dumbbells" (one pair of dumbbells stops at 30 kg for all of them). */
export const DUMBBELL_CAP_KEY = "@dumbbell";

/** True when the exercise is done with dumbbells and nothing else (no barbell, bench rack, cable). */
export function isDumbbellOnly(name: string): boolean {
  const gear = gearFor(name);
  return gear.length === 1 && gear[0] === "dumbbell";
}

export interface ProgressionPrefs {
  /** false = no automatic increases at all. Absent or true = the engine decides, as before. */
  auto?: boolean;
  /** Heaviest load in kg per exercise, keyed by capKey(name). */
  caps?: Record<string, number>;
}

/** What the engine needs for one exercise. */
export interface Limits {
  auto?: boolean;
  /** Ceiling in kg for this exercise. */
  cap?: number;
  /** The ceiling comes from the all-dumbbell setting, not from this exercise's own. */
  shared?: boolean;
}

type Step = "hold" | "reps" | "load";
interface Target { weight: number; reps: number; step: Step }

export const MAX_CAPS = 60;
export const MAX_CAP_KG = 1000;
const NAME_MAX = 80;

/** One key for every spelling of an exercise name ("Dumbbell Press", " dumbbell  press "). */
export function capKey(name: string): string {
  return name.toLowerCase().replace(/\s+/g, " ").trim().slice(0, NAME_MAX);
}

/** The limits that apply to an exercise, trying each name it is known by (its own and the catalog's). */
export function limitsFor(prefs: ProgressionPrefs | undefined, ...names: Array<string | undefined>): Limits {
  if (!prefs) return {};
  const limits: Limits = {};
  if (prefs.auto === false) limits.auto = false;
  for (const n of names) {
    const cap = n ? prefs.caps?.[capKey(n)] : undefined;
    if (typeof cap === "number" && cap > 0) { limits.cap = cap; break; }
  }
  // No ceiling of its own: the one for all-dumbbell work applies. An exercise's own ceiling wins.
  const shared = prefs.caps?.[DUMBBELL_CAP_KEY];
  if (limits.cap === undefined && typeof shared === "number" && shared > 0 && names.some((n) => n && isDumbbellOnly(n))) {
    limits.cap = shared;
    limits.shared = true;
  }
  return limits;
}

/** Stored value from anything the client sent: only known fields, sane numbers, bounded size. */
export function sanitizeProgression(input: unknown): ProgressionPrefs {
  const src = (input && typeof input === "object" ? input : {}) as { auto?: unknown; caps?: unknown };
  const out: ProgressionPrefs = {};
  if (src.auto === false) out.auto = false;
  if (src.caps && typeof src.caps === "object") {
    const caps: Record<string, number> = {};
    for (const [name, kg] of Object.entries(src.caps as Record<string, unknown>)) {
      const key = capKey(name);
      const n = typeof kg === "number" ? kg : NaN;
      if (key && Number.isFinite(n) && n > 0 && n <= MAX_CAP_KG && Object.keys(caps).length < MAX_CAPS) caps[key] = Math.round(n * 2) / 2;
    }
    if (Object.keys(caps).length) out.caps = caps;
  }
  return out;
}

/** Set (kg) or clear (null) one exercise's ceiling. Returns null when the value is not usable. */
export function withCap(prefs: ProgressionPrefs | undefined, exercise: string, kg: number | null): ProgressionPrefs | null {
  const key = capKey(exercise);
  if (!key) return null;
  const caps = { ...(prefs?.caps ?? {}) };
  if (kg === null) delete caps[key];
  else {
    if (!Number.isFinite(kg) || kg <= 0 || kg > MAX_CAP_KG) return null;
    if (!(key in caps) && Object.keys(caps).length >= MAX_CAPS) return null;
    caps[key] = Math.round(kg * 2) / 2;
  }
  return sanitizeProgression({ ...prefs, caps });
}

/**
 * The engine's next target, limited by the athlete's settings.
 *  - auto off: hold exactly what was done.
 *  - a load step past the ceiling: land on the ceiling if it is still above the current load; if
 *    the athlete is already at (or above) it, stay there and add reps instead, with no reset to
 *    the bottom of the rep range, because there is no heavier weight to earn it back with.
 * `easy` mirrors the engine's double step on a clearly easy session.
 */
export function limitTarget(next: Target, best: { weight: number; reps: number }, limits: Limits | undefined, easy = false): Target {
  if (!limits) return next;
  if (limits.auto === false) return { weight: best.weight, reps: best.reps, step: "hold" };
  const cap = limits.cap;
  if (cap !== undefined && next.step === "load" && next.weight > cap) {
    if (best.weight >= cap) return { weight: best.weight, reps: best.reps + (easy ? 2 : 1), step: "reps" };
    return { ...next, weight: cap };
  }
  return next;
}
