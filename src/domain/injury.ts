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
  keywords: RegExp; // name match (EN+UK+RU) → direct conflict
  related: RegExp; // broader name match → related (swapped only on "strong")
  safeMuscles: string[]; // replacement pool (muscles that don't load the area)
}

// Shared pieces. Keywords are matched against the lower-cased name in English, Ukrainian and
// Russian. Short Latin words carry \b or a lookaround so they do not match inside another word
// ("run" in "crunch", "row" in "arrow", "dip" in "hip dip"); Cyrillic stems carry a negative
// context where the same stem names another body part ("розведення ніг", "нахилена лава").
const PRESS = String.raw`(?<!leg |calf )press|жим(?! ?(?:ног|платформ))`; // not leg/calf press
const ARM_CURL = String.raw`(?<!leg |nordic |hamstring )curl`; // not a leg curl
const SQUAT = "squat|присід|присед";
const LUNGE = "lunge|випад|выпад";
const JUMP = "jump|стрибк|прыжк";
const DEADLIFT = "deadlift|станов";
const DIP = String.raw`(?<!hip )\bdips?\b|бруся|брусь`;
const rx = (...parts: string[]) => new RegExp(parts.join("|"), "i");

const RULES: Record<InjuryArea, AreaRule> = {
  shoulder: {
    muscles: ["chest", "traps"],
    patterns: ["horizontal-push", "vertical-push"],
    keywords: rx(PRESS, "overhead|над головою|над головой|shoulder|плеч|дельт|розвед(?![а-яіїє]* ніг)|развед(?![а-яё]* ног)|lateral raise", DIP),
    related: /push|bench|fly|кросовер|кроссовер|crossover|pull-?up|підтяг|подтяг/i,
    safeMuscles: ["quadriceps", "hamstrings", "glutes", "calves", "abdominals"],
  },
  elbow: {
    muscles: ["biceps", "triceps"],
    // No movement pattern: "isolation" also names leg extensions and calf raises, so a mild elbow
    // injury swapped every isolation exercise in the plan.
    patterns: [],
    keywords: rx(ARM_CURL, "згинання рук|сгибание рук|triceps|трицепс|біцепс|бицепс|pushdown|розгинання рук|разгибание рук|extension.*arm|скотт|скручування рук"),
    related: rx(PRESS, DIP, "close.?grip|вузьк|узк"),
    safeMuscles: ["quadriceps", "hamstrings", "glutes", "calves", "abdominals"],
  },
  wrist: {
    muscles: ["forearms"],
    patterns: [],
    keywords: rx("wrist|зап'яст|запяст|forearm|передпліч|предплеч", ARM_CURL, "згинання рук|сгибание рук|grip|хват"),
    related: rx(PRESS, DEADLIFT, String.raw`\brow|тяга|pull|підтяг|подтяг`),
    safeMuscles: ["quadriceps", "hamstrings", "glutes", "calves", "abdominals"],
  },
  lower_back: {
    muscles: ["lower_back", "glutes", "hamstrings"],
    patterns: ["hinge", "squat"],
    // нахил(?!ен): a bent-over good morning, not an incline ("нахилена") bench.
    keywords: rx(DEADLIFT, "good.?morning|нахил(?!ен)|наклон(?!н)|hyperextension|гіперекстенз|гиперэкстенз|row.*barbell|тяга штанги", SQUAT, "romanian|румун|румын"),
    related: /\brow|тяга|bent.?over|clean|ривок|рывок|swing|мах/i,
    safeMuscles: ["chest", "lats", "biceps", "triceps", "calves", "quadriceps"],
  },
  knee: {
    muscles: ["quadriceps"],
    patterns: ["squat"],
    keywords: rx(SQUAT, LUNGE, "leg press|жим ног|leg extension|розгинання ніг|разгибание ног", JUMP, "step.?up|зашагуван|зашагиван"),
    related: /leg curl|згинання ніг|сгибание ног|hip thrust|місток|мостик|calf|литк|икр/i,
    safeMuscles: ["chest", "lats", "biceps", "triceps", "abdominals"],
  },
  hip: {
    muscles: ["glutes", "abductors", "adductors", "hamstrings"],
    patterns: ["hinge", "squat"],
    keywords: rx("hip thrust|місток|мостик", DEADLIFT, SQUAT, "abductor|adductor|відведення ніг|приведення ніг|отведение ног|приведение ног|привідн", LUNGE),
    related: /leg press|жим ног|good.?morning|нахил(?!ен)|наклон(?!н)|romanian|румун|румын/i,
    safeMuscles: ["chest", "lats", "biceps", "triceps", "abdominals"],
  },
  ankle: {
    muscles: ["calves"],
    patterns: ["calf"],
    keywords: rx("calf|литк|икр|на носки|на носк", JUMP, String.raw`\brun|біг|бег`, LUNGE, String.raw`\bbox\b(?! breath)|бокс`),
    related: rx(SQUAT, "leg press|жим ног"),
    safeMuscles: ["chest", "lats", "biceps", "triceps", "abdominals"],
  },
  neck: {
    muscles: ["traps", "neck"],
    patterns: [],
    keywords: /shrug|шраг|neck|шия|шея|upright row|тяга до підборіддя|тяга к подбородку|face pull|тяга.*обличчя|тяга.*лицу/i,
    related: rx(DEADLIFT, "overhead|над головою|над головой", PRESS),
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
interface ConflictSlot {
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
