import type { DaysBucket, ExperienceLevel, GoalBucket, Lang } from "../types";

// Hand-authored coaching "cores" for the pre-generated plan bank. This encodes the programming
// IP — split design, per-slot muscle/movement-pattern targets, and set/rep/RPE schemes by goal
// and level — that the expander (scripts/build-plan-bank.ts) turns into 144 concrete, catalog-
// grounded plans. Pure data + helpers; imports only from types.ts so the expander can load it
// under tsx with no Worker dependencies.
//
// NOTE on muscles: the API-Ninjas catalog enum has NO "shoulders" muscle, so vertical/overhead
// pushing is grounded under "chest" (where overhead/incline presses are catalogued). Patterns
// are advisory metadata; the muscle drives the catalog pick.

export type Muscle =
  | "chest" | "lats" | "middle_back" | "traps" | "biceps" | "triceps" | "forearms" | "shoulders"
  | "quadriceps" | "hamstrings" | "glutes" | "calves" | "abdominals" | "lower_back" | "abductors";

export type Pattern =
  | "squat" | "hinge" | "horizontal-push" | "vertical-push" | "horizontal-pull"
  | "vertical-pull" | "core" | "calf" | "isolation";

export interface Slot {
  muscle: Muscle;
  role: "primary" | "accessory";
  pattern: Pattern;
}

export interface DayTemplate {
  labelKey: DayLabel;
  sessionType: string; // strength|hypertrophy|hybrid|...
  slots: Slot[];
}

export type DayLabel =
  | "full_body" | "upper" | "lower" | "push" | "pull" | "legs";

// ---- Day templates (5–6 working slots each; warm-up/cool-down are separate) ----

