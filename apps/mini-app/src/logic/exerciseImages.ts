// Technique pictures for the logger's info panel, from free-exercise-db (Unlicense; two frames per
// exercise: start and end position). Plans name exercises in Ukrainian, English or Russian, while
// the database is English only, so a name is matched in two steps:
//   1. exactly (case, punctuation and plural "s" ignored) against the database's own names -- the
//      English plan bank and the catalog's canonical names mostly hit here;
//   2. otherwise through a curated table of movement patterns, like ./exerciseMuscles.ts, each
//      pointing at the plainest database exercise of that movement (equipment-specific first).
// A pattern match is a "similar exercise", and the UI says so. Pure; test/mini-app-exercise-images.test.ts.

export interface ExerciseImageMatch {
  id: string; // free-exercise-db id = image folder
  title: string; // its English name
  exact: boolean; // false = the closest movement, not this exact exercise
}

type Rule = [RegExp, string];

// Order matters, as in exerciseMuscles.ts: variants before the general movement.
const RULES: Rule[] = [
  // ---- cardio ----
  [/^\s*(rowing|веслування|гребля)\s*$|rowing machine|row(ing)? erg|ергометр|гребн/iu, "Rowing_Stationary"],
  [/treadmill|доріжк|біг|бег|\brun(ning)?\b|jog|пробіжк/iu, "Jogging_Treadmill"],
  [/велотрен|велосипед(?!.*прес)|bike|cycling|bicycl/iu, "Bicycling_Stationary"],
  [/jump ?rope|rope jump|скакалк/iu, "Rope_Jumping"],
  [/farmer|фермер/iu, "Farmers_Walk"],
  [/^\s*(walk|walking|ходьба|прогулянка)\s*$/iu, "Walking_Treadmill"],
  [/mountain climber|скелелаз|альпініст|альпинист/iu, "Mountain_Climbers"],

  // ---- legs / hips ----
  [/kettlebell swing|swing|махи гир|махи гантел(ею|лю|ями)(?!.*сторон)/iu, "One-Arm_Kettlebell_Swings"],
  [/hip thrust|тазов\p{L}* (підйом|міст)|сідничн\p{L}* міст зі штанг|ягідн\p{L}* міст зі штанг/iu, "Barbell_Hip_Thrust"],
  [/single[- ]leg glute bridge|ягідн\p{L}* міст\p{L}* на одн|міст\p{L}* на одній/iu, "Single_Leg_Glute_Bridge"],
  [/glute bridge|сідничн\p{L}* міст|ягідн\p{L}* міст|ягодичн\p{L}* мост/iu, "Barbell_Glute_Bridge"],
  [/stiff[- ]?leg|на прямих ногах|на прямых ногах/iu, "Stiff-Legged_Barbell_Deadlift"],
  [/romanian|\brdl\b|румунськ|румынск/iu, "Romanian_Deadlift"],
  [/good ?morning|гуд ?морнінг|доброго ранку/iu, "Good_Morning"],
  [/sumo.*dead|сумо.*станов|станов.*сумо/iu, "Sumo_Deadlift"],
  [/trap ?bar|гекс/iu, "Trap_Bar_Deadlift"],
  [/deadlift|станов/iu, "Barbell_Deadlift"],
  [/hack squat|гакк|гак-?присід|гак-?машин/iu, "Hack_Squat"],
  [/leg press|жим ногами|жим ног|жим платформ/iu, "Leg_Press"],
  [/bulgarian|split squat|болгарськ|болгарск|спліт/iu, "Split_Squat_with_Dumbbells"],
  [/step[- ]?up|зашагув|заход\p{L}* на (лаву|платформ|тумб)/iu, "Dumbbell_Step_Ups"],
  [/walking lunge|випади? в русі|випади? з кроком вперед по/iu, "Bodyweight_Walking_Lunge"],
  [/(lunge|випад|выпад).*(dumbbell|гантел)|(dumbbell|гантел).*(lunge|випад|выпад)/iu, "Dumbbell_Lunges"],
  [/(lunge|випад|выпад).*(barbell|штанг)|(barbell|штанг).*(lunge|випад|выпад)/iu, "Barbell_Lunge"],
  [/reverse lunge|back lunge|зворотн\p{L}* випад|випади? назад/iu, "Dumbbell_Rear_Lunge"],
  [/lunge|випад|выпад/iu, "Bodyweight_Walking_Lunge"],
  [/goblet|гоблет|кубок/iu, "Goblet_Squat"],
  [/(front|фронтальн).*(kettlebell|гир)/iu, "Front_Squats_With_Two_Kettlebells"],
  [/olympic squat|олімпійськ\p{L}* присід/iu, "Olympic_Squat"],
  [/front squat|фронтальн\p{L}* присід|фронтальн\p{L}* присед|присід\p{L}* зі штангою на грудях/iu, "Front_Barbell_Squat"],
  [/sumo|сумо|plie|пліє|плие/iu, "Plie_Dumbbell_Squat"],
  [/box squat|squat to box|присід\p{L}* .*на (лаву|бокс|тумб)/iu, "Box_Squat"],
  [/smith.*squat|squat.*smith|присід\p{L}* (в|у) сміт/iu, "Smith_Machine_Squat"],
  [/(squat|присід|присед).*(dumbbell|гантел)|(dumbbell|гантел).*(squat|присід|присед)/iu, "Dumbbell_Squat"],
  [/jump squat|присід\p{L}* з вистрибув|присід\p{L}* зі стрибк|стрибк\p{L}* з присід/iu, "Freehand_Jump_Squat"],
  [/(bodyweight|air|без ваги|з власною вагою|власною вагою).*(squat|присід)|(squat|присід).*(bodyweight|без ваги|власною вагою)/iu, "Bodyweight_Squat"],
  [/full squat|глибок\p{L}* присід/iu, "Barbell_Full_Squat"],
  [/squat|присід|присед/iu, "Barbell_Squat"],
  [/single[- ]leg (leg )?extension|розгинання ноги/iu, "Single-Leg_Leg_Extension"],
  [/leg extension|розгинання ніг|разгибание ног|розгинання ног/iu, "Leg_Extensions"],
  [/(leg curl|hamstring curl|згинання ніг).*(band|стрічк|резин)/iu, "Seated_Band_Hamstring_Curl"],
  [/seated leg curl|згинання ніг сидячи|сгибание ног сидя/iu, "Seated_Leg_Curl"],
  [/standing leg curl|згинання ноги стоячи/iu, "Standing_Leg_Curl"],
  [/leg curl|hamstring curl|згинання ніг|сгибание ног|згинання ног/iu, "Lying_Leg_Curls"],
  [/seated calf|литк\p{L}* сидячи|носки сидячи|икр\p{L}* сидя/iu, "Seated_Calf_Raise"],
  [/(calf|литк|носк).*(dumbbell|гантел)/iu, "Standing_Dumbbell_Calf_Raise"],
  [/calf|литк|икр|носк/iu, "Standing_Calf_Raises"],
  [/glute kickback|donkey kick|махи ног\p{L}* назад|відведення ноги назад/iu, "Glute_Kickback"],

  // ---- back ----
  [/reverse hyper|зворотн\p{L}* гіперекст/iu, "Reverse_Hyperextension"],
  [/hyperext|back extension|гіперекст|гиперэкст|розгинання спини|разгибание спины/iu, "Hyperextensions_Back_Extensions"],
  [/chin-?up|зворотн\p{L}* хват\p{L}*.*підтяг|підтяг\p{L}*.*зворотн\p{L}* хват/iu, "Chin-Up"],
  [/(assisted|band).*pull-?up|pull-?up.*(assisted|band)|підтяг\p{L}* (з|у) (гравітрон|резин|допомог)|гравітрон/iu, "Band_Assisted_Pull-Up"],
  [/weighted pull|підтяг\p{L}* з (обтяж|вагою)/iu, "Weighted_Pull_Ups"],
  [/pull-?up|підтяг|подтяг/iu, "Pullups"],
  [/close[- ]grip.*pull-?down|pull-?down.*close|вузьк\p{L}* хват\p{L}*.*верхн|верхн\p{L}*.*вузьк\p{L}* хват/iu, "Close-Grip_Front_Lat_Pulldown"],
  [/pull-?down|lat |верхнього блок|верхнего блок|вертикальн\p{L}* тяг|тяга блоку до грудей/iu, "Wide-Grip_Lat_Pulldown"],
  [/straight[- ]arm|прямими руками/iu, "Straight-Arm_Pulldown"],
  [/pullover|пуловер/iu, "Bent-Arm_Dumbbell_Pullover"],
  [/face ?pull|до обличчя|к лицу/iu, "Face_Pull"],
  [/upright row|до підборіддя|к подбородку/iu, "Upright_Barbell_Row"],
  [/(shrug|шраг).*(dumbbell|гантел)|(dumbbell|гантел).*(shrug|шраг)/iu, "Dumbbell_Shrug"],
  [/(shrug|шраг).*(leverage|важільн)/iu, "Leverage_Shrug"],
  [/shrug|шраг/iu, "Barbell_Shrug"],
  [/inverted row|австралійськ|австралийск|горизонтальн\p{L}* підтяг/iu, "Inverted_Row"],
  [/t-?bar|т-?гриф|т-подібн|т-образн/iu, "T-Bar_Row_with_Handle"],
  [/seated (cable )?row|cable row|нижнього блок|нижнего блок|горизонтальн\p{L}* блок|горизонтальн\p{L}* тяг|тяга блоку до поясу|тяга блоку сидячи/iu, "Seated_Cable_Rows"],
  [/(row|тяга).*(dumbbell|гантел)|(dumbbell|гантел).*(row|тяга)|one[- ]arm.*row/iu, "One-Arm_Dumbbell_Row"],
  [/smith.*row/iu, "Smith_Machine_Bent_Over_Row"],
  [/\brows?\b|тяга штанги|тяга грифа|тяга\p{L}* .*в нахилі|тяга до поясу/iu, "Bent_Over_Barbell_Row"],

  // ---- chest ----
  [/bench dip|від лави|от скамьи|зворотн\p{L}* віджиман|обратн\p{L}* отжиман/iu, "Bench_Dips"],
  [/dip|бруси|брусья|брусьях|брусах/iu, "Dips_-_Chest_Version"],
  [/close[- ]grip.*(bench|press|жим)|(жим|bench).*(вузьк|узк)\p{L}* хват|(вузьк|узк)\p{L}* хват\p{L}*.*жим/iu, "Close-Grip_Barbell_Bench_Press"],
  [/cable cross|crossover|кросовер|кроссовер|зведення рук (в|у|на) блоц|сведение рук (в|на) блок/iu, "Cable_Crossover"],
  [/pec deck|butterfly|батерфляй|бабочк|метелик|зведення рук (в|у|на) тренажер/iu, "Butterfly"],
  [/incline.*(fly|flye)|(розведення|разведение)\p{L}* .*(під кутом|похил|наклонн)/iu, "Incline_Dumbbell_Flyes"],
  [/\bfly|flye|флай|розведення гантелей лежачи|розведення рук лежачи|разведение гантелей лежа|розведення гантелей на лаві/iu, "Dumbbell_Flyes"],
  [/(incline|під кутом|похил|наклонн).*(dumbbell|гантел)|(dumbbell|гантел).*(incline|під кутом|похил|наклонн)/iu, "Incline_Dumbbell_Press"],
  [/incline|під кутом|похил|наклонн/iu, "Barbell_Incline_Bench_Press_-_Medium_Grip"],
  [/decline|нахилом вниз|головою вниз/iu, "Decline_Barbell_Bench_Press"],
  [/machine.*(chest|bench)|chest press|жим від грудей|жим .*в тренажер|жим .*у тренажер/iu, "Machine_Bench_Press"],
  [/(bench|жим лежачи|жим лежа).*(dumbbell|гантел)|(dumbbell|гантел).*(bench|лежачи|лежа(?!\p{L}))/iu, "Dumbbell_Bench_Press"],
  [/bench|жим лежачи|жим лежа|жим штанги лежачи/iu, "Barbell_Bench_Press_-_Medium_Grip"],
  [/(push-?up|віджим|отжим).*(вузьк|узк|close|diamond|алмаз)/iu, "Push-Ups_-_Close_Triceps_Position"],
  [/(push-?up|віджим|отжим).*(широк|wide)|(wide|широк).*(push-?up|віджим)/iu, "Push-Up_Wide"],
  [/(push-?up|віджим|отжим).*(ноги на|feet elevated|decline)/iu, "Decline_Push-Up"],
  [/(incline|від лави|від стіни).*(push-?up|віджим)|(push-?up|віджим).*(від стіни|від лави|incline)/iu, "Incline_Push-Up"],
  [/push-?up|віджим|отжим/iu, "Pushups"],

  // ---- shoulders ----
  [/arnold|арнольд/iu, "Arnold_Dumbbell_Press"],
  [/rear delt|reverse fly|bent[- ]?over .*(fly|raise)|(розвед|махи)\p{L}* .*нахил|нахил\p{L}* .*(розвед|махи)|задн\p{L}* дельт|зворотн\p{L}* розвед|обратн\p{L}* развед/iu, "Reverse_Flyes"],
  [/front .*raise|raise.*front|перед собою/iu, "Front_Dumbbell_Raise"],
  [/lateral raise|side raise|махи|[ву] сторон|відведення рук|развед\p{L}* .*в сторон/iu, "Side_Lateral_Raise"],
  [/(overhead|shoulder|military|жим\s.*(стоячи|сидячи|стоя|сидя|над голов)|армійськ|армейск).*(dumbbell|гантел)|(dumbbell|гантел).*(стоячи|сидячи|стоя|сидя|над голов|shoulder|overhead)/iu, "Dumbbell_Shoulder_Press"],
  [/overhead|military|shoulder press|армійськ|армейск|жим\s.*(стоячи|сидячи|стоя|сидя|над голов)|жим над голов/iu, "Standing_Military_Press"],

  // ---- arms ----
  [/cross[- ]body hammer|хрест\p{L}* молот|молот\p{L}* .*навхрест/iu, "Cross_Body_Hammer_Curl"],
  [/hammer|молот/iu, "Hammer_Curls"],
  [/preacher|скотт|scott/iu, "Preacher_Curl"],
  [/concentration|концентр/iu, "Concentration_Curls"],
  [/(pushdown|push-?down|розгинання (рук )?на блоці|разгибание на блоке).*(rope|канат|мотуз)|(rope|канат|мотуз).*(pushdown|блоц|блок)/iu, "Triceps_Pushdown_-_Rope_Attachment"],
  [/(pushdown|розгинання (рук )?на блоці).*(reverse|зворотн\p{L}* хват)|reverse grip (triceps )?pushdown/iu, "Reverse_Grip_Triceps_Pushdown"],
  [/pushdown|push-?down|розгинання (рук )?на блоці|разгибание (рук )?на блоке|розгинання рук на блоці/iu, "Triceps_Pushdown"],
  [/skull|french|французьк|французск|lying triceps/iu, "EZ-Bar_Skullcrusher"],
  [/з-за голов|из-за голов|overhead (triceps|extension)|над головою.*трицепс/iu, "Standing_Dumbbell_Triceps_Extension"],
  [/kickback|відведення руки назад|розгинання рук\p{L}* в нахилі/iu, "Tricep_Dumbbell_Kickback"],
  [/triceps|трицепс|розгинання рук|разгибание рук/iu, "Triceps_Pushdown"],
  [/(curl|(?<!роз)згинання рук|сгибание рук|біцепс|бицепс).*(cable|блоц|блок|кросовер)/iu, "Standing_Biceps_Cable_Curl"],
  [/(curl|(?<!роз)згинання рук|сгибание рук|біцепс|бицепс).*(dumbbell|гантел)|(dumbbell|гантел).*(curl|біцепс|бицепс)/iu, "Dumbbell_Bicep_Curl"],
  [/curl|(?<!роз)згинання рук|сгибание рук|біцепс|бицепс/iu, "Barbell_Curl"],
  [/wrist|зап'яст|запястья/iu, "Palms-Up_Barbell_Wrist_Curl_Over_A_Bench"],

  // ---- core ----
  [/side plank|бічна планк|боковая планк|side bridge/iu, "Side_Bridge"],
  [/plank|планк/iu, "Plank"],
  [/russian twist|російськ\p{L}* скруч|русск\p{L}* скруч|twist/iu, "Russian_Twist"],
  [/hanging leg|підйом\p{L}* ніг\p{L}* (у|в) вис|подъем\p{L}* ног в вис|вис.*підйом ніг/iu, "Hanging_Leg_Raise"],
  [/leg raise|підйом\p{L}* ніг|подъем\p{L}* ног/iu, "Flat_Bench_Lying_Leg_Raise"],
  [/cross[- ]body crunch|elbow[- ]to[- ]knee|навхрест|лікоть до коліна|локоть к колену/iu, "Cross-Body_Crunch"],
  [/(crunch|скручуван).*(weighted|млинц|вагою|обтяж)/iu, "Weighted_Crunches"],
  [/cable crunch|скручуван\p{L}* на блоці|скручуван\p{L}* з канатом|молитва/iu, "Cable_Crunch"],
  [/reverse crunch|зворотн\p{L}* скручуван|обратн\p{L}* скручиван/iu, "Reverse_Crunch"],
  [/bicycle|велосипед|air bike/iu, "Air_Bike"],
  [/dead ?bug|мертв\p{L}* жук/iu, "Dead_Bug"],
  [/ab wheel|rollout|ролик/iu, "Ab_Roller"],
  [/crunch|sit-?up|скручув|скручив|прес|пресс/iu, "Crunches"],
];

function normalize(name: string): string {
  return name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map((w) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w))
    .join("");
}

