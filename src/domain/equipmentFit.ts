// Keep a plan inside the equipment the person actually has. Onboarding asks "full gym / home
// basics (dumbbells, bands) / dumbbells only / bodyweight only", but neither the plan bank (where
// equipment was only one weighted dimension of the match) nor the AI (which picks from the whole
// catalog) guaranteed it — a dumbbells-only user could get a week of barbell work. fitSplitToKit
// runs on every generated plan, and on demand for an existing one: anything needing gear the kit
// lacks is swapped for a same-muscle exercise from a short curated list (with free-exercise-db
// ids, so the logger shows its pictures), keeping the sets, rest and role.
// Pure; test/equipment-fit.test.ts. No src/types import, so the Mini App can share it.
import { musclesForExercise, type Slug } from "./exerciseMuscles";

export type Kit = "gym" | "home" | "dumbbells" | "bodyweight";
type Gear = "barbell" | "machine" | "cable" | "kettlebell" | "dumbbell" | "band" | "bar" | "cardioMachine";

/** Onboarding's stored equipment answer (or free text) → the kit it means. */
export function kitFromEquipment(equipment: string | undefined): Kit {
  const e = (equipment ?? "").toLowerCase();
  if (/bodyweight|власн\p{L}* ваг|без інвентар|без обладн|калістен|calisthen/u.test(e)) return "bodyweight";
  if (/dumbbells only|тільки гантел|лише гантел|только гантел/.test(e)) return "dumbbells";
  if (/home|вдома|дома|band|гум|резин|dumbbell|гантел/.test(e)) return "home";
  return "gym";
}

const GEAR: Array<[Gear, RegExp]> = [
  ["cardioMachine", /treadmill|доріжц|доріжк|elliptical|еліпт|орбітрек|stationary|велотрен|recumbent bike|rowing machine|rower|гребн\p{L}* тренаж|stair ?(master|mill)|степ-тренаж|сходов\p{L}* тренаж/u],
  ["barbell", /barbell|штанг|\bez[- ]?bar|ez-гриф|гриф|t-bar|т-гриф|trap bar|трап-гриф|smith|сміт|landmine|кутов\p{L}* штанг|\blog lift|колод/u],
  ["machine", /machine|тренажер|lever(age)?\b|важільн|leg press|жим ногами|hack squat|гак-присід|pec deck|butterfly|метелик|leg extension|розгинання ніг|leg curls?|згинання ніг|згинання ноги|thigh (ab|ad)ductor|розведення ніг|зведення ніг|hip adduction|assisted/u],
  ["cable", /cable|блок|блоц|блоч|кросовер|crossover|pulldown|pushdown|face pull|тяга каната|pulley|rope (crunch|attachment|extension)|з канатом/u],
  ["kettlebell", /kettlebell|гир(я|і|ею|ю|ями|ях)?(?![а-яіїєґ])/u],
  ["band", /\bbands?\b|з гумою|гуми|гумою|резин/u],
  ["bar", /pull-?ups?|chin-?ups?|(?<!горизонтальне )підтягуван(?!\p{L}* колін)|турнік|hanging|у висі|(?<!bench )\bdips?\b|бруси|брусах|muscle[- ]?up|вихід силою|\brings?\b|кільц/u],
  ["dumbbell", /dumbbell|гантел/u],
];

// The classic barbell lifts are usually named without the word "barbell" ("Bench Press", "Жим
// лежачи", "Станова тяга"). With no other implement named and a load on it, that's a barbell.
const CLASSIC_BARBELL = /bench press|жим лежачи|жим лежа(?!\p{L})|deadlift|станова|back squat|^squat$|присідання$|присідання (зі|з) |overhead press|military press|армійськ|жим стоячи|bent[- ]over row|тяга в нахилі|good ?morning|доброго ранку|hip thrust/u;
const BODYWEIGHT_LOAD = /body|власн|bw\b|^\s*[—-]?\s*$/i;