const FB1: DayTemplate = { labelKey: "full_body", sessionType: "hybrid", slots: [
  { muscle: "quadriceps", role: "primary", pattern: "squat" },
  { muscle: "chest", role: "primary", pattern: "horizontal-push" },
  { muscle: "lats", role: "primary", pattern: "vertical-pull" },
  { muscle: "hamstrings", role: "accessory", pattern: "hinge" },
  { muscle: "abdominals", role: "accessory", pattern: "core" },
  { muscle: "calves", role: "accessory", pattern: "calf" },
]};
const FB2: DayTemplate = { labelKey: "full_body", sessionType: "hybrid", slots: [
  { muscle: "hamstrings", role: "primary", pattern: "hinge" },
  { muscle: "chest", role: "primary", pattern: "horizontal-push" },
  { muscle: "middle_back", role: "primary", pattern: "horizontal-pull" },
  { muscle: "quadriceps", role: "accessory", pattern: "squat" },
  { muscle: "triceps", role: "accessory", pattern: "isolation" },
  { muscle: "abdominals", role: "accessory", pattern: "core" },
]};
const FB3: DayTemplate = { labelKey: "full_body", sessionType: "hybrid", slots: [
  { muscle: "glutes", role: "primary", pattern: "hinge" },
  { muscle: "chest", role: "primary", pattern: "vertical-push" },
  { muscle: "lats", role: "primary", pattern: "vertical-pull" },
  { muscle: "quadriceps", role: "accessory", pattern: "squat" },
  { muscle: "biceps", role: "accessory", pattern: "isolation" },
  { muscle: "abdominals", role: "accessory", pattern: "core" },
]};
const UPPER1: DayTemplate = { labelKey: "upper", sessionType: "hypertrophy", slots: [
  { muscle: "chest", role: "primary", pattern: "horizontal-push" },
  { muscle: "lats", role: "primary", pattern: "vertical-pull" },
  { muscle: "chest", role: "accessory", pattern: "vertical-push" },
  { muscle: "middle_back", role: "accessory", pattern: "horizontal-pull" },
  { muscle: "triceps", role: "accessory", pattern: "isolation" },
  { muscle: "biceps", role: "accessory", pattern: "isolation" },
]};
const UPPER2: DayTemplate = { labelKey: "upper", sessionType: "hypertrophy", slots: [
  { muscle: "chest", role: "primary", pattern: "vertical-push" },
  { muscle: "middle_back", role: "primary", pattern: "horizontal-pull" },
  { muscle: "chest", role: "accessory", pattern: "horizontal-push" },
  { muscle: "lats", role: "accessory", pattern: "vertical-pull" },
  { muscle: "biceps", role: "accessory", pattern: "isolation" },
  { muscle: "triceps", role: "accessory", pattern: "isolation" },
]};
const LOWER1: DayTemplate = { labelKey: "lower", sessionType: "hypertrophy", slots: [
  { muscle: "quadriceps", role: "primary", pattern: "squat" },
  { muscle: "hamstrings", role: "primary", pattern: "hinge" },
  { muscle: "glutes", role: "accessory", pattern: "isolation" },
  { muscle: "calves", role: "accessory", pattern: "calf" },
  { muscle: "abdominals", role: "accessory", pattern: "core" },
]};
const LOWER2: DayTemplate = { labelKey: "lower", sessionType: "hypertrophy", slots: [
  { muscle: "hamstrings", role: "primary", pattern: "hinge" },
  { muscle: "quadriceps", role: "primary", pattern: "squat" },
  { muscle: "glutes", role: "accessory", pattern: "isolation" },
  { muscle: "abductors", role: "accessory", pattern: "isolation" },
  { muscle: "calves", role: "accessory", pattern: "calf" },
]};
const PUSH: DayTemplate = { labelKey: "push", sessionType: "hypertrophy", slots: [
  { muscle: "chest", role: "primary", pattern: "horizontal-push" },
  { muscle: "chest", role: "primary", pattern: "vertical-push" },
  { muscle: "shoulders", role: "accessory", pattern: "isolation" }, // side delts (lateral raise)
  { muscle: "chest", role: "accessory", pattern: "isolation" },
  { muscle: "triceps", role: "accessory", pattern: "isolation" },
]};
const PULL: DayTemplate = { labelKey: "pull", sessionType: "hypertrophy", slots: [
  { muscle: "lats", role: "primary", pattern: "vertical-pull" },
  { muscle: "middle_back", role: "primary", pattern: "horizontal-pull" },
  { muscle: "shoulders", role: "accessory", pattern: "isolation" }, // rear delts / face pull
  { muscle: "biceps", role: "accessory", pattern: "isolation" },
  { muscle: "traps", role: "accessory", pattern: "isolation" },
]};
const LEGS: DayTemplate = { labelKey: "legs", sessionType: "hypertrophy", slots: [
  { muscle: "quadriceps", role: "primary", pattern: "squat" },
  { muscle: "hamstrings", role: "primary", pattern: "hinge" },
  { muscle: "glutes", role: "accessory", pattern: "isolation" },
  { muscle: "calves", role: "accessory", pattern: "calf" },
  { muscle: "abdominals", role: "accessory", pattern: "core" },
]};

const LOWER_LABELS = new Set<DayLabel>(["lower", "legs", "full_body"]);

/** Split skeleton for a frequency bucket. For women, lower/leg/full-body days get an extra
 * glute accessory (up to 6 slots) — more posterior-chain volume. */
export function splitFor(bucket: DaysBucket, sex: "male" | "female"): DayTemplate[] {
  const base: DayTemplate[] =
    bucket === "d23" ? [FB1, FB2, FB3]
    : bucket === "d4" ? [UPPER1, LOWER1, UPPER2, LOWER2]
    : [PUSH, PULL, LEGS, PUSH, PULL, LEGS];
  if (sex !== "female") return base.map((d) => ({ ...d, slots: [...d.slots] }));
  return base.map((d) => {
    const slots = [...d.slots];
    if (LOWER_LABELS.has(d.labelKey) && slots.length < 6 && !slots.some((s) => s.muscle === "glutes")) {
      slots.push({ muscle: "glutes", role: "accessory", pattern: "isolation" });
    }
    return { ...d, slots };
  });
}

// ---- Set / rep / RPE schemes ----

export interface SetScheme {
  sets: string;        // "4 × 8-12"
  rpe: string;
  rir: string;
  rest: string;
  repMin: number;
  repMax: number;
}

