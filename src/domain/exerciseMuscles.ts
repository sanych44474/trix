// Which muscles an exercise works, for the body map: primary movers and secondary helpers, in the
// figure's own vocabulary (react-muscle-highlighter slugs). The exercise catalog only stores one
// primary muscle per exercise and plans only carry a free-text hint, so this is a small curated
// table of movement patterns, matched on the name in Ukrainian, English and common Russian.
// Shared by the Mini App body map and the plan-balance check (./muscleLoad.ts). Pure and unit-tested
// (test/mini-app-exercise-muscles.test.ts).
//
// Order matters: specific patterns come before the general ones they overlap with ("жим ногами"
// before "жим", "згинання ніг" before "згинання рук", Romanian deadlift before deadlift, the
// cardio "Rowing" before the barbell row).

export type Slug =
  | "abs" | "adductors" | "biceps" | "calves" | "chest" | "deltoids" | "forearm" | "gluteal"
  | "hamstring" | "lower-back" | "neck" | "obliques" | "quadriceps" | "tibialis" | "trapezius"
  | "triceps" | "upper-back";

export interface ExerciseMuscles {
  primary: Slug[];
  secondary: Slug[];
}

type Rule = [RegExp, Slug[], Slug[]];

const RULES: Rule[] = [
  // ---- cardio (whole-name first, so "Barbell Rowing" stays a row) ----
  [/^\s*(rowing|веслування|гребля)\s*$|rowing machine|row(ing)? erg|\brower\b|ергометр|гребн/iu, ["upper-back", "quadriceps"], ["biceps", "hamstring", "gluteal"]],
  [/\b(run|running|jog|jogging|treadmill|sprints?)\b|біг|бег|пробіжк|доріжк|спринт/iu, ["quadriceps", "calves", "hamstring"], ["gluteal"]],
  [/^(?!.*(скруч|лежач|crunch)).*(\b(bike|cycling|spin)\b|велос|велотрен)/iu, ["quadriceps"], ["calves", "gluteal", "hamstring"]],
  [/\b(swim|swimming)\b|плаван/iu, ["upper-back", "deltoids"], ["chest", "triceps"]],
  [/^\s*(walk|walking|hike|hiking)\s*$|ходьба(?! фермера)|прогулянк(?!а фермера)|похід/iu, ["calves", "quadriceps"], ["gluteal"]],
  [/jump ?rope|скакалк/iu, ["calves"], ["quadriceps", "deltoids"]],
  [/elliptical|еліпт|еліпс|stair|степер/iu, ["quadriceps", "gluteal"], ["calves", "hamstring"]],

  // ---- whole-body / core moves whose words would hit the rules below ----
  // Olympic lifts: the pull from the floor (clean, snatch) is legs and hips; the overhead drive
  // (jerk, push press, thruster) is shoulders and quads. A medicine-ball "поштовх від грудей" is a
  // chest pass, a "Clean Shrug" a shrug.
  [/^(?!.*(shrug|шраг|медбол|мішк|від грудей)).*(\bjerk\b|thruster|поштовх|швунг|трастер)/iu, ["deltoids", "quadriceps"], ["gluteal", "triceps", "trapezius"]],
  [/^(?!.*(shrug|шраг|медбол)).*(\bclean\b|snatch|взяття|(?<!\p{L})ривок(?!\p{L}))/iu, ["quadriceps", "gluteal", "hamstring"], ["trapezius", "deltoids", "lower-back"]],
  [/get[- ]?up|турецьк\p{L}* підйом/iu, ["deltoids", "abs"], ["gluteal", "quadriceps", "obliques"]],
  [/^(?!.*(тяг|жим|press|row)).*(шиї|шию|\bneck\b)/iu, ["neck"], []],
  [/burpee|берпі|бёрпи|берпи/iu, ["quadriceps", "chest"], ["deltoids", "triceps", "abs"]],
  [/mountain climber|скелелаз|альпініст/iu, ["abs"], ["quadriceps", "deltoids", "obliques"]],
  [/dead ?bug|мертв\p{L}* жук/iu, ["abs"], ["obliques"]],
  [/wall sit|стільчик|стульчик/iu, ["quadriceps"], ["gluteal"]],
  [/glute[- ]ham raise|\bghr\b/iu, ["hamstring"], ["gluteal", "calves"]],
  [/pallof|палоф/iu, ["obliques"], ["abs"]],

  // ---- legs / hips ----
  [/kettlebell swing|dumbbell swing|\bswing\b|махи гир|махи гантел(ею|лю|ями)(?!.*(сторон|бок|нахил))/iu, ["gluteal", "hamstring"], ["lower-back", "deltoids"]],
  // Glute isolation before anything that shares a word: "Glute Kickback" isn't a triceps kickback,
  // "Махи ногою назад" aren't lateral raises.
  [/glute kickback|donkey kick|fire hydrant|гідрант|гидрант|махи ног|відведення ноги|отведение ноги/iu, ["gluteal"], ["hamstring"]],
  [/hip thrust|glute bridge|сідничн\p{L}* міст|ягідн\p{L}* міст|ягодичн\p{L}* мост|тазов\p{L}* (міст|підйом)|(підйом|подъем)\p{L}* таз/iu, ["gluteal"], ["hamstring", "adductors"]],
  [/romanian|\brdl\b|stiff[- ]?leg|good ?morning|single[- ]leg (deadlift|rdl)|румунськ|румынск|на прямих ногах|на прямых ногах|доброго ранку|доброе утро|тяг\p{L}*\s.*на одн\p{L}* нозі/iu, ["hamstring", "gluteal"], ["lower-back", "adductors", "forearm"]],
  [/deadlift|(?<!\p{L})станов|тяга сумо|сумо[- ]тяга|ривков\p{L}* тяга|тяга ривков/iu, ["gluteal", "hamstring", "lower-back"], ["quadriceps", "trapezius", "upper-back", "forearm"]],
  [/hip circles?|обертання стегн|вращени\p{L}* таз|вращени\p{L}* бедр/iu, ["gluteal"], ["adductors", "obliques"]],
  [/knee circles?|обертання колін|вращени\p{L}* колен/iu, ["quadriceps"], ["calves"]],
  [/leg press|жим ногами|жим ног|жим платформ|гак-?машин/iu, ["quadriceps", "gluteal"], ["adductors", "hamstring"]],
  [/lunge|split squat|step[- ]?up|випад|выпад|болгарськ|болгарск|зашагув/iu, ["quadriceps", "gluteal"], ["adductors", "hamstring", "calves"]],
  [/squat|присід|присед|гакк|hack/iu, ["quadriceps", "gluteal"], ["adductors", "hamstring", "lower-back"]],
  [/leg extension|розгинання ніг|разгибание ног|розгинання ног/iu, ["quadriceps"], []],
  [/leg curl|hamstring curl|nordic|згинання ніг|сгибание ног|згинання ног|біцепс стегна|бицепс бедра/iu, ["hamstring"], ["calves"]],
  [/calf|литк|икр|носк|носок/iu, ["calves"], []],
  [/adduct|привод|(?<!\p{L})зведення ніг|сведение ног/iu, ["adductors"], []],
  [/abduct|відвод|відведення ніг|розведення ніг|разведение ног|отведение ног/iu, ["gluteal"], []],

  // ---- back / lower back ----
  [/hyperext|back extension|гіперекст|гиперэкст|розгинання спини|разгибание спины/iu, ["lower-back"], ["gluteal", "hamstring"]],
  [/^(?!.*(згинан|розгинан|(підтяг|подтяг)\p{L}* колін|knee (raise|tuck|to))).*(pull-?up|chin-?up|pull-?down|\blats?\b|підтяг|подтяг|верхнього блок|верхнего блок|вертикальн\p{L}* тяг)/iu, ["upper-back"], ["biceps", "forearm", "deltoids"]],
  [/pull-?over|пуловер/iu, ["upper-back", "chest"], ["triceps"]],
  [/^(?!.*(негативн|на лаві)).*(face ?pull|rear delt|reverse fly|bent[- ]?over .*(fly|raise)|(розвед|махи)\p{L}* .*нахил|нахил\p{L}* .*(розвед|махи)|до обличчя|к лицу|зворотн\p{L}* розвед|обратн\p{L}* развед|задн\p{L}* дельт|(розведення|зведення|разведение|сведение) рук назад)/iu, ["deltoids", "upper-back"], ["trapezius"]],
  [/^(?!.*француз).*(upright row|до підборіддя|к подбородку)/iu, ["deltoids", "trapezius"], ["biceps"]],
  [/shrug|шраг/iu, ["trapezius"], ["forearm"]],
  [/\brows?\b|rowing|тяга|t-bar/iu, ["upper-back"], ["biceps", "deltoids", "trapezius", "lower-back", "forearm"]],

  // ---- chest ----
  // Triceps isolation before the chest presses: "Французький жим лежачи" is not a bench press.
  [/triceps|трицепс|pushdown|push-?down|skull|french|французьк|французск|kickback|розгинання\p{L}*\s.*з-за голов|розгинання рук|разгибание рук|розгинання на блоці|разгибание на блоке|розгинання з-за голов|розгинання гантел|кікбек/iu, ["triceps"], []],
  // Bodyweight stand-ins (domain/equipmentFit.ts) whose words would otherwise hit the press rules below.
  [/superman|супермен/iu, ["lower-back"], ["gluteal", "hamstring"]],
  [/pike push|пайк/iu, ["deltoids"], ["triceps", "chest"]],
  [/side bend|нахил\p{L}* в бік|наклон\p{L}* в сторону/iu, ["obliques"], ["abs"]],
  [/bench dip|від лави|от скамьи|зворотн\p{L}* віджиман|обратн\p{L}* отжиман/iu, ["triceps"], ["chest", "deltoids"]],
  [/^(?!.*(колін|ніг|knee|leg)).*(dip|бруси|брусья|брусьях|брусах)/iu, ["chest", "triceps"], ["deltoids"]],
  [/(close[- ]?grip|вузьким хват|узким хват).*(bench|press|жим)|(bench|press|жим).*(close[- ]?grip|вузьким хват|узким хват)|вузьк\p{L}* жим|жим\p{L}* вузьк/iu, ["triceps", "chest"], ["deltoids"]],
  [/^(?!.*(над голов|overhead)).*(\bfly|flyes|флай|cross-?over|кросовер|кроссовер|pec deck|butterfly|батерфляй|метелик|(?<!\p{L})зведення рук|(?<!\p{L})сведение рук|розведення гантелей лежачи|розведення рук лежачи|розведен\p{L}*\s.*лежачи|разведение гантелей лежа)/iu, ["chest"], ["deltoids"]],
  [/^(?!.*(curl|згинан|crunch|скруч|sit-?up|raise|підйом|колін|knee|pull-in)).*(decline|нахилом вниз|головою вниз)/iu, ["chest"], ["triceps", "deltoids"]],
  [/^(?!.*(curl|згинан|crunch|скруч|sit-?up|raise|підйом|колін|knee|pull-in)).*(incline|під кутом|похил|наклонн)/iu, ["chest", "deltoids"], ["triceps"]],
  [/^(?!.*(curl|згинан|crunch|скруч|sit-?up|raise|підйом|колін|knee|pull-in)).*(bench|chest press|floor press|жим\p{L}*\s(.*\s)?лежа|жим від грудей|жим .*на лаві|жим\p{L}*\s.*(з|на|від|с) (підлог|підлоз|пол))/iu, ["chest"], ["triceps", "deltoids"]],
  [/push-?up|віджим|отжим/iu, ["chest", "triceps"], ["deltoids", "abs"]],

  // ---- shoulders ----
  [/overhead|military|shoulder press|arnold|арнольд|армійськ|армейск|жим\s.*(стоячи|сидячи|стоя|сидя|над голов)|жим над голов/iu, ["deltoids"], ["triceps", "trapezius"]],
  [/lateral raise|side raise|махи|[ву] сторон|[ву] бок(и|а)(?!\p{L})|відведення рук/iu, ["deltoids"], ["trapezius"]],
  [/front .*raise|raise.*front|перед собою/iu, ["deltoids"], ["chest"]],

  // ---- arms ----
  [/hammer|молот/iu, ["biceps", "forearm"], []],
  [/wrist|reverse curl|зап'яст|запястья|farmer|фермер/iu, ["forearm"], ["trapezius"]],
  [/curl|згинання рук|сгибание рук|згинання (з|зі|із) (штанг|гантел|ez)|згинання (штанг|гантел)|концентрован|біцепс|бицепс|скотт|scott|preacher/iu, ["biceps"], ["forearm"]],

  // ---- core ----
  [/side plank|бічна планк|боковая планк|twist|скручування з млинцем|російськ\p{L}* скруч|русск\p{L}* скруч|woodchop|oblique|кос[іы]/iu, ["obliques"], ["abs"]],
  [/plank|планк|hollow|човник/iu, ["abs"], ["obliques", "deltoids"]],
  [/crunch|sit-?up|leg raise|knee raise|knee tuck|pull-in|toes to bar|ab wheel|скручув|скручив|прес|пресс|(підйом|подъем)\p{L}* (ніг|ног)|(підйом|подъем|підтягуван)\p{L}* колін|ролик/iu, ["abs"], ["obliques"]],
];

// Last resort: the coarse region a name mentions ("вправа на груди", "leg day finisher").
// English words need word boundaries: "arm" is inside "warm-up" and "One-Arm Row".
const REGION_FALLBACK: Array<[RegExp, Slug[]]> = [
  [/груд|\bchest\b/iu, ["chest"]],
  [/спин|\bback\b|широч/iu, ["upper-back"]],
  [/ног|\blegs?\b|стегн|бедр/iu, ["quadriceps", "hamstring", "gluteal"]],
  [/плеч|дельт|\bshoulders?\b/iu, ["deltoids"]],
  [/(?<!\p{L})рук[иу]?(?!\p{L})|\barms?\b/iu, ["biceps", "triceps"]],
  [/\bcore\b|(?<!\p{L})кор(?!\p{L})/iu, ["abs", "obliques"]],
];

export function musclesForExercise(name: string): ExerciseMuscles | null {
  const n = name.toLowerCase();
  for (const [re, primary, secondary] of RULES) {
    if (re.test(n)) return { primary, secondary: secondary.filter((s) => !primary.includes(s)) };
  }
  // A learned (catalog/AI) classification beats a guess from a region word in the name.
  const learned = LEARNED.get(normalizeExerciseName(name));
  if (learned) return learned;
  for (const [re, primary] of REGION_FALLBACK) {
    if (re.test(n)) return { primary, secondary: [] };
  }
  return null;
}

// ---- Learned muscles: exercises the rules above don't recognise ----
// Someone's own exercise ("Тяга Т-грифа з упором", a club-specific machine) used to drop out of
// the body map, the region list and the muscle quests. Such names are classified once (catalog
// match, else AI; src/exerciseMuscleLearning.ts), stored in v2_exercise_muscles, and registered
// here by the server and the Mini App, so every caller of musclesForExercise sees them. The
// rules always win: a learned entry only fills a gap.
const LEARNED = new Map<string, ExerciseMuscles>();

export const ALL_SLUGS: readonly Slug[] = [
  "abs", "adductors", "biceps", "calves", "chest", "deltoids", "forearm", "gluteal",
  "hamstring", "lower-back", "neck", "obliques", "quadriceps", "tibialis", "trapezius",
  "triceps", "upper-back",
];

export function normalizeExerciseName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Keep only known muscle slugs (an AI answer or a stored row may carry anything). */
export function cleanSlugs(list: unknown): Slug[] {
  if (!Array.isArray(list)) return [];
  return [...new Set(list.filter((x): x is Slug => typeof x === "string" && (ALL_SLUGS as readonly string[]).includes(x)))];
}

export function registerLearnedMuscles(entries: Array<{ name: string; primary: unknown; secondary?: unknown }>): void {
  for (const e of entries) {
    const primary = cleanSlugs(e.primary);
    if (!primary.length) continue; // a "couldn't classify" marker teaches nothing
    LEARNED.set(normalizeExerciseName(e.name), { primary, secondary: cleanSlugs(e.secondary).filter((s) => !primary.includes(s)) });
  }
}

/** Whether the rules alone (not a learned entry) recognise the name. */
export function knownByRules(name: string): boolean {
  const n = name.toLowerCase();
  return RULES.some(([re]) => re.test(n)) || REGION_FALLBACK.some(([re]) => re.test(n));
}

// free-exercise-db / catalog muscle enum → body-map muscle.
const CATALOG_TO_SLUG: Record<string, Slug> = {
  chest: "chest", lats: "upper-back", "middle back": "upper-back", "lower back": "lower-back",
  traps: "trapezius", shoulders: "deltoids", biceps: "biceps", triceps: "triceps",
  forearms: "forearm", abdominals: "abs", quadriceps: "quadriceps", hamstrings: "hamstring",
  glutes: "gluteal", calves: "calves", adductors: "adductors", abductors: "gluteal", neck: "neck",
};

export function slugForCatalogMuscle(muscle: string | null | undefined): Slug | null {
  return CATALOG_TO_SLUG[(muscle ?? "").trim().toLowerCase()] ?? null;
}
