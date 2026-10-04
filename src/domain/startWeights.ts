// Starting weights for a new plan. A generic number the person never chose ("Leg press 80 kg"
// for someone who has never trained) is worse than none: it reads as an instruction and is often
// unrealistic. So:
//  - a beginner gets "pick a weight" on loaded exercises their stated lifts don't cover — choose a load
//    that leaves 2–3 reps in reserve (RPE 7); the weekly progression then takes the weight they
//    actually logged and builds from there (domain/progression.ts treats the marker as loaded);
//  - someone who stated their lifts at onboarding ("bench 60, squat 80, deadlift 100", Ukrainian
//    or English, optionally "x5" reps) gets every related exercise calibrated from those numbers;
//  - anyone else keeps the plan's numbers, capped to a sane share of bodyweight for their level.
// Pure; test/start-weights.test.ts.
import { SELF_SELECT_WEIGHT } from "./equipmentFit";

export type Lift = "bench" | "squat" | "deadlift" | "ohp" | "row";
export type Baseline = Partial<Record<Lift, number>>; // estimated 1RM, kg

export function isSelfSelectWeight(s: string | undefined): boolean {
  return /підбер|подбер|pick a weight|choose a weight/i.test(s ?? "");
}

// Checked in this order so "жим стоячи" is the overhead press, not the bench, and "тяга в нахилі"
// is a row, not a deadlift.
const LIFT_WORDS: Array<[Lift, RegExp]> = [
  ["ohp", /жим\s*(штанги\s*)?(стоячи|сидячи|над\s*голов)|армійськ|армейск|overhead|\bohp\b|military|shoulder press/iu],
  ["row", /тяг\p{L}*\s*(штанги\s*)?в\s*нахил|тяга штанги|\brows?\b/iu],
  ["bench", /жим|bench/iu],
  ["squat", /присід|присед|squat/iu],
  // "тяга 120" is gym slang for the deadlift; pull-ups ("підтягування") and cable/dumbbell pulls
  // are not.
  ["deadlift", /станов|deadlift|\bdl\b|(?<!під)тяг(?!\p{L}*\s+(блок|верхн|нижн|горизонт|гантел|до\s))/iu],
];
// Lifts that share a word with the big ones but are not them ("жим ногами 150" is not a bench).
const NOT_A_BASELINE = /ногами|leg press|гакк|hack|тренажер|machine|гантел|dumbbell/iu;

/** "жим 60, присід 80х5, станова 100 кг" → estimated 1RMs. A number with reps uses Epley; a bare
 *  number is taken as a max (the conservative reading: the plan starts lighter, never heavier). */
export function parseBaselineLifts(text: string | undefined): Baseline {
  const out: Baseline = {};
  const t = (text ?? "").trim();
  if (!t || /^(none|ні|нема|немає|нет|no|-)$/i.test(t)) return out;
  for (const part of t.split(/[,;\n]+|\s(?:і|и|and)\s/i)) {
    if (NOT_A_BASELINE.test(part)) continue;
    const lift = LIFT_WORDS.find(([, re]) => re.test(part))?.[0];
    if (!lift || out[lift]) continue;
    const nums = part.match(/\d+(?:[.,]\d+)?/g);
    if (!nums) continue;
    const w = parseFloat(nums[0]!.replace(",", "."));
    const reps = nums[1] && /[x×х*]|на|по|раз|reps?/iu.test(part) ? parseInt(nums[1], 10) : 0;
    if (!(w >= 5 && w <= 400)) continue;
    out[lift] = reps > 1 && reps <= 15 ? w * (1 + reps / 30) : w;
  }
  return out;
}

type Family = { lift: Lift; ratio: number; dumbbell?: boolean };

const isDumbbell = (n: string) => /dumbbell|гантел/i.test(n);