const GOAL_SCHEME: Record<GoalBucket, { p: [number, number, number, string]; a: [number, number, number, string]; repP: [number, number]; repA: [number, number] }> = {
  // [sets, rpe, rir, rest]
  strength: { p: [5, 8, 2, "3 min"], a: [3, 7, 3, "2 min"], repP: [3, 5], repA: [6, 8] },
  muscle:   { p: [4, 8, 2, "2-3 min"], a: [3, 8, 1, "75s"], repP: [6, 10], repA: [10, 15] },
  recomp:   { p: [4, 7, 3, "2 min"], a: [3, 7, 2, "75s"], repP: [6, 10], repA: [10, 12] },
  fatloss:  { p: [3, 7, 3, "90s"], a: [3, 7, 2, "60s"], repP: [8, 12], repA: [12, 15] },
  // Endurance archetypes rarely go through the strength expander (endurance plans favor the AI
  // path with cardio-focused days) but we still need a scheme so setScheme() is total. Low sets,
  // low RPE — the one strength day in an endurance week is injury-prevention, not hypertrophy.
  endurance: { p: [3, 7, 3, "2 min"], a: [2, 6, 4, "90s"], repP: [5, 8], repA: [10, 12] },
};

export function setScheme(goal: GoalBucket, level: ExperienceLevel, role: "primary" | "accessory"): SetScheme {
  const g = GOAL_SCHEME[goal];
  const [baseSets, baseRpe, rir, rest] = role === "primary" ? g.p : g.a;
  const [repMin, repMax] = role === "primary" ? g.repP : g.repA;
  let sets = baseSets;
  let rpe = baseRpe;
  if (level === "beginner") { sets = Math.max(2, sets - 1); rpe = Math.max(6, rpe - 1); }
  else if (level === "advanced" && role === "primary") { sets = sets + 1; }
  return { sets: `${sets} × ${repMin}-${repMax}`, rpe: String(rpe), rir: String(rir), rest, repMin, repMax };
}

// ---- Preferred exercise selection (best-practice picks, in priority order) ----
//
// For each (pattern, muscle, role) the expander tries these canonical movements in order and
// uses the first one present in the catalog (respecting the client's equipment/level). This is
// what makes the bank read like a real coach wrote it: primaries are proper barbell/dumbbell
// compounds in the textbook order (squat/bench/deadlift/row/press/pulldown), accessories are
// the standard isolations — never a gimmick movement. Home users skip the barbell entries
// automatically (filtered out of the pool) and land on the dumbbell/bodyweight variant.

// Fragments are tuned to the ACTUAL catalog names (API-Ninjas dataset). Listed best-practice
// first; the expander returns the first fragment that matches, preferring the cleanest (exact /
// shortest) variant of that fragment. Home users skip barbell entries automatically.
const PRIMARY_PREFERRED: Partial<Record<Pattern, Partial<Record<Muscle, string[]>>>> = {
  squat: { quadriceps: ["Barbell Full Squat", "Olympic Squat", "Barbell back squat", "Front Squats", "Single-Leg Press", "Kettlebell Pistol Squat", "Forward lunge"] },
  hinge: {
    hamstrings: ["Romanian Deadlift", "Barbell Deadlift", "Stiff-Legged Dumbbell Deadlift", "Sumo deadlift", "Clean Deadlift"],
    glutes: ["Barbell Hip Thrust", "Barbell glute bridge", "Glute bridge", "Standing hip extension", "Pull Through"],
  },
  "horizontal-push": { chest: ["Barbell Bench Press", "Dumbbell Bench Press", "Barbell Incline Bench Press", "Incline dumbbell bench press", "Wide-grip bench press", "Pushups", "Chest dip"] },
  "vertical-push": { chest: ["Seated Dumbbell Shoulder Press", "Push-press", "Standing dumbbell upright row"] },
  "vertical-pull": { lats: ["Pull-up", "Chin-Up", "Close-Grip Front Lat Pulldown", "Close-grip pull-down", "Wide-Grip Rear Pull-Up", "Machine seated row"] },
  "horizontal-pull": { middle_back: ["Bent Over Two-Arm Long Bar Row", "T-Bar Row", "Yates Row", "One-Arm Dumbbell Row", "Seated Cable Rows", "Reverse-grip bent-over row"] },
};