const titleOf = (id: string) => id.replace(/_/g, " ");

/** Build a matcher over the database's ids (passed in so the ~20 KB index stays in a lazy chunk). */
export function makeImageMatcher(ids: string[]) {
  const exact = new Map<string, string>();
  for (const id of ids) {
    const key = normalize(titleOf(id));
    if (key && !exact.has(key)) exact.set(key, id);
  }
  const known = new Set(ids);
  return (name: string, canonicalName?: string): ExerciseImageMatch | null => {
    for (const candidate of [canonicalName, name]) {
      if (!candidate) continue;
      const id = exact.get(normalize(candidate));
      if (id) return { id, title: titleOf(id), exact: true };
    }
    const text = `${canonicalName ?? ""} ${name}`.toLowerCase();
    for (const [re, id] of RULES) {
      if (re.test(text) && known.has(id)) return { id, title: titleOf(id), exact: false };
    }
    return null;
  };
}

/** Both frames of an exercise, served from jsDelivr's GitHub CDN at the pinned commit. */
export function exerciseImageUrls(id: string, commit: string): string[] {
  const base = `https://cdn.jsdelivr.net/gh/yuhonas/free-exercise-db@${commit}/exercises/${encodeURIComponent(id)}`;
  return [`${base}/0.jpg`, `${base}/1.jpg`];
}

export const RULE_TARGETS = RULES.map(([, id]) => id);
