// Injury / pain rules — pure, no DB. Maps a body area to the exercises that stress it (so we can
// swap them out) and the safe muscle pool to pull replacements from. Matching uses the catalog
// `muscle` enum + `PlanExercise.movementPattern` when present, with a bilingual name-keyword
// fallback (AI/legacy exercises often lack a pattern).

export type InjuryArea = "shoulder" | "elbow" | "wrist" | "lower_back" | "knee" | "hip" | "ankle" | "neck";
export type Severity = "mild" | "strong";

export const INJURY_AREAS: InjuryArea[] = ["shoulder", "elbow", "wrist", "lower_back", "knee", "hip", "ankle", "neck"];

export type ConflictLevel = "direct" | "related" | "none";

interface AreaRule {
  muscles: string[]; // catalog muscle enums directly loaded → direct conflict
  patterns: string[]; // movementPattern values that load the area → direct conflict
  keywords: RegExp; // name match (EN+UK) → direct conflict
  related: RegExp; // broader name match → related (swapped only on "strong")
  safeMuscles: string[]; // replacement pool (muscles that don't load the area)
}

const RULES: Record<InjuryArea, AreaRule> = {
  shoulder: {
    muscles: ["chest", "traps"],
    patterns: ["horizontal-push", "vertical-push"],
    // (?<!leg ) so "leg press" / "жим ногами" aren't read as shoulder work.
    keywords: /(?<!leg )press|жим(?! ?ног)|overhead|над головою|shoulder|плеч|дельт|розвед|lateral raise|розведення|dip|бруся/i,
    related: /push|bench|fly|кросовер|crossover|pull-?up|підтяг/i,
    safeMuscles: ["quadriceps", "hamstrings", "glutes", "calves", "abdominals"],
  },
  elbow: {
    muscles: ["biceps", "triceps"],
    patterns: ["isolation"],
    keywords: /curl|згинання рук|triceps|трицепс|біцепс|pushdown|розгинання рук|extension.*arm|скотт|скручування рук/i,
    related: /(?<!leg )press|жим(?! ?ног)|dip|бруся|close.?grip|вузьк/i,
    safeMuscles: ["quadriceps", "hamstrings", "glutes", "calves", "abdominals"],
  },
  wrist: {
    muscles: ["forearms"],
    patterns: [],
    keywords: /wrist|зап'яст|forearm|передпліч|curl|згинання рук|grip|хват/i,
    related: /(?<!leg )press|жим(?! ?ног)|deadlift|станов|row|тяга|pull|підтяг/i,
    safeMuscles: ["quadriceps", "hamstrings", "glutes", "calves", "abdominals"],
  },
  lower_back: {
    muscles: ["lower_back", "glutes", "hamstrings"],
    patterns: ["hinge", "squat"],
    keywords: /deadlift|станов|good.?morning|нахил|hyperextension|гіперекстенз|row.*barbell|тяга штанги|squat|присід|romanian|румун/i,
    related: /row|тяга|bent.?over|clean|ривок|swing|мах/i,
    safeMuscles: ["chest", "lats", "biceps", "triceps", "calves", "quadriceps"],
  },
  knee: {
    muscles: ["quadriceps"],
    patterns: ["squat"],
    keywords: /squat|присід|lunge|випад|leg press|жим ног|leg extension|розгинання ніг|jump|стрибк|step.?up|зашагуван/i,
    related: /leg curl|згинання ніг|hip thrust|місток|calf|литк/i,
    safeMuscles: ["chest", "lats", "biceps", "triceps", "abdominals"],
  },
  hip: {
    muscles: ["glutes", "abductors", "adductors", "hamstrings"],
    patterns: ["hinge", "squat"],
    keywords: /hip thrust|місток|deadlift|станов|squat|присід|abductor|adductor|відведення ніг|приведення ніг|привідн|lunge|випад/i,
    related: /leg press|жим ног|good.?morning|нахил|romanian|румун/i,
    safeMuscles: ["chest", "lats", "biceps", "triceps", "abdominals"],
  },
  ankle: {
    muscles: ["calves"],
    patterns: ["calf"],
    keywords: /calf|литк|на носки|jump|стрибк|run|біг|lunge|випад|box|бокс/i,
    related: /squat|присід|leg press|жим ног/i,
    safeMuscles: ["chest", "lats", "biceps", "triceps", "abdominals"],
  },
  neck: {
    muscles: ["traps", "neck"],
    patterns: [],
    keywords: /shrug|шраг|neck|шия|upright row|тяга до підборіддя|face pull|тяга.*обличчя/i,
    related: /deadlift|станов|overhead|над головою|(?<!leg )press|жим(?! ?ног)/i,
    safeMuscles: ["quadriceps", "hamstrings", "glutes", "calves", "biceps", "triceps"],
  },
};

/** How strongly an exercise loads an injured area. */
export function conflictScore(
  ex: { name: string; muscles?: string; movementPattern?: string },
  area: InjuryArea,
): ConflictLevel {
  const rule = RULES[area];
  const name = (ex.name || "").toLowerCase();
  const muscles = (ex.muscles || "").toLowerCase();
  const musclesHit = rule.muscles.some((m) => muscles.includes(m));
  const patternHit = !!ex.movementPattern && rule.patterns.includes(ex.movementPattern);
  if (rule.keywords.test(name) || musclesHit || patternHit) return "direct";
  if (rule.related.test(name)) return "related";
  return "none";
}

export interface ExerciseLike {
  name: string;
  muscles?: string;
  movementPattern?: string;
}
export interface ConflictSlot {
  weekday: number;
  index: number;
  exercise: ExerciseLike;
}

/**
 * Plan slots to swap for an injury. Mild → direct conflicts only; strong → direct + related.
 * `split` is the plan's day array; each day has `weekday` and `exercises`.
 */
export function conflictingSlots(
  split: { weekday: number; exercises: ExerciseLike[] }[],
  area: InjuryArea,
  severity: Severity,
): ConflictSlot[] {
  const out: ConflictSlot[] = [];
  for (const day of split) {
    day.exercises.forEach((ex, index) => {
      const score = conflictScore(ex, area);
      if (score === "direct" || (severity === "strong" && score === "related")) {
        out.push({ weekday: day.weekday, index, exercise: ex });
      }
    });
  }
  return out;
}

/** True if a catalog candidate is safe for the area (right muscle pool, doesn't load the area). */
export function isSafeCandidate(c: { name: string; muscle: string }, area: InjuryArea): boolean {
  const rule = RULES[area];
  if (!rule.safeMuscles.includes(c.muscle)) return false;
  const name = (c.name || "").toLowerCase();
  return !rule.keywords.test(name) && !rule.related.test(name);
}

export function safeMusclesFor(area: InjuryArea): string[] {
  return RULES[area].safeMuscles;
}

/** Follow-up date: mild recovers faster (7d) than strong (14d). */
export function checkAfterDate(dateStr: string, severity: Severity): string {
  const days = severity === "strong" ? 14 : 7;
  return new Date(Date.parse(dateStr) + days * 86_400_000).toISOString().slice(0, 10);
}

/** Can the original be restored — i.e. the slot still holds the replacement we put there. */
export function restorable(currentName: string | undefined, replacementCanonical: string): boolean {
  return !!currentName && currentName.trim().toLowerCase() === replacementCanonical.trim().toLowerCase();
}