const ACCESSORY_PREFERRED: Partial<Record<Muscle, string[]>> = {
  chest: ["Dumbbell Flyes", "Cable Crossover", "Incline dumbbell bench press", "Chest dip", "Low-cable cross-over", "Pushups"],
  lats: ["Close-Grip Front Lat Pulldown", "Close-grip pull-down", "Single-arm kneeling lat pull-down", "Straight-arm cable pull-over", "Machine seated row"],
  middle_back: ["Seated Cable Rows", "One-Arm Dumbbell Row", "Incline dumbbell row", "Plate Row", "Leverage High Row"],
  shoulders: ["Dumbbell Lateral Raise", "Cable Face Pull", "Front Dumbbell Raise", "Standing Cable Face Pull"],
  traps: ["Leverage Shrug", "Smith machine shrug", "Standing dumbbell upright row", "Dumbbell pull-over"],
  biceps: ["Barbell Curl", "Dumbbell Bicep Curl", "Hammer Curls", "Preacher Curl", "Concentration curl", "EZ-Bar Curl"],
  triceps: ["Triceps Pushdown", "EZ-Bar Skullcrusher", "Seated triceps press", "Triceps dip", "Decline Dumbbell Triceps Extension", "Dumbbell floor press"],
  forearms: ["Wrist Curl", "Reverse Curl", "Plate Pinch"],
  quadriceps: ["Leg Extension", "Barbell walking lunge", "Forward lunge", "Single-Leg Press"],
  hamstrings: ["Lying Leg Curls", "Seated Band Hamstring Curl", "Exercise ball leg curl", "Natural Glute Ham Raise"],
  glutes: ["Glute Kickback", "Glute bridge", "Single-leg cable hip extension", "Standing hip extension", "Barbell Hip Thrust"],
  calves: ["Standing Calf Raises", "Standing Dumbbell Calf Raise", "Seated Calf Raise", "Calf Press", "Standing barbell calf raise"],
  abdominals: ["Elbow plank", "Cross-Body Crunch", "Elbow-to-knee crunch", "Plate Twist", "Standing cable low-to-high twist"],
  abductors: ["Hip Abduction", "Standing hip extension", "Single-leg cable hip extension"],
};

/** Ordered list of preferred exercise-name fragments for a slot, best-practice first. */
export function preferredNames(slot: Slot): string[] {
  if (slot.role === "primary") {
    return PRIMARY_PREFERRED[slot.pattern]?.[slot.muscle] ?? ACCESSORY_PREFERRED[slot.muscle] ?? [];
  }
  return ACCESSORY_PREFERRED[slot.muscle] ?? [];
}

// Vertical pressing isn't in the catalog under "chest" — the API enum has no shoulders muscle,
// so overhead presses live under "shoulders". The expander widens the candidate pool for that
// pattern. Returned muscles are searched in order.
export function poolMusclesFor(slot: Slot): string[] {
  if (slot.pattern === "vertical-push") return ["shoulders", "chest", "triceps"];
  return [slot.muscle];
}

// Gimmick / partner / non-serious movements a pro would never program — excluded from the pool.
export const QUALITY_BLOCKLIST = /russian|partner|with manual resistance|with throw|throw down|high-five|spell caster|gorilla|cocoons|bottoms up|fyr |\bhm \b|spider crawl|fall-out|get-up sit-up/i;

/** Daily NEAT steps target by lifestyle (the AI plan uses the same bands). */
export function stepsTarget(lifestyle: string | undefined): number {
  if (lifestyle === "sedentary") return 9000;
  if (lifestyle === "active") return 6000;
  return 7500;
}

// ---- Localized structural text (no runtime translation) ----

export const DAY_LABEL: Record<DayLabel, Record<Lang, string>> = {
  full_body: { en: "Full Body", uk: "Все тіло" },
  upper: { en: "Upper Body", uk: "Верх тіла" },
  lower: { en: "Lower Body", uk: "Низ тіла" },
  push: { en: "Push (Chest/Triceps)", uk: "Жим (Груди/Трицепс)" },
  pull: { en: "Pull (Back/Biceps)", uk: "Тяга (Спина/Біцепс)" },
  legs: { en: "Legs", uk: "Ноги" },
};