/** Which stated lift an exercise follows, and at what share of its 1RM (per hand for dumbbells). */
export function familyOf(name: string): Family | null {
  const n = name.toLowerCase();
  const db = isDumbbell(n);
  if (/(fly|flye|розведен|curl|згинан|raise|махи|kickback|кікбек|розгинан|extension|pullover|пуловер|shrug|шраг)/u.test(n)) return null; // isolation: not inferable from a big lift
  if (/(overhead|military|shoulder press|arnold|арнольд|армійськ|жим\p{L}*\s.*(стоячи|сидячи|над голов))/u.test(n)) return { lift: "ohp", ratio: db ? 0.4 : 1, dumbbell: db };
  if (/(bench press|floor press|chest press|жим\p{L}*\s.*лежачи|жим лежачи|на підлозі)/u.test(n)) {
    const incline = /(incline|похил)/u.test(n) ? 0.85 : 1;
    const close = /(close|вузьк)/u.test(n) ? 0.9 : 1;
    return { lift: "bench", ratio: (db ? 0.37 : 1) * incline * close, dumbbell: db };
  }
  if (/(romanian|stiff|румунськ|на прямих ногах)/u.test(n)) return { lift: "deadlift", ratio: db ? 0.3 : 0.7, dumbbell: db };
  if (/(deadlift|станова тяга)/u.test(n)) return db ? { lift: "deadlift", ratio: 0.3, dumbbell: true } : { lift: "deadlift", ratio: 1 };
  if (/(bent over.*row|barbell row|тяга штанги в нахилі|тяга штанги)/u.test(n) && !db) return { lift: "row", ratio: 1 };
  if (/(dumbbell row|тяга гантел)/u.test(n)) return { lift: "row", ratio: 0.42, dumbbell: true };
  if (/(goblet|кубков)/u.test(n)) return { lift: "squat", ratio: 0.35, dumbbell: true };
  if (/(lunge|split squat|випад|спліт)/u.test(n)) return db ? { lift: "squat", ratio: 0.18, dumbbell: true } : { lift: "squat", ratio: 0.4 };
  if (/(leg press|жим ногами)/u.test(n)) return { lift: "squat", ratio: 1.5 };
  if (/(front squat|фронтальн)/u.test(n)) return { lift: "squat", ratio: 0.8 };
  if (/(squat|присідання|присід)/u.test(n) && !db && !/(bodyweight|без ваги|jump|стриб)/u.test(n)) return { lift: "squat", ratio: 1 };
  return null;
}

/** A stated lift the person didn't give, estimated from one they did (only the safe directions). */
function liftFor(lift: Lift, b: Baseline): number | undefined {
  if (b[lift]) return b[lift];
  if (lift === "ohp" && b.bench) return b.bench * 0.62;
  if (lift === "row" && b.bench) return b.bench * 0.75;
  return undefined;
}

function repsMid(sets: string): number {
  const m = /[x×х]\s*(\d+)(?:\s*[-–—]\s*(\d+))?/i.exec(sets || "");
  if (!m) return 8;
  const lo = parseInt(m[1]!, 10);
  const hi = m[2] ? parseInt(m[2], 10) : lo;
  return Math.max(1, Math.round((lo + hi) / 2));
}

/** Working weight for an exercise from the stated lifts, or undefined when it can't be inferred. */
export function weightFromBaseline(name: string, sets: string, b: Baseline): number | undefined {
  const fam = familyOf(name);
  if (!fam) return undefined;
  const oneRm = liftFor(fam.lift, b);
  if (!oneRm) return undefined;
  const reps = repsMid(sets);
  // Epley inverted, with ~10% held back so the first week leaves reps in reserve.
  const raw = (oneRm * fam.ratio) / (1 + reps / 30) * 0.9;
  const step = fam.dumbbell ? 2 : 2.5;
  return Math.max(step, Math.round(raw / step) * step);
}

// Ceiling for an uncalibrated number, as a share of bodyweight: [intermediate, advanced].
const CAPS: Array<[RegExp, [number, number]]> = [
  [/(deadlift|станова тяга)(?!.*(romanian|stiff|румун|прямих))/iu, [1.1, 1.6]],
  [/(leg press|жим ногами)/iu, [1.6, 2.2]],
  [/(squat|присідання|присід)/iu, [0.9, 1.3]],
  [/(romanian|stiff|румун|прямих ногах)/iu, [0.8, 1.2]],
  [/(overhead|military|shoulder press|армійськ|над голов|стоячи|сидячи)/iu, [0.45, 0.6]],
  [/(bench|жим)/iu, [0.7, 1.0]],
  [/(row|тяга)/iu, [0.6, 0.85]],
  [/(curl|згинан|raise|махи|розведен|fly|kickback|кікбек|розгинан|extension)/iu, [0.3, 0.45]],
];