/** What an exercise needs, read off its name (and English canonical name when present). The
 *  plan's load disambiguates the classic lifts: "Squat" at bodyweight needs nothing. */
export function gearFor(name: string, startWeight?: string): Gear[] {
  const n = name.toLowerCase();
  const gear = GEAR.filter(([, re]) => re.test(n)).map(([g]) => g);
  if (!gear.length && CLASSIC_BARBELL.test(n) && !/без ваги|bodyweight|jump|стриб/u.test(n) && (startWeight === undefined || !BODYWEIGHT_LOAD.test(startWeight))) gear.push("barbell");
  return gear;
}

const ALLOWED: Record<Kit, Set<Gear>> = {
  gym: new Set<Gear>(["barbell", "machine", "cable", "kettlebell", "dumbbell", "band", "bar", "cardioMachine"]),
  home: new Set<Gear>(["dumbbell", "band"]),
  dumbbells: new Set<Gear>(["dumbbell"]),
  bodyweight: new Set<Gear>([]),
};

export interface FitExercise {
  name: string;
  canonicalName?: string;
  sets: string;
  startWeight: string;
  technique: string;
  muscles?: string;
  exerciseId?: string;
  metric?: "reps" | "time" | "distance";
}

export function fitsKit(ex: { name: string; canonicalName?: string; startWeight?: string }, kit: Kit): boolean {
  if (kit === "gym") return true;
  const gear = new Set([...gearFor(ex.name, ex.startWeight), ...(ex.canonicalName ? gearFor(ex.canonicalName, ex.startWeight) : [])]);
  return [...gear].every((g) => ALLOWED[kit].has(g));
}

type Sub = { en: string; uk: string; id?: string; loaded: boolean };
const s = (en: string, uk: string, id: string | undefined, loaded: boolean): Sub => ({ en, uk, id, loaded });

// Same-muscle stand-ins, best first. Dumbbell picks avoid needing a bench (floor press, not bench
// press) since "dumbbells only" says nothing about one. Every name is matched by
// musclesForExercise to the muscle it stands in for (asserted in the test).
const DUMBBELL_SUBS: Partial<Record<Slug, Sub[]>> = {
  chest: [s("Dumbbell Floor Press", "Жим гантелей лежачи на підлозі", "Dumbbell_Floor_Press", true), s("Pushups", "Віджимання", "Pushups", false), s("Dumbbell Flyes", "Розведення гантелей лежачи", "Dumbbell_Flyes", true)],
  "upper-back": [s("One-Arm Dumbbell Row", "Тяга гантелі однією рукою", "One-Arm_Dumbbell_Row", true), s("Bent Over Two-Dumbbell Row", "Тяга двох гантелей у нахилі", "Bent_Over_Two-Dumbbell_Row", true)],
  deltoids: [s("Dumbbell Shoulder Press", "Жим гантелей над головою", "Dumbbell_Shoulder_Press", true), s("Side Lateral Raise", "Махи гантелями в боки", "Side_Lateral_Raise", true), s("Seated Bent-Over Rear Delt Raise", "Розведення гантелей у нахилі на задні дельти", "Seated_Bent-Over_Rear_Delt_Raise", true)],
  biceps: [s("Dumbbell Bicep Curl", "Згинання рук з гантелями", "Dumbbell_Bicep_Curl", true), s("Hammer Curls", "Молоткові згинання", "Hammer_Curls", true)],
  triceps: [s("Standing Dumbbell Triceps Extension", "Розгинання гантелі з-за голови стоячи", "Standing_Dumbbell_Triceps_Extension", true), s("Tricep Dumbbell Kickback", "Розгинання гантелі в нахилі (кікбек)", "Tricep_Dumbbell_Kickback", true)],
  forearm: [s("Seated Dumbbell Palms-Up Wrist Curl", "Згинання зап'ясть з гантелями сидячи", "Seated_Dumbbell_Palms-Up_Wrist_Curl", true)],
  abs: [s("Crunches", "Скручування", "Crunches", false), s("Plank", "Планка", "Plank", false)],
  obliques: [s("Dumbbell Side Bend", "Нахили в бік з гантеллю", "Dumbbell_Side_Bend", true), s("Russian Twist", "Російські скручування", "Russian_Twist", false)],
  quadriceps: [s("Goblet Squat", "Кубковий присід", "Goblet_Squat", true), s("Dumbbell Lunges", "Випади з гантелями", "Dumbbell_Lunges", true), s("Split Squat with Dumbbells", "Спліт-присід з гантелями", "Split_Squat_with_Dumbbells", true)],
  hamstring: [s("Stiff-Legged Dumbbell Deadlift", "Станова тяга на прямих ногах з гантелями", "Stiff-Legged_Dumbbell_Deadlift", true)],
  gluteal: [s("Single Leg Glute Bridge", "Сідничний міст на одній нозі", "Single_Leg_Glute_Bridge", false), s("Dumbbell Rear Lunge", "Зворотні випади з гантелями", "Dumbbell_Rear_Lunge", true)],
  calves: [s("Standing Dumbbell Calf Raise", "Підйом на носки з гантелями стоячи", "Standing_Dumbbell_Calf_Raise", true)],
  adductors: [s("Plie Dumbbell Squat", "Присід плі з гантеллю", "Plie_Dumbbell_Squat", true)],
  "lower-back": [s("Stiff-Legged Dumbbell Deadlift", "Станова тяга на прямих ногах з гантелями", "Stiff-Legged_Dumbbell_Deadlift", true)],
  trapezius: [s("Dumbbell Shrug", "Шраги з гантелями", "Dumbbell_Shrug", true)],
};

