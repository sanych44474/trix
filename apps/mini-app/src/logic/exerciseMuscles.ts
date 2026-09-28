// Which muscles an exercise works, for the body map: primary movers and secondary helpers, in the
// figure's own vocabulary (react-muscle-highlighter slugs). The exercise catalog only stores one
// primary muscle per exercise and plans only carry a free-text hint, so this is a small curated
// table of movement patterns, matched on the name in Ukrainian, English and common Russian.
// Pure and unit-tested (test/mini-app-exercise-muscles.test.ts).
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
  [/\b(run|running|jog|jogging|treadmill)\b|біг|бег|пробіжк|доріжк/iu, ["quadriceps", "calves", "hamstring"], ["gluteal"]],
  [/\b(bike|cycling|spin)\b|велос|велотрен/iu, ["quadriceps"], ["calves", "gluteal", "hamstring"]],
  [/\b(swim|swimming)\b|плаван/iu, ["upper-back", "deltoids"], ["chest", "triceps"]],
  [/^\s*(walk|walking|hike|hiking)\s*$|ходьба|прогулянк(?!а фермера)|похід/iu, ["calves", "quadriceps"], ["gluteal"]],
  [/jump ?rope|скакалк/iu, ["calves"], ["quadriceps", "deltoids"]],
  [/elliptical|еліпт|еліпс|stair|степер/iu, ["quadriceps", "gluteal"], ["calves", "hamstring"]],

  // ---- legs / hips ----
  [/kettlebell swing|swing|махи гир/iu, ["gluteal", "hamstring"], ["lower-back", "deltoids"]],
  [/hip thrust|glute bridge|сідничн\w* міст|ягодичн\w* мост|тазов\w* (міст|підйом)/iu, ["gluteal"], ["hamstring", "adductors"]],
  [/romanian|\brdl\b|stiff[- ]?leg|good ?morning|румунськ|румынск|на прямих ногах|на прямых ногах/iu, ["hamstring", "gluteal"], ["lower-back", "adductors", "forearm"]],
  [/deadlift|станов/iu, ["gluteal", "hamstring", "lower-back"], ["quadriceps", "trapezius", "upper-back", "forearm"]],
  [/leg press|жим ногами|жим ног|гак-?машин/iu, ["quadriceps", "gluteal"], ["adductors", "hamstring"]],
  [/lunge|split squat|step[- ]?up|випад|выпад|болгарськ|болгарск|зашагув/iu, ["quadriceps", "gluteal"], ["adductors", "hamstring", "calves"]],
  [/squat|присід|присед|гакк|hack/iu, ["quadriceps", "gluteal"], ["adductors", "hamstring", "lower-back"]],
  [/leg extension|розгинання ніг|разгибание ног|розгинання ног/iu, ["quadriceps"], []],
  [/leg curl|hamstring curl|nordic|згинання ніг|сгибание ног|згинання ног/iu, ["hamstring"], ["calves"]],
  [/calf|литк|икр|носк/iu, ["calves"], []],
  [/adduct|привод|зведення ніг|сведение ног/iu, ["adductors"], []],
  [/abduct|відвод|відведення ніг|розведення ніг|разведение ног|отведение ног/iu, ["gluteal"], []],

  // ---- back / lower back ----
  [/hyperext|back extension|гіперекст|гиперэкст|розгинання спини|разгибание спины/iu, ["lower-back"], ["gluteal", "hamstring"]],
  [/pull-?up|chin-?up|pulldown|lat |підтяг|подтяг|верхнього блок|верхнего блок|вертикальн\w* тяг/iu, ["upper-back"], ["biceps", "forearm", "deltoids"]],
  [/pullover|пуловер/iu, ["upper-back", "chest"], ["triceps"]],
  [/face ?pull|rear delt|reverse fly|тяга до обличчя|тяга к лицу|зворотн\w* розвед|обратн\w* развед|задн\w* дельт/iu, ["deltoids", "upper-back"], ["trapezius"]],
  [/upright row|до підборіддя|к подбородку/iu, ["deltoids", "trapezius"], ["biceps"]],
  [/shrug|шраг/iu, ["trapezius"], ["forearm"]],
  [/\brow\b|rowing|тяга|t-bar/iu, ["upper-back"], ["biceps", "deltoids", "trapezius", "lower-back", "forearm"]],

  // ---- chest ----
  // Triceps isolation before the chest presses: "Французький жим лежачи" is not a bench press.
  [/triceps|трицепс|pushdown|push-?down|skull|french|французьк|французск|kickback|розгинання рук|разгибание рук|розгинання на блоці|разгибание на блоке|розгинання з-за голов/iu, ["triceps"], []],
  [/dip|бруси|брусья|брусьях|брусах/iu, ["chest", "triceps"], ["deltoids"]],
  [/close[- ]?grip|вузьким хват|узким хват/iu, ["triceps", "chest"], ["deltoids"]],
  [/incline|під кутом|похил|наклонн/iu, ["chest", "deltoids"], ["triceps"]],
  [/bench|chest press|жим лежачи|жим лежа|лежачи|лежа\b/iu, ["chest"], ["triceps", "deltoids"]],
  [/push-?up|віджим|отжим/iu, ["chest", "triceps"], ["deltoids", "abs"]],
  [/fly|flye|флай|кросовер|кроссовер|pec deck|зведення рук|сведение рук|розведення гантелей лежачи/iu, ["chest"], ["deltoids"]],

  // ---- shoulders ----
  [/overhead|military|shoulder press|arnold|армійськ|армейск|жим\s.*(стоячи|сидячи|стоя|сидя|над голов)|жим над голов/iu, ["deltoids"], ["triceps", "trapezius"]],
  [/lateral raise|махи|в сторон|розведення рук у сторон|відведення рук/iu, ["deltoids"], ["trapezius"]],
  [/front raise|перед собою/iu, ["deltoids"], ["chest"]],

  // ---- arms ----
  [/hammer|молот/iu, ["biceps", "forearm"], []],
  [/curl|згинання рук|сгибание рук|біцепс|бицепс|скотт|scott|preacher/iu, ["biceps"], ["forearm"]],
  [/wrist|зап'яст|запястья|farmer|фермер/iu, ["forearm"], ["trapezius"]],

  // ---- core ----
  [/side plank|бічна планк|боковая планк|russian twist|російськ\w* скруч|русск\w* скруч|woodchop|oblique|кос[іы]/iu, ["obliques"], ["abs"]],
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
  [/core|кор\b/iu, ["abs", "obliques"]],
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