function capFor(name: string, level: "intermediate" | "advanced", bodyweight: number): number | undefined {
  const hit = CAPS.find(([re]) => re.test(name));
  if (!hit) return undefined;
  const share = hit[1][level === "advanced" ? 1 : 0] * (isDumbbell(name) ? 0.4 : 1);
  return share * bodyweight;
}

function parseKg(s: string): number | undefined {
  if (/body|власн|bw\b/i.test(s)) return undefined;
  const m = /(\d+(?:[.,]\d+)?)/.exec(s);
  return m ? parseFloat(m[1]!.replace(",", ".")) : undefined;
}

export interface WeightProfile {
  level?: "beginner" | "intermediate" | "advanced";
  baselineLifts?: string;
  weightKg?: number;
}

/** Apply the rules above to a generated split (new arrays; input untouched). */
export function applyStartWeights<D extends { exercises: E[] }, E extends { name: string; canonicalName?: string; sets: string; startWeight: string; metric?: string }>(
  split: D[], profile: WeightProfile, lang: "uk" | "en",
): { split: D[]; calibrated: number; selfSelect: number; capped: number } {
  const baseline = parseBaselineLifts(profile.baselineLifts);
  const hasBaseline = Object.keys(baseline).length > 0;
  const beginner = (profile.level ?? "beginner") === "beginner";
  let calibrated = 0, selfSelect = 0, capped = 0;
  const out = split.map((day) => ({
    ...day,
    exercises: day.exercises.map((ex) => {
      if (ex.metric === "time" || ex.metric === "distance") return ex;
      const current = parseKg(ex.startWeight);
      const loaded = current !== undefined || isSelfSelectWeight(ex.startWeight);
      if (!loaded) return ex; // bodyweight / "—" stays as is
      const names = `${ex.canonicalName ?? ""} ${ex.name}`;
      const fromBaseline = hasBaseline ? weightFromBaseline(names, ex.sets, baseline) : undefined;
      if (fromBaseline !== undefined) { calibrated++; return { ...ex, startWeight: `${fromBaseline} kg` }; }
      if (beginner) { selfSelect++; return { ...ex, startWeight: SELF_SELECT_WEIGHT[lang] }; }
      if (current !== undefined && profile.weightKg && profile.level && profile.level !== "beginner") {
        const cap = capFor(names, profile.level, profile.weightKg);
        if (cap !== undefined && current > cap) {
          const step = isDumbbell(names) ? 2 : 2.5;
          capped++;
          return { ...ex, startWeight: `${Math.max(step, Math.floor(cap / step) * step)} kg` };
        }
      }
      return ex;
    }),
  }));
  return { split: out, calibrated, selfSelect, capped };
}

/**
 * After a session: every "pick a weight" exercise that was just logged with a load takes that
 * load as its plan weight, so the next session shows a real number and the weekly progression
 * builds from it. Matched by exact name (the logger saves under the plan's own name).
 */
export function adoptLoggedWeights<D extends { exercises: E[] }, E extends { name: string; canonicalName?: string; startWeight: string }>(
  split: D[], logged: Array<{ name: string; weight: number }>,
): { split: D[]; adopted: number } {
  const byName = new Map(logged.filter((l) => l.weight > 0).map((l) => [l.name.trim().toLowerCase(), l.weight]));
  let adopted = 0;
  const out = split.map((day) => ({
    ...day,
    exercises: day.exercises.map((ex) => {
      if (!isSelfSelectWeight(ex.startWeight)) return ex;
      const w = byName.get(ex.name.trim().toLowerCase()) ?? byName.get((ex.canonicalName ?? "").trim().toLowerCase());
      if (!w) return ex;
      adopted++;
      return { ...ex, startWeight: `${Number.isInteger(w) ? w : w.toFixed(1)} kg` };
    }),
  }));
  return { split: out, adopted };
}