const BODYWEIGHT_SUBS: Partial<Record<Slug, Sub[]>> = {
  chest: [s("Pushups", "Віджимання", "Pushups", false), s("Push-Up Wide", "Широкі віджимання", "Push-Up_Wide", false), s("Push-Ups With Feet Elevated", "Віджимання з ногами на підвищенні", "Push-Ups_With_Feet_Elevated", false)],
  "upper-back": [s("Inverted Row", "Горизонтальне підтягування", "Inverted_Row", false), s("Superman", "Човник (супермен) лежачи на животі", undefined, false)],
  deltoids: [s("Pike Push-up", "Віджимання «пайк» на плечі", undefined, false), s("Push-Ups With Feet Elevated", "Віджимання з ногами на підвищенні", "Push-Ups_With_Feet_Elevated", false)],
  biceps: [s("Inverted Row underhand", "Горизонтальне підтягування зворотним хватом", undefined, false)],
  triceps: [s("Bench Dips", "Віджимання від лави", "Bench_Dips", false), s("Close Triceps Push-Ups", "Вузькі віджимання на трицепс", "Push-Ups_-_Close_Triceps_Position", false)],
  abs: [s("Crunches", "Скручування", "Crunches", false), s("Plank", "Планка", "Plank", false)],
  obliques: [s("Side Bridge", "Бічна планка", "Side_Bridge", false), s("Russian Twist", "Російські скручування", "Russian_Twist", false)],
  quadriceps: [s("Bodyweight Squat", "Присідання без ваги", "Bodyweight_Squat", false), s("Bodyweight Walking Lunge", "Випади в ходьбі без ваги", "Bodyweight_Walking_Lunge", false)],
  hamstring: [s("Single-Leg Romanian Deadlift (bodyweight)", "Румунська тяга на одній нозі без ваги", undefined, false)],
  gluteal: [s("Butt Lift Bridge", "Сідничний міст", "Butt_Lift_Bridge", false), s("Single Leg Glute Bridge", "Сідничний міст на одній нозі", "Single_Leg_Glute_Bridge", false)],
  calves: [s("Single-Leg Calf Raise", "Підйом на носок на одній нозі", undefined, false)],
  adductors: [s("Sumo Squat", "Присідання сумо", undefined, false)],
  "lower-back": [s("Superman", "Човник (супермен) лежачи на животі", undefined, false)],
};

