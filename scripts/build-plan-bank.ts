// Expander/seed generator for the pre-generated plan bank (migrations/0017_plan_bank.sql).
// Reads the cached `exercises` catalog + UK translations from REMOTE D1 (read-only), applies
// the hand-authored archetypes (src/domain/planArchetypes.ts) to ground every slot in a real
// catalog exercise, and writes ~144 INSERT rows — each a bilingual (EN+UK) PlanDoc with zero
// AI involvement. Run with tsx, then review and apply:
//
//   $env:CLOUDFLARE_API_TOKEN="..."; node --import tsx scripts/build-plan-bank.ts
//   # review the appended INSERTs, then (needs approval):
//   npx wrangler d1 execute trix --local  --file migrations/0017_plan_bank.sql
//   npx wrangler d1 execute trix --remote --file migrations/0017_plan_bank.sql
//
// Deterministic: no Math.random / Date in the plan content (createdAt is a fixed marker).

import { execSync } from "node:child_process";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import {
  COOLDOWN, DAY_LABEL, METHODOLOGY, MOVEMENT_AUDIT, poolMusclesFor, preferredNames,
  QUALITY_BLOCKLIST, setScheme, splitFor, stepsTarget, WARMUP,
  type Muscle, type Slot,
} from "../src/domain/planArchetypes";
import { computeTargets } from "../src/domain/mealplan";
import type {
  BankPlan, DaysBucket, EquipmentBucket, ExperienceLevel, GoalBucket, Lang, LocalizedBankPlan,
  NutritionTargets, PlanDay, PlanExercise, UserProfile, Weekday,
} from "../src/types";

const NPX = process.platform === "win32" ? "npx.cmd" : "npx";
const SEED_MARKER = "-- ===== SEED DATA (appended by scripts/build-plan-bank.mjs) =====";
const OUT = "migrations/0017_plan_bank.sql";

function d1(sql: string): any[] {
  // SQL is double-quoted; our queries contain only single quotes, safe on cmd & bash.
  const out = execSync(`${NPX} wrangler d1 execute trix --remote --json --command "${sql}"`, {
    encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
  });
  // wrangler prints a banner before the JSON; slice from the first array bracket.
  const start = out.indexOf("[");
  const json = JSON.parse(out.slice(start));
  return json[0]?.results ?? [];
}

interface Cat {
  id: string; name: string; muscle: string; difficulty: string | null;
  equipments: string[]; instructions: string;
}

function loadCatalog(): { byMuscle: Map<string, Cat[]>; uk: Map<string, { name: string; instructions: string }> } {
  const rows = d1("SELECT id, name, muscle, difficulty, equipments, instructions FROM exercises") as any[];
  const byMuscle = new Map<string, Cat[]>();
  for (const r of rows) {
    if (QUALITY_BLOCKLIST.test(r.name)) continue; // drop gimmick/partner/Russian movements
    const c: Cat = {
      id: r.id, name: r.name, muscle: r.muscle, difficulty: r.difficulty,
      equipments: r.equipments ? JSON.parse(r.equipments) : [], instructions: r.instructions ?? "",
    };
    const list = byMuscle.get(c.muscle) ?? [];
    list.push(c);
    byMuscle.set(c.muscle, list);
  }
  const trows = d1("SELECT exerciseId, name, instructions FROM exercise_translations WHERE lang='uk'") as any[];
  const uk = new Map<string, { name: string; instructions: string }>();
  for (const t of trows) uk.set(t.exerciseId, { name: t.name, instructions: t.instructions });
  return { byMuscle, uk };
}

const HOME_EQUIP = new Set(["body_only", "dumbbell", "kettlebells", "bands", "none", "medicine_ball", "exercise_ball", "foam_roll"]);
function homeOk(c: Cat): boolean {
  if (!c.equipments.length) return true;
  return c.equipments.every((e) => HOME_EQUIP.has(e));
}
function isBodyweight(c: Cat): boolean {
  return c.equipments.length === 0 || c.equipments.every((e) => e === "body_only" || e === "none");
}

const MUSCLE_DISPLAY: Record<Muscle, { en: string; uk: string }> = {
  chest: { en: "chest", uk: "грудні м'язи" },
  lats: { en: "lats", uk: "найширші м'язи спини" },
  middle_back: { en: "middle back", uk: "ромбоподібні м'язи" },
  traps: { en: "traps", uk: "трапецієподібні м'язи" },
  biceps: { en: "biceps", uk: "біцепс" },
  triceps: { en: "triceps", uk: "трицепс" },
  forearms: { en: "forearms", uk: "передпліччя" },
  shoulders: { en: "shoulders", uk: "дельтоподібні м'язи" },
  quadriceps: { en: "quadriceps", uk: "квадрицепс" },
  hamstrings: { en: "hamstrings", uk: "біцепс стегна" },
  glutes: { en: "glutes", uk: "сідничні м'язи" },
  calves: { en: "calves", uk: "литкові м'язи" },
  abdominals: { en: "abs", uk: "прес" },
  lower_back: { en: "lower back", uk: "розгиначі спини" },
  abductors: { en: "abductors", uk: "відвідні м'язи стегна" },
};