export const WARMUP: Record<Lang, string[]> = {
  en: ["5 min easy cardio (bike/row) Z2", "dynamic mobility for the day's joints", "2 light ramp-up sets on the first lift"],
  uk: ["5 хв легке кардіо (велотренажер/гребля) Z2", "динамічна мобілізація суглобів дня", "2 розминкові підходи на першій вправі"],
};
export const COOLDOWN: Record<Lang, string[]> = {
  en: ["3-5 min easy walk", "static stretch the trained muscles 20-30s each"],
  uk: ["3-5 хв спокійна ходьба", "статична розтяжка опрацьованих м'язів по 20-30с"],
};

export const METHODOLOGY: Record<GoalBucket, Record<Lang, string>> = {
  strength: {
    en: "Train the key lifts with double progression: add reps to the top of the range, then add 2.5kg (upper) / 5kg (lower) and reset to the bottom. Keep primaries at RPE 8 (2 reps in reserve), accessories lighter. Deload every 6-8 weeks. Track key-lift loads weekly.",
    uk: "Тренуй базові вправи за подвійною прогресією: додавай повтори до верху діапазону, потім +2.5кг (верх) / +5кг (низ) і починай з нижньої межі. Базові — RPE 8 (2 повтори в запасі), підсобні легше. Розвантаження кожні 6-8 тижнів. Веди облік ваг щотижня.",
  },
  muscle: {
    en: "Drive hypertrophy with double progression in the 6-15 rep range at RPE 8, controlled tempo, and short rests on accessories. Add a set or small load each week you hit the top of the range. Eat in a slight surplus, prioritise protein, deload every 6-8 weeks.",
    uk: "Нарощуй м'язи за подвійною прогресією в діапазоні 6-15 повторів при RPE 8, контрольований темп, короткий відпочинок на підсобці. Додавай підхід або невелику вагу щотижня, коли досягаєш верху діапазону. Невеликий профіцит калорій, пріоритет білку, розвантаження кожні 6-8 тижнів.",
  },
  recomp: {
    en: "Balance strength and conditioning at RPE 7-8 with autoregulation — push hard on good days, hold back when recovery is low. Keep protein high at maintenance calories. Progress loads gradually; deload every 6-8 weeks.",
    uk: "Поєднуй силу та кондицію при RPE 7-8 з ауторегуляцією — викладайся у хороші дні, стримуйся при поганому відновленні. Тримай білок високим при підтримуючих калоріях. Прогресуй ваги поступово; розвантаження кожні 6-8 тижнів.",
  },
  fatloss: {
    en: "Preserve muscle in a calorie deficit: keep loads moderate-high at RPE 7, higher reps, short rests, plus the weekly NEAT steps target and at least one Z2 cardio session. Don't chase failure — maintain strength while the deficit does the fat loss. Deload every 6-8 weeks.",
    uk: "Зберігай м'язи в дефіциті калорій: тримай ваги помірно-високими при RPE 7, більше повторів, короткий відпочинок, плюс тижнева ціль кроків (NEAT) і щонайменше одне кардіо Z2. Не женися за відмовою — підтримуй силу, а жир спалює дефіцит. Розвантаження кожні 6-8 тижнів.",
  },
  endurance: {
    en: "Polarised endurance: 80% easy Z2 (aerobic base, nasal breathing), 20% quality (intervals Z4-Z5 or tempo Z3). Progress weekly volume ~10%, hold a down week every 4th. Keep 1 short strength day at RPE 6-7 for injury prevention. Fuel long sessions with carbs; protein 1.4-1.8 g/kg.",
    uk: "Поляризована витривалість: 80% легко Z2 (аеробна база, носове дихання), 20% якість (інтервали Z4-Z5 або темп Z3). Нарощуй тижневий обʼєм ~10%, розвантажний тиждень кожен 4-й. Тримай 1 коротку силову за RPE 6-7 для профілактики травм. Довгі сесії — з вуглеводами; білок 1.4-1.8 г/кг.",
  },
};

export const MOVEMENT_AUDIT: Record<Lang, string> = {
  en: "Weekly coverage: squat, hinge, horizontal & vertical push, horizontal & vertical pull, core. Push:pull balance ≥ 1:1.",
  uk: "Тижневе покриття: присід, нахил (hinge), горизонтальні та вертикальні жими, горизонтальні та вертикальні тяги, кор. Баланс жим:тяга ≥ 1:1.",
};