const OUTDOOR_CARDIO: Sub = s("Brisk walk or run outdoors", "Швидка ходьба або біг на вулиці", undefined, false);

export const SELF_SELECT_WEIGHT = { uk: "підбери вагу", en: "pick a weight" } as const;
const BODYWEIGHT_LABEL = { uk: "Власна вага", en: "Bodyweight" } as const;

export interface KitSwap { weekday: number; from: string; to: string }

/**
 * Swap every exercise that needs gear outside `kit`. An exercise whose muscle has no stand-in
 * (forearms or neck on bodyweight only) is dropped rather than left impossible. Returns the new
 * split and what changed; the input is not mutated.
 */
export function fitSplitToKit<D extends { weekday: number; exercises: E[] }, E extends FitExercise>(
  split: D[], kit: Kit, lang: "uk" | "en",
): { split: D[]; swaps: KitSwap[]; dropped: KitSwap[] } {
  const swaps: KitSwap[] = [];
  const dropped: KitSwap[] = [];
  if (kit === "gym") return { split, swaps, dropped };
  const table = kit === "bodyweight" ? BODYWEIGHT_SUBS : DUMBBELL_SUBS;
  const out = split.map((day) => {
    const used = new Set(day.exercises.flatMap((e) => [e.name.toLowerCase(), (e.canonicalName ?? e.name).toLowerCase()]));
    const exercises: E[] = [];
    for (const ex of day.exercises) {
      if (fitsKit(ex, kit)) { exercises.push(ex); continue; }
      const gear = gearFor(`${ex.name} ${ex.canonicalName ?? ""}`, ex.startWeight);
      let pick: Sub | undefined;
      if (gear.includes("cardioMachine")) pick = OUTDOOR_CARDIO;
      else {
        const m = musclesForExercise(ex.canonicalName ?? ex.name) ?? musclesForExercise(ex.name);
        const options = (m?.primary ?? []).flatMap((slug) => table[slug] ?? []);
        pick = options.find((o) => !used.has(o.en.toLowerCase()) && !used.has(o.uk.toLowerCase())) ?? options[0];
      }
      if (!pick) { dropped.push({ weekday: day.weekday, from: ex.name, to: "" }); continue; }
      used.add(pick.en.toLowerCase());
      used.add(pick.uk.toLowerCase());
      const name = lang === "en" ? pick.en : pick.uk;
      swaps.push({ weekday: day.weekday, from: ex.name, to: name });
      const replaced: E = {
        ...ex,
        name,
        canonicalName: pick.en,
        startWeight: pick.loaded ? SELF_SELECT_WEIGHT[lang] : BODYWEIGHT_LABEL[lang],
        technique: "",
      };
      delete replaced.exerciseId; // the old catalog link described the old movement
      exercises.push(replaced);
    }
    // Never leave a training day empty: if everything was dropped, keep the plank.
    if (!exercises.length && day.exercises.length) {
      exercises.push({ ...day.exercises[0]!, name: lang === "en" ? "Plank" : "Планка", canonicalName: "Plank", startWeight: BODYWEIGHT_LABEL[lang], technique: "" });
    }
    return { ...day, exercises };
  });
  return { split: out, swaps, dropped };
}

/** How many exercises in a split need gear outside the kit (0 = the plan already fits). */
export function kitMismatches(split: Array<{ exercises: Array<{ name: string; canonicalName?: string; startWeight?: string }> }>, kit: Kit): number {
  return kit === "gym" ? 0 : split.reduce((n, d) => n + d.exercises.filter((e) => !fitsKit(e, kit)).length, 0);
}