// Movements performed against bodyweight (possibly +load) → cue "Bodyweight", never a barbell
// number. Matched by name so it catches "Pull-up", "Weighted pull-up", "Chest dip", "Pushups",
// "Elbow plank", "Glute bridge", etc. regardless of how the catalog tags equipment.
const BODYWEIGHT_NAME = /pull-?up|pullup|chin-?up|muscle up|\bdip\b|push-?up|pushup|plank|crunch|\btwist\b|sit-?up|leg raise|knee raise|bridge|\bhop\b|sprint|jump|circle|climber|walkout|fall-out|glute ham raise|superman|inverted row|scapular|stretch|butt kick|high knee/i;

// Reference starting load (kg) for a real lift, by name keyword — what a coach would pencil in
// for a ~80kg man / ~65kg woman before the per-user adapter scales it to actual bodyweight/PRs.
const LIFT_KG: { re: RegExp; m: number; f: number }[] = [
  { re: /romanian|stiff-?leg|good morning/i, m: 60, f: 35 },
  { re: /deadlift/i, m: 90, f: 55 },
  { re: /(full|back|olympic|front|box) squat|hack squat|pistol squat/i, m: 80, f: 45 },
  { re: /leg press/i, m: 120, f: 70 },
  { re: /hip thrust|glute bridge \(barbell\)|barbell glute bridge/i, m: 70, f: 45 },
  { re: /bench press|chest press/i, m: 60, f: 30 },
  { re: /incline.*(bench|press)/i, m: 45, f: 22 },
  { re: /shoulder press|overhead press|military press|push-?press/i, m: 35, f: 18 },
  { re: /(bent over|t-bar|yates|cable|long bar|dumbbell|plate|high) row|pulldown|pull-down/i, m: 45, f: 27 },
  { re: /shrug/i, m: 50, f: 30 },
  { re: /leg curl|leg extension/i, m: 30, f: 20 },
  { re: /calf raise|calf press/i, m: 45, f: 27 },
  { re: /lunge/i, m: 20, f: 12 },
  { re: /fly|flyes|crossover|cross-over|lateral|reverse fly|kickback|pull-over|hip extension|hip abduction|abduction/i, m: 12, f: 7 },
  { re: /curl/i, m: 15, f: 8 },
  { re: /pushdown|extension|skullcrusher|skull crusher|jm press|floor press/i, m: 18, f: 10 },
];

function startWeightRef(muscle: Muscle, role: "primary" | "accessory", sex: "male" | "female", c: Cat): string {
  const name = c.name;
  if (BODYWEIGHT_NAME.test(name) || isBodyweight(c)) return "Bodyweight";
  const m = sex === "male";
  for (const { re, m: mk, f } of LIFT_KG) if (re.test(name)) return `${m ? mk : f} kg`;
  // fallback by region/role if no keyword matched
  const lower = new Set<Muscle>(["quadriceps", "hamstrings", "glutes"]);
  const big = new Set<Muscle>(["chest", "lats", "middle_back", "traps"]);
  let kg: number;
  if (muscle === "calves") kg = m ? 40 : 25;
  else if (lower.has(muscle)) kg = role === "primary" ? (m ? 70 : 45) : (m ? 30 : 20);
  else if (big.has(muscle)) kg = role === "primary" ? (m ? 45 : 25) : (m ? 25 : 15);
  else kg = m ? 12 : 7;
  return `${kg} kg`;
}

// 2-3 sentence technique cue from catalog instructions (already prose).
function trimTechnique(s: string): string {
  const parts = (s || "").split(/(?<=\.)\s+/).filter(Boolean);
  return parts.slice(0, 3).join(" ").trim() || s.trim();
}

const REF_BODY: Record<"male" | "female", { weightKg: number; heightCm: number; age: number }> = {
  male: { weightKg: 80, heightCm: 178, age: 30 },
  female: { weightKg: 65, heightCm: 165, age: 30 },
};

function refNutrition(goal: GoalBucket, sex: "male" | "female"): NutritionTargets {
  const goalText = goal === "fatloss" ? "fat loss" : goal === "muscle" ? "muscle gain" : goal === "strength" ? "strength" : "recomposition";
  const profile: UserProfile = { ...REF_BODY[sex], sex, goal: goalText, lifestyle: "moderate", daysPerWeek: 4 };
  return computeTargets(profile);
}

