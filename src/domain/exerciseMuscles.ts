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
  [/\b(bike|cycling|spin)\b|велос|велотрен/iu, ["quadriceps"], ["calves", "gluteal", "hamstring"]],
  [/\b(swim|swimming)\b|плаван/iu, ["upper-back", "deltoids"], ["chest", "triceps"]],
  [/^\s*(walk|walking|hike|hiking)\s*$|ходьба(?! фермера)|прогулянк(?!а фермера)|похід/iu, ["calves", "quadriceps"], ["gluteal"]],
  [/jump ?rope|скакалк/iu, ["calves"], ["quadriceps", "deltoids"]],
  [/elliptical|еліпт|еліпс|stair|степер/iu, ["quadriceps", "gluteal"], ["calves", "hamstring"]],

  // ---- legs / hips ----
  [/kettlebell swing|dumbbell swing|\bswing\b|махи гир|махи гантел(ею|лю|ями)(?!.*(сторон|бок))/iu, ["gluteal", "hamstring"], ["lower-back", "deltoids"]],
  // Glute isolation before anything that shares a word: "Glute Kickback" isn't a triceps kickback,
  // "Махи ногою назад" aren't lateral raises.
  [/glute kickback|donkey kick|fire hydrant|гідрант|гидрант|махи ног|відведення ноги|отведение ноги/iu, ["gluteal"], ["hamstring"]],
  [/hip thrust|glute bridge|сідничн\p{L}* міст|ягідн\p{L}* міст|ягодичн\p{L}* мост|тазов\p{L}* (міст|підйом)/iu, ["gluteal"], ["hamstring", "adductors"]],
  [/romanian|\brdl\b|stiff[- ]?leg|good ?morning|румунськ|румынск|на прямих ногах|на прямых ногах/iu, ["hamstring", "gluteal"], ["lower-back", "adductors", "forearm"]],
  [/deadlift|станов/iu, ["gluteal", "hamstring", "lower-back"], ["quadriceps", "trapezius", "upper-back", "forearm"]],
  [/hip circles?|обертання стегн|вращени\p{L}* таз|вращени\p{L}* бедр/iu, ["gluteal"], ["adductors", "obliques"]],
  [/knee circles?|обертання колін|вращени\p{L}* колен/iu, ["quadriceps"], ["calves"]],
  [/leg press|жим ногами|жим ног|жим платформ|гак-?машин/iu, ["quadriceps", "gluteal"], ["adductors", "hamstring"]],
  [/lunge|split squat|step[- ]?up|випад|выпад|болгарськ|болгарск|зашагув/iu, ["quadriceps", "gluteal"], ["adductors", "hamstring", "calves"]],
  [/squat|присід|присед|гакк|hack/iu, ["quadriceps", "gluteal"], ["adductors", "hamstring", "lower-back"]],
  [/leg extension|розгинання ніг|разгибание ног|розгинання ног/iu, ["quadriceps"], []],
  [/leg curl|hamstring curl|nordic|згинання ніг|сгибание ног|згинання ног/iu, ["hamstring"], ["calves"]],
  [/calf|литк|икр|носк|носок/iu, ["calves"], []],
  [/adduct|привод|зведення ніг|сведение ног/iu, ["adductors"], []],
  [/abduct|відвод|відведення ніг|розведення ніг|разведение ног|отведение ног/iu, ["gluteal"], []],

  // ---- back / lower back ----
  [/hyperext|back extension|гіперекст|гиперэкст|розгинання спини|разгибание спины/iu, ["lower-back"], ["gluteal", "hamstring"]],
  [/pull-?up|chin-?up|pull-?down|lat |підтяг|подтяг|верхнього блок|верхнего блок|вертикальн\p{L}* тяг/iu, ["upper-back"], ["biceps", "forearm", "deltoids"]],
  [/pullover|пуловер/iu, ["upper-back", "chest"], ["triceps"]],
  [/face ?pull|rear delt|reverse fly|bent[- ]?over .*(fly|raise)|(розвед|махи)\p{L}* .*нахил|нахил\p{L}* .*(розвед|махи)|до обличчя|к лицу|зворотн\p{L}* розвед|обратн\p{L}* развед|задн\p{L}* дельт/iu, ["deltoids", "upper-back"], ["trapezius"]],
  [/upright row|до підборіддя|к подбородку/iu, ["deltoids", "trapezius"], ["biceps"]],
  [/shrug|шраг/iu, ["trapezius"], ["forearm"]],
  [/\brows?\b|rowing|тяга|t-bar/iu, ["upper-back"], ["biceps", "deltoids", "trapezius", "lower-back", "forearm"]],

  // ---- chest ----
  // Triceps isolation before the chest presses: "Французький жим лежачи" is not a bench press.
  [/triceps|трицепс|pushdown|push-?down|skull|french|французьк|французск|kickback|розгинання рук|разгибание рук|розгинання на блоці|разгибание на блоке|розгинання з-за голов|розгинання гантел|кікбек/iu, ["triceps"], []],
  // Bodyweight stand-ins (domain/equipmentFit.ts) whose words would otherwise hit the press rules below.
  [/superman|супермен|човник/iu, ["lower-back"], ["gluteal", "hamstring"]],
  [/pike push|пайк/iu, ["deltoids"], ["triceps", "chest"]],
  [/side bend|нахил\p{L}* в бік|наклон\p{L}* в сторону/iu, ["obliques"], ["abs"]],
  [/bench dip|від лави|от скамьи|зворотн\p{L}* віджиман|обратн\p{L}* отжиман/iu, ["triceps"], ["chest", "deltoids"]],
  [/dip|бруси|брусья|брусьях|брусах/iu, ["chest", "triceps"], ["deltoids"]],
  [/(close[- ]?grip|вузьким хват|узким хват).*(bench|press|жим)|(bench|press|жим).*(close[- ]?grip|вузьким хват|узким хват)/iu, ["triceps", "chest"], ["deltoids"]],
  [/\bfly|flyes|флай|cross-?over|кросовер|кроссовер|pec deck|butterfly|батерфляй|зведення рук|сведение рук|розведення гантелей лежачи|розведення рук лежачи|розведен\p{L}*\s.*лежачи|разведение гантелей лежа/iu, ["chest"], ["deltoids"]],
  [/decline|нахилом вниз|головою вниз/iu, ["chest"], ["triceps", "deltoids"]],
  [/incline|під кутом|похил|наклонн/iu, ["chest", "deltoids"], ["triceps"]],
  [/bench|chest press|floor press|жим лежачи|жим лежа|жим від грудей|жим .*на лаві|жим\p{L}*\s.*(з|на|від|с) (підлог|пол)|лежачи|лежа(?!\p{L})/iu, ["chest"], ["triceps", "deltoids"]],
  [/push-?up|віджим|отжим/iu, ["chest", "triceps"], ["deltoids", "abs"]],

  // ---- shoulders ----
  [/overhead|military|shoulder press|arnold|арнольд|армійськ|армейск|жим\s.*(стоячи|сидячи|стоя|сидя|над голов)|жим над голов/iu, ["deltoids"], ["triceps", "trapezius"]],
  [/lateral raise|side raise|махи|[ву] сторон|відведення рук/iu, ["deltoids"], ["trapezius"]],
  [/front .*raise|raise.*front|перед собою/iu, ["deltoids"], ["chest"]],

  // ---- arms ----
  [/hammer|молот/iu, ["biceps", "forearm"], []],
  [/curl|згинання рук|сгибание рук|біцепс|бицепс|скотт|scott|preacher/iu, ["biceps"], ["forearm"]],
  [/wrist|зап'яст|запястья|farmer|фермер/iu, ["forearm"], ["trapezius"]],

  // ---- core ----
  [/side plank|бічна планк|боковая планк|twist|скручування з млинцем|російськ\p{L}* скруч|русск\p{L}* скруч|woodchop|oblique|кос[іы]/iu, ["obliques"], ["abs"]],
  [/plank|планк/iu, ["abs"], ["obliques", "deltoids"]],
  [/crunch|sit-?up|leg raise|ab wheel|скручув|скручив|прес|пресс|підйом ніг|подъем ног|ролик/iu, ["abs"], ["obliques"]],
];

// Last resort: the coarse region a name mentions ("вправа на груди", "leg day finisher").
const REGION_FALLBACK: Array<[RegExp, Slug[]]> = [
  [/груд|chest/iu, ["chest"]],
  [/спин|back|широч/iu, ["upper-back"]],
  [/ног|leg|стегн|бедр/iu, ["quadriceps", "hamstring", "gluteal"]],
  [/плеч|дельт|shoulder/iu, ["deltoids"]],
  [/рук|arm/iu, ["biceps", "triceps"]],
  [/core|кор(?!\p{L})/iu, ["abs", "obliques"]],
];

export function musclesForExercise(name: string): ExerciseMuscles | null {
  const n = name.toLowerCase();
  for (const [re, primary, secondary] of RULES) {
    if (re.test(n)) return { primary, secondary: secondary.filter((s) => !primary.includes(s)) };
  }
  for (const [re, primary] of REGION_FALLBACK) {
    if (re.test(n)) return { primary, secondary: [] };
  }
  return null;
}
