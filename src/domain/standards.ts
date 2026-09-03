// Strength standards — pure, no DB. Maps a tracked lift to a strength-level bracket by comparing
// its estimated 1RM against bodyweight-multiple thresholds (sex-specific). The brackets are the
// widely used approximate ratios (untrained → elite); they're a motivational yardstick, not a
// medical/competition standard. Names are matched bilingually (EN + UK) against the big compounds.
import { resolveWeightMode } from "./progression";

export type StrengthLevel = "beginner" | "novice" | "intermediate" | "advanced" | "elite";

export const STRENGTH_LEVELS: StrengthLevel[] = ["beginner", "novice", "intermediate", "advanced", "elite"];

// Canonical lift keys we hold standards for.
export type LiftKey = "squat" | "bench" | "deadlift" | "ohp" | "row";

// Entry ratios (e1RM ÷ bodyweight) for each level, in STRENGTH_LEVELS order. A ratio at/above the
// elite entry is still "elite"; below the beginner entry floors to "beginner".
interface LiftStandard {
  key: LiftKey;
  // a name (lowercased) matches this lift when `match` hits and none of `exclude` do
  match: RegExp;
  exclude?: RegExp;
  male: [number, number, number, number, number];
  female: [number, number, number, number, number];
}

const STANDARDS: LiftStandard[] = [
  {
    key: "squat",
    match: /squat|присід|присед|приседан/i,
    exclude: /front|фронт|split|спліт|hack|гак|leg press|жим ног|болгар|bulgarian|goblet|гоблет/i,
    male: [0.75, 1.25, 1.5, 2.0, 2.5],
    female: [0.5, 0.75, 1.1, 1.5, 2.0],
  },
  {
    key: "bench",
    match: /bench|жим лежач|жим лёжа|жим лежа/i,
    exclude: /dumbbell|гантел|incline|нахил|похил|close[- ]?grip|вузьк/i,
    male: [0.5, 0.75, 1.0, 1.5, 2.0],
    female: [0.3, 0.5, 0.7, 1.0, 1.4],
  },
  {
    key: "deadlift",
    match: /deadlift|станов|тяга станов/i,
    exclude: /romanian|румун|rdl|stiff|прям|sumo dumbbell|trap|single/i,
    male: [1.0, 1.5, 2.0, 2.5, 3.0],
    female: [0.6, 1.0, 1.3, 1.8, 2.3],
  },
  {
    key: "ohp",
    match: /overhead press|military|standing press|shoulder press|жим стоячи|жим над головою|армійськ|військов|вертикальн.*жим/i,
    exclude: /dumbbell|гантел|seated|сидяч|machine|тренаж|arnold|арнольд/i,
    male: [0.35, 0.55, 0.8, 1.05, 1.3],
    female: [0.2, 0.35, 0.5, 0.7, 0.9],
  },
  {
    key: "row",
    match: /barbell row|bent[- ]?over row|pendlay|тяга штанги|тяга в нахил/i,
    exclude: /dumbbell|гантел|cable|блок|seated|machine|тренаж|т-?гриф|t[- ]?bar/i,
    male: [0.5, 0.75, 1.0, 1.25, 1.5],
    female: [0.3, 0.5, 0.65, 0.85, 1.1],
  },
];

/** Match a lift's display name (any language) to a known standard key, or null if not a tracked big lift. */
export function liftKeyOf(name: string): LiftKey | null {
  const n = name.toLowerCase();
  for (const s of STANDARDS) {
    if (s.match.test(n) && !(s.exclude && s.exclude.test(n))) return s.key;
  }
  return null;
}

export interface StandardResult {
  key: LiftKey;
  level: StrengthLevel;
  ratio: number; // e1RM ÷ bodyweight, rounded to 2 dp
  next?: StrengthLevel; // the level above (undefined at elite)
  nextTargetKg?: number; // bodyweight load needed to reach `next` (undefined at elite)
}

/**
 * Classify a lift's estimated 1RM into a strength bracket for the given sex & bodyweight.
 * Returns null when the lift isn't a tracked compound, or inputs are unusable.
 */
export function strengthStandard(
  name: string,
  sex: "male" | "female" | undefined,
  bodyweightKg: number,
  e1rmKg: number,
): StandardResult | null {
  // Per-limb / per-dumbbell loads aren't comparable to bilateral barbell standards — skip them
  // rather than rank a one-arm 60 kg against a two-arm bracket.
  if (resolveWeightMode(name) !== "total") return null;
  const key = liftKeyOf(name);
  if (!key || bodyweightKg <= 0 || e1rmKg <= 0) return null;
  const std = STANDARDS.find((s) => s.key === key)!;
  const thresholds = sex === "female" ? std.female : std.male;
  const ratio = e1rmKg / bodyweightKg;
  // Highest level whose entry threshold the ratio meets; floor at beginner.
  let idx = 0;
  for (let i = 0; i < thresholds.length; i++) {
    if (ratio >= thresholds[i]) idx = i;
  }
  const level = STRENGTH_LEVELS[idx];
  const result: StandardResult = { key, level, ratio: Math.round(ratio * 100) / 100 };
  if (idx < STRENGTH_LEVELS.length - 1) {
    result.next = STRENGTH_LEVELS[idx + 1];
    result.nextTargetKg = Math.round(thresholds[idx + 1] * bodyweightKg);
  }
  return result;
}