// Professional pick: try the slot's preferred movements (canonical compounds first) in order,
// then fall back to the best remaining exercise for the muscle. Deterministic — NOT random —
// so a senior coach's textbook ordering comes through. Equipment/level filter the pool first;
// `used` keeps the plan varied (a 2nd push day lands on the next-best press).
function pickExercise(
  slot: Slot, byMuscle: Map<string, Cat[]>, level: ExperienceLevel, equipment: EquipmentBucket,
  used: Set<string>, dayUsed: Set<string>, variant = 0,
): Cat | null {
  const pool: Cat[] = [];
  const seen = new Set<string>();
  for (const m of poolMusclesFor(slot)) {
    for (const c of byMuscle.get(m) ?? []) if (!seen.has(c.id)) { seen.add(c.id); pool.push(c); }
  }
  let avail = pool.filter((c) => (level === "beginner" ? c.difficulty !== "expert" : true));
  if (equipment === "home") {
    const h = avail.filter(homeOk);
    if (h.length) avail = h;
  }
  const eligible = avail.length ? avail : pool;
  const freshDay = eligible.filter((c) => !dayUsed.has(c.id)); // not already in TODAY's session
  // Rank the slot's catalog candidates by preferred-fragment priority, then cleanest (shortest)
  // name — so canonical compounds lead and "… - Gethin Variation" novelty suffixes sink.
  const ranked: Cat[] = [];
  const inRanked = new Set<string>();
  for (const want of preferredNames(slot)) {
    const w = want.toLowerCase();
    const ms = freshDay.filter((c) => c.name.toLowerCase().includes(w)).sort((a, b) => a.name.length - b.name.length);
    for (const c of ms) if (!inRanked.has(c.id)) { inRanked.add(c.id); ranked.push(c); }
  }
  // Prefer movements not used elsewhere in the plan; `variant` rotates the choice (v1 = best,
  // v2 = next best) so the two stored variants per key differ.
  const freshPlan = ranked.filter((c) => !used.has(c.id));
  const list = freshPlan.length ? freshPlan : ranked;
  if (list.length) return list[variant % list.length];
  // Generic fallback (no preferred match): today-fresh by difficulty, then any eligible.
  const byDiff = (a: Cat, b: Cat) => rankDiff(a.difficulty) - rankDiff(b.difficulty);
  const freshOrdered = [...freshDay].sort(byDiff);
  const pick = freshOrdered.find((c) => !used.has(c.id)) ?? freshOrdered[0];
  if (pick) return pick;
  return [...eligible].sort(byDiff)[0] ?? null;
}
function rankDiff(d: string | null): number {
  if (d === "beginner") return 0;
  if (d === "intermediate") return 1;
  if (d === "expert") return 3;
  return 2;
}

// A non-catalog conditioning finisher added to fat-loss plans (the catalog has no clean Z2
// cardio entry; this carries the HR-zone cue a coach would give).
const CARDIO: Record<Lang, { name: string; technique: string }> = {
  en: { name: "Z2 Cardio (bike / row / brisk walk)", technique: "Steady, easy pace you can hold a conversation at. Keep your heart rate in zone 2 (about 60-70% of max) the whole time." },
  uk: { name: "Кардіо Z2 (велотренажер / гребля / швидка ходьба)", technique: "Рівний, легкий темп, за якого можеш спокійно розмовляти. Тримай пульс у зоні 2 (приблизно 60-70% від максимуму) весь час." },
};

