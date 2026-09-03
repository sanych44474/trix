import type {
  DaysBucket,
  ExperienceLevel,
  GoalBucket,
  PlanBankEntry,
  PlanBankKey,
  UserProfile,
} from "../types";

// Pure plan-bank selection: map a client profile to a bank key, then pick the best-matching
// pre-generated plan. No DB/AI here — the caller fetches candidate rows and passes them in.

/** Below this match score the caller should fall back to AI generation (no close archetype). */
export const MATCH_THRESHOLD = 0.6;

const FATLOSS = /(fat|схуд|похуд|loss|cut|lean|weight)/i;
const MUSCLE = /(muscle|муск|м['’]?яз|мас|mass|bulk|grow|гіпертроф|hypertroph)/i;
const STRENGTH = /(strength|сил|power|1rm|powerlift)/i;
const RECOMP = /(recomp|tone|тонус|підтрим|maintain|general|fitness|форм)/i;
// Endurance = runner / cyclist / swimmer / triathlete or generic "cardio" fitness goal.
// Distinct from fat-loss because progression is time/distance based, not scale weight.
const ENDURANCE = /(endurance|витрив|cardio|кардіо|бігун|біг\b|runn|марафон|marathon|5k|10k|21k|cycl|велосипед|велик|bike|swim|плав|triath|тріатл)/i;

/** Map a free-text/structured goal to one of the buckets the bank is keyed on. */
export function goalBucket(goal: string | undefined): GoalBucket {
  const g = (goal ?? "").toLowerCase();
  if (ENDURANCE.test(g)) return "endurance"; // check first: "bike" alone would miss elsewhere
  if (STRENGTH.test(g)) return "strength";
  if (MUSCLE.test(g)) return "muscle";
  if (FATLOSS.test(g)) return "fatloss";
  if (RECOMP.test(g)) return "recomp";
  return "recomp"; // safest default — balanced plan
}

/** Days/week → frequency bucket. Uses daysPerWeek, else the count of trainingWeekdays. */
export function daysBucket(profile: UserProfile): DaysBucket {
  const n = profile.daysPerWeek ?? profile.trainingWeekdays?.length ?? 3;
  if (n <= 3) return "d23";
  if (n === 4) return "d4";
  return "d56";
}

const HOME = /(home|вдома|дім|дома|bodyweight|власн|калістен|calisthen|no gym|без зал|dumbbell only|тільки гантел)/i;

/** Equipment text → gym vs home/minimal. */
export function equipmentBucket(profile: UserProfile): "gym" | "home" {
  return HOME.test(profile.equipment ?? "") ? "home" : "gym";
}

export function mapProfileToKey(profile: UserProfile): PlanBankKey {
  return {
    goal: goalBucket(profile.goal),
    level: profile.level ?? "beginner",
    daysBucket: daysBucket(profile),
    sex: profile.sex ?? "male",
    equipment: equipmentBucket(profile),
  };
}

// Ordinal scales for partial-credit (adjacent buckets score higher than far ones).
const LEVELS: ExperienceLevel[] = ["beginner", "intermediate", "advanced"];
const DAYS: DaysBucket[] = ["d23", "d4", "d56"];
function ordinalScore<T>(scale: T[], a: T, b: T): number {
  const ia = scale.indexOf(a);
  const ib = scale.indexOf(b);
  if (ia < 0 || ib < 0 || ia === ib) return ia === ib ? 1 : 0;
  return Math.max(0, 1 - Math.abs(ia - ib) / (scale.length - 1));
}

// Goal adjacency: recomp sits between fatloss and muscle, so partial credit between them.
// Endurance is closest to fat-loss (both favor caloric deficit + high work volume) and to
// recomp (general-fitness), less related to hypertrophy/strength.
const GOAL_NEIGHBORS: Record<GoalBucket, GoalBucket[]> = {
  fatloss: ["recomp", "endurance"],
  recomp: ["fatloss", "muscle", "endurance"],
  muscle: ["recomp", "strength"],
  strength: ["muscle"],
  endurance: ["fatloss", "recomp"],
};
function goalScore(a: GoalBucket, b: GoalBucket): number {
  if (a === b) return 1;
  return GOAL_NEIGHBORS[a]?.includes(b) ? 0.5 : 0;
}

const WEIGHTS = { goal: 0.3, level: 0.25, days: 0.2, equipment: 0.15, sex: 0.1 };

/** Match score in [0,1] between a target key and a bank entry. 1 = exact on all five dims. */
export function scoreEntry(key: PlanBankKey, e: PlanBankEntry): number {
  return (
    WEIGHTS.goal * goalScore(key.goal, e.goal) +
    WEIGHTS.level * ordinalScore(LEVELS, key.level, e.level) +
    WEIGHTS.days * ordinalScore(DAYS, key.daysBucket, e.daysBucket) +
    WEIGHTS.equipment * (key.equipment === e.equipment ? 1 : 0) +
    WEIGHTS.sex * (key.sex === e.sex ? 1 : 0)
  );
}

export interface BankMatch {
  entry: PlanBankEntry;
  score: number;
}

/**
 * Pick the best bank entry for a profile. Exact-key matches win and, when several exist
 * (variants), one is chosen deterministically by `seed` (e.g. userId) for variety. Otherwise
 * the highest-scoring nearest entry is returned. Null if `entries` is empty.
 */
export function selectBest(entries: PlanBankEntry[], profile: UserProfile, seed: number): BankMatch | null {
  if (!entries.length) return null;
  const key = mapProfileToKey(profile);
  const exact = entries.filter(
    (e) =>
      e.goal === key.goal &&
      e.level === key.level &&
      e.daysBucket === key.daysBucket &&
      e.sex === key.sex &&
      e.equipment === key.equipment,
  );
  if (exact.length) {
    exact.sort((a, b) => a.variant - b.variant);
    return { entry: exact[Math.abs(seed) % exact.length], score: 1 };
  }
  let best: BankMatch | null = null;
  for (const e of entries) {
    const score = scoreEntry(key, e);
    if (!best || score > best.score) best = { entry: e, score };
  }
  return best;
}