function buildBankPlan(
  lang: Lang, goal: GoalBucket, level: ExperienceLevel, bucket: DaysBucket,
  sex: "male" | "female", equipment: EquipmentBucket,
  cat: { byMuscle: Map<string, Cat[]>; uk: Map<string, { name: string; instructions: string }> },
  picks: Map<string, Cat>, // shared pick map so EN+UK use the SAME exercise
  variant = 0,
): BankPlan {
  const days = splitFor(bucket, sex);
  const used = new Set<string>();
  const split: PlanDay[] = days.map((day, di) => {
    const dayUsed = new Set<string>();
    const exercises: PlanExercise[] = day.slots.map((slot, si) => {
      const key = `${di}:${si}`;
      let c = picks.get(key);
      if (!c) {
        c = pickExercise(slot, cat.byMuscle, level, equipment, used, dayUsed, variant);
        if (c) { used.add(c.id); picks.set(key, c); }
      }
      if (c) dayUsed.add(c.id);
      const scheme = setScheme(goal, level, slot.role);
      const tr = c ? cat.uk.get(c.id) : undefined;
      const enName = c?.name ?? slot.muscle;
      const name = lang === "uk" && tr?.name ? tr.name : enName;
      const techEn = trimTechnique(c?.instructions ?? "");
      const technique = lang === "uk" && tr?.instructions ? trimTechnique(tr.instructions) : techEn;
      return {
        name,
        sets: scheme.sets,
        startWeight: c ? startWeightRef(slot.muscle, slot.role, sex, c) : "Bodyweight",
        technique,
        muscles: MUSCLE_DISPLAY[slot.muscle][lang],
        isKeyLift: slot.role === "primary",
        rpe: scheme.rpe,
        rir: scheme.rir,
        rest: scheme.rest,
        movementPattern: slot.pattern,
        role: slot.role,
        ...(c ? { exerciseId: c.id, canonicalName: c.name } : {}),
      };
    });
    return {
      weekday: (di + 1) as Weekday,
      muscleGroup: DAY_LABEL[day.labelKey][lang],
      sessionType: day.sessionType,
      durationMin: 50 + exercises.length * 5,
      warmUp: WARMUP[lang],
      coolDown: COOLDOWN[lang],
      exercises,
    };
  });
  // Fat-loss: add a steady-state Z2 conditioning finisher to the last training day.
  if (goal === "fatloss" && split.length) {
    split[split.length - 1].exercises.push({
      name: CARDIO[lang].name,
      sets: "1 × 20-30 min",
      startWeight: "Bodyweight",
      technique: CARDIO[lang].technique,
      muscles: lang === "uk" ? "серцево-судинна система" : "cardio",
      isKeyLift: false,
      movementPattern: "cardio",
      role: "accessory",
      heartRateZone: "Z2 60-70%",
    });
  }
  const nutrition = refNutrition(goal, sex);
  const restDayNutrition: NutritionTargets = {
    calories: Math.round((nutrition.calories * 0.88) / 10) * 10,
    protein: nutrition.protein,
    fats: Math.round(nutrition.fats * 0.95),
    carbs: Math.round(nutrition.carbs * 0.7),
  };
  return {
    split, nutrition, restDayNutrition, supplements: [],
    methodology: METHODOLOGY[goal][lang],
    movementAudit: MOVEMENT_AUDIT[lang],
    stepsTarget: stepsTarget("moderate"),
  };
}


const GOALS: GoalBucket[] = ["fatloss", "muscle", "recomp", "strength"];
const LEVELS: ExperienceLevel[] = ["beginner", "intermediate", "advanced"];
const BUCKETS: DaysBucket[] = ["d23", "d4", "d56"];
const SEXES: ("male" | "female")[] = ["male", "female"];
const EQUIP: EquipmentBucket[] = ["gym", "home"];

function sqlEsc(s: string): string {
  return s.replace(/'/g, "''");
}

function main() {
  console.log("Loading catalog from remote D1…");
  const cat = loadCatalog();
  const total = [...cat.byMuscle.values()].reduce((a, l) => a + l.length, 0);
  console.log(`Catalog: ${total} exercises across ${cat.byMuscle.size} muscles; ${cat.uk.size} UK translations.`);

  // Ensure the seed marker exists and truncate anything after it (idempotent re-runs).
  let file = readFileSync(OUT, "utf8");
  const idx = file.indexOf(SEED_MARKER);
  if (idx === -1) throw new Error(`seed marker not found in ${OUT}`);
  file = file.slice(0, idx + SEED_MARKER.length) + "\n";
  writeFileSync(OUT, file, "utf8");

  let count = 0;
  const lines: string[] = [];
  for (const goal of GOALS) for (const level of LEVELS) for (const bucket of BUCKETS) for (const sex of SEXES) for (const equipment of EQUIP) {
    // Two variants per key (the runtime rotates them by userId on regenerate).
    for (const variant of [1, 2]) {
      const picks = new Map<string, Cat>();
      const en = buildBankPlan("en", goal, level, bucket, sex, equipment, cat, picks, variant - 1);
      const uk = buildBankPlan("uk", goal, level, bucket, sex, equipment, cat, picks, variant - 1);
      const plan: LocalizedBankPlan = { en, uk };
      const id = `${goal}_${level}_${bucket}_${sex}_${equipment}_v${variant}`;
      const planJson = sqlEsc(JSON.stringify(plan));
      lines.push(
        `INSERT OR REPLACE INTO plan_bank (id, goal, level, days_bucket, sex, equipment, variant, plan, createdAt) ` +
        `VALUES ('${id}', '${goal}', '${level}', '${bucket}', '${sex}', '${equipment}', ${variant}, '${planJson}', '2026-06-13T00:00:00.000Z');`,
      );
      count++;
    }
  }
  appendFileSync(OUT, lines.join("\n") + "\n", "utf8");
  console.log(`Wrote ${count} plan_bank INSERTs to ${OUT}. Review, then apply with d1 execute --file.`);
}

main();
