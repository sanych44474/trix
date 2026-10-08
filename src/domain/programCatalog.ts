// Ready-made training programs: 45 hand-written plans anyone can apply to themselves from the
// Mini App (More → Ready programs), and that the plan bank also offers when it picks a plan for a
// new athlete (adapters/d1/v2Plans.ts listPlanBank appends catalogBankEntries()).
//
// 15 for the gym, 15 for home with dumbbells, 15 with no equipment. Each place has five program
// styles -- for men, for women, or for everyone -- and every style comes at three loads:
//   beginner      fewer exercises, 2–3 work sets, RPE 7, easier variants, longer rest;
//   intermediate  a full session, 3–4 sets, RPE 8;
//   advanced      the most exercises and sets, RPE 8–9, heavier rep ranges or harder variants.
// The load per exercise is set for a reference body; adaptPlan + finishGeneratedSplit turn it
// into the person's own start weights (beginners pick by feel, baseline lifts calibrate).
import type { BankPlan, ExperienceLevel, GoalBucket, Lang, PlanBankEntry, PlanDay, PlanExercise, Weekday } from "../types";

export type ProgramPlace = "gym" | "dumbbells" | "bodyweight";
export type ProgramAudience = "men" | "women" | "all";
type Bi = { en: string; uk: string };
type Kind = "kg" | "bw" | "time";

interface ExerciseDef {
  en: string;
  uk: string;
  kind: Kind;
  /** Reference load for an intermediate ~80 kg man (per hand / per side as `mode` says). */
  kg?: number;
  mode?: "perHand" | "perSide";
  /** Compound lift: heavier scheme, longer rest, tracked as a key lift. */
  primary?: boolean;
  cue: Bi;
  muscles: string;
}

// ---------------------------------------------------------------------------------------------
// Exercises. Names follow common English naming so technique pictures (free-exercise-db) match.
// ---------------------------------------------------------------------------------------------
const EX = {
  // gym
  squat: { en: "Barbell Back Squat", uk: "Присідання зі штангою", kind: "kg", kg: 70, primary: true, muscles: "quads, glutes", cue: { en: "Brace, sit between the hips, knees track over toes, drive up through the whole foot.", uk: "Напруж корпус, сідай між стегнами, коліна за носками, вставай через усю стопу." } },
  leg_press: { en: "Leg Press", uk: "Жим ногами", kind: "kg", kg: 120, primary: true, muscles: "quads, glutes", cue: { en: "Lower until hips stay on the pad, push through heels, don't lock the knees.", uk: "Опускай, доки таз не відривається, тисни п'ятами, не блокуй коліна." } },
  rdl: { en: "Romanian Deadlift", uk: "Румунська тяга", kind: "kg", kg: 60, primary: true, muscles: "hamstrings, glutes", cue: { en: "Soft knees, push hips back, bar close to the legs, flat back.", uk: "Коліна злегка зігнуті, таз назад, гриф біля ніг, спина рівна." } },
  deadlift: { en: "Barbell Deadlift", uk: "Станова тяга", kind: "kg", kg: 90, primary: true, muscles: "back, glutes, hamstrings", cue: { en: "Bar over mid-foot, chest up, push the floor away, hips and shoulders rise together.", uk: "Гриф над серединою стопи, груди вгору, відштовхуй підлогу, таз і плечі йдуть разом." } },
  hip_thrust: { en: "Barbell Hip Thrust", uk: "Ягідний міст зі штангою", kind: "kg", kg: 70, primary: true, muscles: "glutes", cue: { en: "Shoulders on the bench, chin tucked, squeeze the glutes at the top, ribs down.", uk: "Лопатки на лаві, підборіддя до грудей, стискай сідниці вгорі, ребра вниз." } },
  bench: { en: "Barbell Bench Press", uk: "Жим штанги лежачи", kind: "kg", kg: 60, primary: true, muscles: "chest, triceps", cue: { en: "Shoulder blades pinched, feet planted, lower to the lower chest, press up and slightly back.", uk: "Лопатки зведені, ноги впираються, опускай до низу грудей, тисни вгору." } },
  incline_db: { en: "Incline Dumbbell Press", uk: "Жим гантелей на похилій лаві", kind: "kg", kg: 22, mode: "perHand", primary: true, muscles: "upper chest, shoulders", cue: { en: "Bench at 30°, elbows ~45° from the body, press up and in.", uk: "Лава 30°, лікті ~45° від тулуба, тисни вгору й до центру." } },
  ohp: { en: "Overhead Press", uk: "Жим штанги стоячи", kind: "kg", kg: 40, primary: true, muscles: "shoulders, triceps", cue: { en: "Squeeze glutes, bar over mid-foot, head moves back then through.", uk: "Стисни сідниці, гриф над серединою стопи, голова відходить і повертається вперед." } },
  db_seated_press: { en: "Seated Dumbbell Shoulder Press", uk: "Жим гантелей сидячи", kind: "kg", kg: 16, mode: "perHand", muscles: "shoulders, triceps", cue: { en: "Back on the pad, press up without clanking the dumbbells.", uk: "Спина до спинки, тисни вгору, не стукай гантелями." } },
  lat_pulldown: { en: "Lat Pulldown", uk: "Тяга верхнього блока", kind: "kg", kg: 55, primary: true, muscles: "lats, biceps", cue: { en: "Chest up, pull the bar to the upper chest with the elbows, control the way up.", uk: "Груди вгору, тягни до верху грудей ліктями, повертай повільно." } },
  pullup: { en: "Pull-Up", uk: "Підтягування", kind: "bw", primary: true, muscles: "lats, biceps", cue: { en: "Start from a dead hang, pull the chest to the bar, no swinging.", uk: "З повного вису, груди до перекладини, без розгойдування." } },
  cable_row: { en: "Seated Cable Row", uk: "Тяга горизонтального блока", kind: "kg", kg: 50, muscles: "mid back, lats", cue: { en: "Sit tall, pull the handle to the belly, squeeze the shoulder blades.", uk: "Сиди рівно, тягни до живота, зводь лопатки." } },
  barbell_row: { en: "Bent-Over Barbell Row", uk: "Тяга штанги в нахилі", kind: "kg", kg: 50, primary: true, muscles: "back, lats", cue: { en: "Hinge to ~45°, flat back, pull to the lower ribs.", uk: "Нахил ~45°, спина рівна, тягни до нижніх ребер." } },
  db_row: { en: "One-Arm Dumbbell Row", uk: "Тяга гантелі однією рукою", kind: "kg", kg: 24, mode: "perSide", muscles: "lats, mid back", cue: { en: "Hand and knee on the bench, pull the dumbbell to the hip.", uk: "Рука й коліно на лаві, тягни гантель до стегна." } },
  leg_curl: { en: "Lying Leg Curl", uk: "Згинання ніг лежачи", kind: "kg", kg: 35, muscles: "hamstrings", cue: { en: "Hips pressed down, curl fully, lower slowly.", uk: "Таз притиснутий, згинай повністю, опускай повільно." } },
  leg_ext: { en: "Leg Extension", uk: "Розгинання ніг сидячи", kind: "kg", kg: 40, muscles: "quads", cue: { en: "Pause at the top, lower under control.", uk: "Пауза вгорі, опускай під контролем." } },
  calf_raise: { en: "Standing Calf Raise", uk: "Підйоми на носки стоячи", kind: "kg", kg: 60, muscles: "calves", cue: { en: "Full stretch at the bottom, pause at the top.", uk: "Повне розтягнення внизу, пауза вгорі." } },
  lateral_raise: { en: "Dumbbell Lateral Raise", uk: "Махи гантелями в сторони", kind: "kg", kg: 8, mode: "perHand", muscles: "side delts", cue: { en: "Lead with the elbows, stop at shoulder height, no swinging.", uk: "Веди ліктями, до рівня плечей, без ривків." } },
  face_pull: { en: "Face Pull", uk: "Тяга канату до обличчя", kind: "kg", kg: 20, muscles: "rear delts, upper back", cue: { en: "Rope to the eyes, elbows high, rotate the hands back.", uk: "Канат до очей, лікті високо, розвертай кисті назад." } },
  pushdown: { en: "Triceps Pushdown", uk: "Розгинання рук на блоці", kind: "kg", kg: 25, muscles: "triceps", cue: { en: "Elbows pinned to the sides, full lockout.", uk: "Лікті притиснуті, повне розгинання." } },
  barbell_curl: { en: "Barbell Curl", uk: "Згинання рук зі штангою", kind: "kg", kg: 25, muscles: "biceps", cue: { en: "Elbows still, curl without leaning back.", uk: "Лікті нерухомі, без відхилення корпусу." } },
  cable_fly: { en: "Cable Crossover", uk: "Зведення рук у кросовері", kind: "kg", kg: 15, muscles: "chest", cue: { en: "Slight elbow bend, hug a tree, squeeze in the middle.", uk: "Лікті злегка зігнуті, наче обіймаєш дерево, стискай у центрі." } },
  bulgarian_db: { en: "Bulgarian Split Squat", uk: "Болгарські випади", kind: "kg", kg: 12, mode: "perHand", muscles: "quads, glutes", cue: { en: "Rear foot on the bench, front shin fairly vertical, drop straight down.", uk: "Задня нога на лаві, гомілка передньої майже вертикально, опускайся вниз." } },
  walking_lunge: { en: "Dumbbell Walking Lunge", uk: "Випади з гантелями в русі", kind: "kg", kg: 12, mode: "perHand", muscles: "quads, glutes", cue: { en: "Long step, back knee almost to the floor, push off the front heel.", uk: "Довгий крок, заднє коліно майже до підлоги, відштовхуйся передньою п'ятою." } },
  kickback: { en: "Cable Glute Kickback", uk: "Відведення ноги назад у кросовері", kind: "kg", kg: 15, mode: "perSide", muscles: "glutes", cue: { en: "Hinge slightly, kick back and up without arching the lower back.", uk: "Легкий нахил, відводь ногу назад-угору без прогину в попереку." } },
  abduction: { en: "Hip Abduction Machine", uk: "Розведення ніг у тренажері", kind: "kg", kg: 40, muscles: "glutes (side)", cue: { en: "Lean slightly forward, push out, pause, return slowly.", uk: "Легкий нахил уперед, розводь, пауза, повертай повільно." } },
  hanging_knee_raise: { en: "Hanging Knee Raise", uk: "Підйоми колін у висі", kind: "bw", muscles: "abs", cue: { en: "Curl the pelvis up, no swinging.", uk: "Підкручуй таз, без розгойдування." } },
  cable_crunch: { en: "Cable Crunch", uk: "Скручування на блоці", kind: "kg", kg: 30, muscles: "abs", cue: { en: "Round the spine, elbows to the knees, hips still.", uk: "Округлюй спину, лікті до колін, таз нерухомий." } },
  dips: { en: "Dips", uk: "Віджимання на брусах", kind: "bw", muscles: "chest, triceps", cue: { en: "Lean slightly forward, lower to 90° at the elbow, press up.", uk: "Легкий нахил уперед, до 90° у лікті, вижимай угору." } },
  rower: { en: "Rowing Machine", uk: "Гребний тренажер", kind: "time", muscles: "full body, cardio", cue: { en: "Legs, then body, then arms; steady breathing.", uk: "Ноги, корпус, руки; рівне дихання." } },
  bike_intervals: { en: "Stationary Bike Intervals", uk: "Велотренажер: інтервали", kind: "time", muscles: "cardio", cue: { en: "30 s hard, 30 s easy, keep the cadence high.", uk: "30 с інтенсивно, 30 с легко, висока каденція." } },
  kb_swing: { en: "Kettlebell Swing", uk: "Махи гирею", kind: "kg", kg: 16, muscles: "glutes, hamstrings", cue: { en: "Snap the hips, arms just guide the bell to chest height.", uk: "Різкий рух тазом, руки лише ведуть гирю до рівня грудей." } },
  plank: { en: "Plank", uk: "Планка", kind: "time", muscles: "core", cue: { en: "Elbows under shoulders, body in one line, squeeze glutes.", uk: "Лікті під плечима, тіло в одну лінію, сідниці напружені." } },

  // dumbbells at home
  goblet_squat: { en: "Goblet Squat", uk: "Гоблет-присідання", kind: "kg", kg: 20, primary: true, muscles: "quads, glutes", cue: { en: "Dumbbell at the chest, elbows inside the knees, sit deep.", uk: "Гантель біля грудей, лікті між колінами, сідай глибоко." } },
  db_rdl: { en: "Dumbbell Romanian Deadlift", uk: "Румунська тяга з гантелями", kind: "kg", kg: 16, mode: "perHand", primary: true, muscles: "hamstrings, glutes", cue: { en: "Dumbbells slide along the thighs, hips back, flat back.", uk: "Гантелі ковзають по стегнах, таз назад, спина рівна." } },
  db_floor_press: { en: "Dumbbell Floor Press", uk: "Жим гантелей лежачи на підлозі", kind: "kg", kg: 18, mode: "perHand", primary: true, muscles: "chest, triceps", cue: { en: "Upper arms touch the floor softly, press up and slightly in.", uk: "Плечі м'яко торкаються підлоги, тисни вгору й до центру." } },
  db_bent_row: { en: "Bent-Over Dumbbell Row", uk: "Тяга гантелей у нахилі", kind: "kg", kg: 16, mode: "perHand", primary: true, muscles: "back, lats", cue: { en: "Hinge forward, flat back, pull both dumbbells to the hips.", uk: "Нахил уперед, спина рівна, тягни обидві гантелі до стегон." } },
  db_press_standing: { en: "Dumbbell Shoulder Press", uk: "Жим гантелей стоячи", kind: "kg", kg: 14, mode: "perHand", primary: true, muscles: "shoulders, triceps", cue: { en: "Squeeze glutes, press overhead without arching.", uk: "Стисни сідниці, тисни над головою без прогину." } },
  db_curl: { en: "Dumbbell Curl", uk: "Згинання рук з гантелями", kind: "kg", kg: 10, mode: "perHand", muscles: "biceps", cue: { en: "Elbows by the sides, turn the palms up as you curl.", uk: "Лікті біля тулуба, розвертай долоні вгору." } },
  hammer_curl: { en: "Hammer Curl", uk: "Молоткові згинання", kind: "kg", kg: 10, mode: "perHand", muscles: "biceps, forearms", cue: { en: "Neutral grip, no swinging.", uk: "Нейтральний хват, без ривків." } },
  db_triceps_ext: { en: "Overhead Dumbbell Triceps Extension", uk: "Розгинання гантелі з-за голови", kind: "kg", kg: 12, muscles: "triceps", cue: { en: "Elbows point up, lower behind the head, extend fully.", uk: "Лікті дивляться вгору, опускай за голову, розгинай повністю." } },
  db_reverse_lunge: { en: "Dumbbell Reverse Lunge", uk: "Зворотні випади з гантелями", kind: "kg", kg: 10, mode: "perHand", muscles: "quads, glutes", cue: { en: "Step back, torso upright, drive through the front heel.", uk: "Крок назад, корпус рівно, вставай через передню п'яту." } },
  db_bulgarian: { en: "Dumbbell Bulgarian Split Squat", uk: "Болгарські випади з гантелями", kind: "kg", kg: 10, mode: "perHand", muscles: "quads, glutes", cue: { en: "Rear foot on a chair, lower straight down.", uk: "Задня нога на стільці, опускайся прямо вниз." } },
  db_hip_thrust: { en: "Dumbbell Hip Thrust", uk: "Ягідний міст з гантеллю", kind: "kg", kg: 20, primary: true, muscles: "glutes", cue: { en: "Shoulders on the sofa, dumbbell on the hips, squeeze at the top.", uk: "Лопатки на дивані, гантель на тазі, стискай сідниці вгорі." } },
  db_sumo_squat: { en: "Dumbbell Sumo Squat", uk: "Присідання сумо з гантеллю", kind: "kg", kg: 20, muscles: "glutes, inner thighs", cue: { en: "Wide stance, toes out, knees follow the toes.", uk: "Широка стійка, носки назовні, коліна за носками." } },
  db_step_up: { en: "Dumbbell Step-Up", uk: "Зашагування на стілець з гантелями", kind: "kg", kg: 8, mode: "perHand", muscles: "quads, glutes", cue: { en: "Whole foot on the step, push through the heel, don't push off the back leg.", uk: "Уся стопа на опорі, вставай п'ятою, не відштовхуйся задньою ногою." } },
  db_fly: { en: "Dumbbell Floor Fly", uk: "Розведення гантелей лежачи", kind: "kg", kg: 8, mode: "perHand", muscles: "chest", cue: { en: "Slight elbow bend, open wide, bring together over the chest.", uk: "Лікті злегка зігнуті, розводь широко, зводь над грудьми." } },
  db_calf: { en: "Single-Leg Dumbbell Calf Raise", uk: "Підйоми на носок з гантеллю", kind: "kg", kg: 12, mode: "perSide", muscles: "calves", cue: { en: "Ball of the foot on a step, full range, slow down.", uk: "Носок на сходинці, повна амплітуда, повільно вниз." } },
  db_reverse_fly: { en: "Bent-Over Reverse Fly", uk: "Розведення гантелей у нахилі", kind: "kg", kg: 6, mode: "perHand", muscles: "rear delts, upper back", cue: { en: "Hinge forward, open the arms out to the sides, squeeze the shoulder blades.", uk: "Нахил уперед, розводь руки в сторони, зводь лопатки." } },
  db_lateral: { en: "Dumbbell Lateral Raise", uk: "Махи гантелями в сторони", kind: "kg", kg: 6, mode: "perHand", muscles: "side delts", cue: { en: "Lead with the elbows to shoulder height.", uk: "Веди ліктями до рівня плечей." } },
  db_swing: { en: "Dumbbell Swing", uk: "Махи гантеллю", kind: "kg", kg: 14, muscles: "glutes, hamstrings", cue: { en: "Hinge and snap the hips, the arms only guide.", uk: "Нахил і різкий рух тазом, руки лише ведуть." } },
  db_thruster: { en: "Dumbbell Thruster", uk: "Трастер з гантелями", kind: "kg", kg: 8, mode: "perHand", muscles: "full body", cue: { en: "Squat, then use the drive up to press overhead.", uk: "Присід, і на підйомі вижимай гантелі над головою." } },
  renegade_row: { en: "Renegade Row", uk: "Тяга гантелей у планці", kind: "kg", kg: 10, mode: "perHand", muscles: "back, core", cue: { en: "Wide feet, hips square, row one side at a time.", uk: "Ноги ширше, таз не розвертається, тягни по черзі." } },
  db_russian_twist: { en: "Russian Twist with Dumbbell", uk: "Російські скручування з гантеллю", kind: "kg", kg: 6, muscles: "obliques", cue: { en: "Lean back, rotate from the ribs, not the arms.", uk: "Відхились назад, повертай корпус, а не руки." } },

  // no equipment
  bw_squat: { en: "Bodyweight Squat", uk: "Присідання з власною вагою", kind: "bw", primary: true, muscles: "quads, glutes", cue: { en: "Arms forward, sit deep, heels down.", uk: "Руки вперед, сідай глибоко, п'яти на підлозі." } },
  jump_squat: { en: "Jump Squat", uk: "Присідання з вистрибуванням", kind: "bw", muscles: "quads, glutes, power", cue: { en: "Squat, jump explosively, land softly into the next rep.", uk: "Присід, вибухово вистрибуй, м'яко приземляйся в наступний повтор." } },
  reverse_lunge: { en: "Reverse Lunge", uk: "Зворотні випади", kind: "bw", muscles: "quads, glutes", cue: { en: "Step back, back knee almost to the floor.", uk: "Крок назад, заднє коліно майже до підлоги." } },
  bw_bulgarian: { en: "Bulgarian Split Squat (chair)", uk: "Болгарські випади зі стільцем", kind: "bw", primary: true, muscles: "quads, glutes", cue: { en: "Rear foot on a chair, lower slowly, drive up through the front heel.", uk: "Задня нога на стільці, опускайся повільно, вставай передньою п'ятою." } },
  pistol_assisted: { en: "Assisted Pistol Squat", uk: "Присідання на одній нозі з опорою", kind: "bw", primary: true, muscles: "quads, glutes", cue: { en: "Hold a door frame, lower on one leg as deep as you control.", uk: "Тримайся за одвірок, опускайся на одній нозі так глибоко, як контролюєш." } },
  glute_bridge: { en: "Glute Bridge", uk: "Ягідний міст", kind: "bw", muscles: "glutes", cue: { en: "Heels close, push the hips up, squeeze 1 s at the top.", uk: "П'яти ближче, піднімай таз, стисни сідниці на 1 с угорі." } },
  sl_bridge: { en: "Single-Leg Glute Bridge", uk: "Ягідний міст на одній нозі", kind: "bw", primary: true, muscles: "glutes", cue: { en: "One leg up, hips level, drive through the heel.", uk: "Одна нога вгорі, таз рівно, тисни п'ятою." } },
  donkey_kick: { en: "Donkey Kick", uk: "Відведення ноги назад на колінах", kind: "bw", muscles: "glutes", cue: { en: "On all fours, kick the heel to the ceiling, no low-back arch.", uk: "На четвереньках, п'ята до стелі, без прогину в попереку." } },
  side_leg_raise: { en: "Side-Lying Leg Raise", uk: "Відведення ноги лежачи на боці", kind: "bw", muscles: "glutes (side)", cue: { en: "Toes slightly down, lift without rolling back.", uk: "Носок трохи вниз, піднімай, не завалюючись назад." } },
  wall_sit: { en: "Wall Sit", uk: "Стільчик біля стіни", kind: "time", muscles: "quads", cue: { en: "Thighs parallel to the floor, back flat on the wall.", uk: "Стегна паралельно підлозі, спина притиснута до стіни." } },
  sl_calf: { en: "Single-Leg Calf Raise", uk: "Підйоми на носок на одній нозі", kind: "bw", muscles: "calves", cue: { en: "On a step edge, full range, slow down.", uk: "На краю сходинки, повна амплітуда, повільно вниз." } },
  knee_pushup: { en: "Knee Push-Up", uk: "Віджимання з колін", kind: "bw", primary: true, muscles: "chest, triceps", cue: { en: "Body straight from knees to head, chest to the floor.", uk: "Тіло рівне від колін до голови, груди до підлоги." } },
  incline_pushup: { en: "Incline Push-Up", uk: "Віджимання від столу", kind: "bw", primary: true, muscles: "chest, triceps", cue: { en: "Hands on a table edge, body straight, chest to the edge.", uk: "Руки на краю столу, тіло рівне, груди до краю." } },
  pushup: { en: "Push-Up", uk: "Віджимання", kind: "bw", primary: true, muscles: "chest, triceps", cue: { en: "Hands under shoulders, elbows ~45°, body in one line.", uk: "Руки під плечима, лікті ~45°, тіло в одну лінію." } },
  decline_pushup: { en: "Decline Push-Up", uk: "Віджимання з ногами на стільці", kind: "bw", primary: true, muscles: "upper chest, shoulders", cue: { en: "Feet on a chair, keep the hips from sagging.", uk: "Ноги на стільці, таз не провисає." } },
  diamond_pushup: { en: "Diamond Push-Up", uk: "Віджимання вузьким хватом", kind: "bw", muscles: "triceps, chest", cue: { en: "Hands together under the chest, elbows close.", uk: "Долоні разом під грудьми, лікті близько до тулуба." } },
  pike_pushup: { en: "Pike Push-Up", uk: "Віджимання «гірка»", kind: "bw", muscles: "shoulders", cue: { en: "Hips high, lower the head between the hands.", uk: "Таз високо, опускай голову між долонями." } },
  chair_dips: { en: "Bench Dips (chair)", uk: "Віджимання від стільця", kind: "bw", muscles: "triceps", cue: { en: "Hands on a chair, elbows back, lower to 90°.", uk: "Руки на стільці, лікті назад, опускайся до 90°." } },
  table_row: { en: "Inverted Row (under a table)", uk: "Тяга лежачи під столом", kind: "bw", primary: true, muscles: "back, biceps", cue: { en: "Lie under a sturdy table, grip the edge, pull the chest up, body straight.", uk: "Ляж під міцний стіл, візьмися за край, тягни груди вгору, тіло рівне." } },
  superman: { en: "Superman", uk: "Супермен", kind: "bw", muscles: "lower back, glutes", cue: { en: "Lift arms and legs, hold 2 s, look at the floor.", uk: "Підніми руки й ноги, тримай 2 с, погляд у підлогу." } },
  prone_ytw: { en: "Prone Y-T-W Raise", uk: "Підйоми рук Y-T-W лежачи", kind: "bw", muscles: "upper back, rear delts", cue: { en: "Face down, thumbs up, lift the arms in Y, T and W shapes.", uk: "Лежачи на животі, великі пальці вгору, підіймай руки буквами Y, T, W." } },
  side_plank: { en: "Side Plank", uk: "Бічна планка", kind: "time", muscles: "obliques", cue: { en: "Elbow under the shoulder, hips high, body straight.", uk: "Лікоть під плечем, таз високо, тіло рівне." } },
  dead_bug: { en: "Dead Bug", uk: "Мертвий жук", kind: "bw", muscles: "core", cue: { en: "Low back pressed down, extend the opposite arm and leg slowly.", uk: "Поперек притиснутий, повільно випрямляй протилежні руку й ногу." } },
  hollow_hold: { en: "Hollow Hold", uk: "Утримання «човник»", kind: "time", muscles: "core", cue: { en: "Low back on the floor, shoulders and legs up.", uk: "Поперек на підлозі, плечі й ноги підняті." } },
  leg_raise: { en: "Lying Leg Raise", uk: "Підйоми ніг лежачи", kind: "bw", muscles: "lower abs", cue: { en: "Low back stays down, lower the legs slowly.", uk: "Поперек притиснутий, опускай ноги повільно." } },
  mountain_climber: { en: "Mountain Climbers", uk: "Скелелаз", kind: "time", muscles: "core, cardio", cue: { en: "Plank position, drive the knees fast, hips low.", uk: "Упор лежачи, швидко підтягуй коліна, таз низько." } },
  burpee: { en: "Burpee", uk: "Берпі", kind: "bw", muscles: "full body, cardio", cue: { en: "Squat, jump back to plank, chest down, jump up.", uk: "Присід, стрибок в упор лежачи, груди вниз, вистрибування." } },
  jumping_jack: { en: "Jumping Jacks", uk: "Стрибки «зірочка»", kind: "time", muscles: "cardio", cue: { en: "Light on the toes, steady rhythm.", uk: "Легко на носках, рівний ритм." } },
  high_knees: { en: "High Knees", uk: "Біг на місці з високим підніманням колін", kind: "time", muscles: "cardio", cue: { en: "Knees to hip height, quick arms.", uk: "Коліна до рівня стегон, активні руки." } },
  bicycle_crunch: { en: "Bicycle Crunch", uk: "Велосипед (скручування)", kind: "bw", muscles: "abs, obliques", cue: { en: "Elbow toward the opposite knee, slow and controlled.", uk: "Лікоть до протилежного коліна, повільно й контрольовано." } },
  skater_jump: { en: "Skater Jumps", uk: "Стрибки ковзаняра", kind: "bw", muscles: "glutes, cardio", cue: { en: "Leap side to side, land softly on one leg.", uk: "Стрибки з боку в бік, м'яко на одну ногу." } },
} satisfies Record<string, ExerciseDef>;

export type ExerciseKey = keyof typeof EX;

/** One exercise slot: a key, or a different exercise per load level (easier → harder). */
type Slot = ExerciseKey | { b: ExerciseKey; i: ExerciseKey; a: ExerciseKey };

interface DayDef {
  title: Bi;
  /** In order of importance: beginners do the first 5, intermediate 6, advanced all (7). */
  slots: Slot[];
}

type Style = "strength" | "muscle" | "glutes" | "toned" | "conditioning";

interface StyleDef {
  id: string;
  place: ProgramPlace;
  audience: ProgramAudience;
  style: Style;
  goal: GoalBucket;
  name: Bi;
  summary: Bi;
  /** Training days for beginner / intermediate / advanced (cycles through `days`). */
  daysPerWeek: [number, number, number];
  days: DayDef[];
}

const T = (en: string, uk: string): Bi => ({ en, uk });

// ---------------------------------------------------------------------------------------------
// 15 styles (5 per place). Each becomes 3 programs: beginner, intermediate, advanced.
// ---------------------------------------------------------------------------------------------
const STYLES: StyleDef[] = [
  // ---- gym ----
  {
    id: "gym-fullbody", place: "gym", audience: "all", style: "muscle", goal: "recomp",
    name: T("Gym full body", "Зал: все тіло"),
    summary: T("Three full-body sessions a week: the big lifts plus a little of everything. The best start in the gym.", "Три тренування на все тіло на тиждень: базові вправи й трохи всього. Найкращий старт у залі."),
    daysPerWeek: [3, 3, 3],
    days: [
      { title: T("Full body A", "Все тіло A"), slots: [{ b: "leg_press", i: "squat", a: "squat" }, { b: "incline_db", i: "bench", a: "bench" }, "lat_pulldown", "rdl", "lateral_raise", "plank", "barbell_curl"] },
      { title: T("Full body B", "Все тіло B"), slots: [{ b: "goblet_squat", i: "rdl", a: "deadlift" }, "db_seated_press", "cable_row", "leg_press", "pushdown", "cable_crunch", "calf_raise"] },
      { title: T("Full body C", "Все тіло C"), slots: [{ b: "leg_press", i: "squat", a: "squat" }, "incline_db", { b: "lat_pulldown", i: "lat_pulldown", a: "pullup" }, "leg_curl", "face_pull", "hanging_knee_raise", "db_curl"] },
    ],
  },
  {
    id: "gym-upper-lower", place: "gym", audience: "men", style: "strength", goal: "strength",
    name: T("Gym upper / lower: strength", "Зал: верх / низ — сила"),
    summary: T("Four days, upper and lower body twice each. Heavy compound lifts first, muscle work after.", "Чотири дні: верх і низ двічі на тиждень. Спочатку важкі базові вправи, потім робота на м'язи."),
    daysPerWeek: [4, 4, 4],
    days: [
      { title: T("Upper: heavy", "Верх: важкий"), slots: ["bench", "barbell_row", "ohp", "lat_pulldown", "lateral_raise", "barbell_curl", "pushdown"] },
      { title: T("Lower: heavy", "Низ: важкий"), slots: [{ b: "leg_press", i: "squat", a: "squat" }, { b: "rdl", i: "rdl", a: "deadlift" }, "leg_ext", "leg_curl", "calf_raise", "hanging_knee_raise", "plank"] },
      { title: T("Upper: volume", "Верх: об'єм"), slots: ["incline_db", { b: "lat_pulldown", i: "lat_pulldown", a: "pullup" }, "db_seated_press", "cable_row", "cable_fly", "face_pull", "dips"] },
      { title: T("Lower: volume", "Низ: об'єм"), slots: ["leg_press", "rdl", "bulgarian_db", "leg_curl", "calf_raise", "cable_crunch", "walking_lunge"] },
    ],
  },
  {
    id: "gym-glutes", place: "gym", audience: "women", style: "glutes", goal: "muscle",
    name: T("Gym glutes & legs", "Зал: сідниці й ноги"),
    summary: T("Four days with the accent on glutes and legs, plus two upper-body days for posture and shape.", "Чотири дні з акцентом на сідниці й ноги, плюс два дні на верх для постави й форми."),
    daysPerWeek: [3, 4, 4],
    days: [
      { title: T("Glutes & hamstrings", "Сідниці й задня поверхня"), slots: ["hip_thrust", "rdl", "kickback", "leg_curl", "abduction", "plank", "calf_raise"] },
      { title: T("Upper body & core", "Верх тіла й корпус"), slots: ["lat_pulldown", "db_seated_press", "cable_row", "lateral_raise", "pushdown", "face_pull", "cable_crunch"] },
      { title: T("Quads & glutes", "Квадрицепси й сідниці"), slots: [{ b: "leg_press", i: "squat", a: "squat" }, "bulgarian_db", "leg_press", "leg_ext", "abduction", "hanging_knee_raise", "walking_lunge"] },
      { title: T("Glutes & upper body", "Сідниці й верх"), slots: ["hip_thrust", "incline_db", "walking_lunge", "cable_row", "kickback", "lateral_raise", "plank"] },
    ],
  },
  {
    id: "gym-ppl", place: "gym", audience: "men", style: "muscle", goal: "muscle",
    name: T("Gym push / pull / legs", "Зал: жим / тяга / ноги"),
    summary: T("The classic muscle-building split. Beginners run it 3 days a week, advanced twice through (6 days).", "Класичний спліт на м'язову масу. Новачки — 3 дні на тиждень, досвідчені — двічі по колу (6 днів)."),
    daysPerWeek: [3, 4, 6],
    days: [
      { title: T("Push: chest, shoulders, triceps", "Жим: груди, плечі, трицепс"), slots: ["bench", "incline_db", "db_seated_press", "lateral_raise", "pushdown", "cable_fly", "dips"] },
      { title: T("Pull: back, biceps", "Тяга: спина, біцепс"), slots: [{ b: "lat_pulldown", i: "pullup", a: "pullup" }, "barbell_row", "cable_row", "face_pull", "barbell_curl", "db_curl", "hanging_knee_raise"] },
      { title: T("Legs", "Ноги"), slots: [{ b: "leg_press", i: "squat", a: "squat" }, "rdl", "leg_press", "leg_curl", "leg_ext", "calf_raise", "cable_crunch"] },
    ],
  },
  {
    id: "gym-lean", place: "gym", audience: "women", style: "conditioning", goal: "fatloss",
    name: T("Gym lean & toned", "Зал: стрункість і тонус"),
    summary: T("Strength circuits with short rests and a cardio finisher: burns fat, keeps the muscle.", "Силові кола з коротким відпочинком і кардіо в кінці: спалює жир і зберігає м'язи."),
    daysPerWeek: [3, 3, 4],
    days: [
      { title: T("Lower body + cardio", "Низ + кардіо"), slots: ["leg_press", "hip_thrust", "walking_lunge", "leg_curl", "abduction", "bike_intervals", "plank"] },
      { title: T("Upper body + cardio", "Верх + кардіо"), slots: ["lat_pulldown", "db_seated_press", "cable_row", "lateral_raise", "pushdown", "rower", "cable_crunch"] },
      { title: T("Full-body circuit", "Кругове на все тіло"), slots: ["goblet_squat", "kb_swing", "incline_db", "db_row", "bulgarian_db", "rower", "hanging_knee_raise"] },
    ],
  },

  // ---- dumbbells at home ----
  {
    id: "db-fullbody", place: "dumbbells", audience: "all", style: "muscle", goal: "recomp",
    name: T("Dumbbells: full body", "Гантелі: все тіло"),
    summary: T("A pair of dumbbells and a floor: three full-body sessions a week.", "Пара гантелей і підлога: три тренування на все тіло на тиждень."),
    daysPerWeek: [3, 3, 3],
    days: [
      { title: T("Full body A", "Все тіло A"), slots: ["goblet_squat", "db_floor_press", "db_bent_row", "db_rdl", "db_lateral", "plank", "db_curl"] },
      { title: T("Full body B", "Все тіло B"), slots: ["db_rdl", "db_press_standing", "db_row", "db_reverse_lunge", "db_triceps_ext", "dead_bug", "db_calf"] },
      { title: T("Full body C", "Все тіло C"), slots: ["db_bulgarian", { b: "incline_pushup", i: "pushup", a: "decline_pushup" }, "db_bent_row", "db_hip_thrust", "db_reverse_fly", "db_russian_twist", "hammer_curl"] },
    ],
  },
  {
    id: "db-upper-lower", place: "dumbbells", audience: "men", style: "strength", goal: "strength",
    name: T("Dumbbells: upper / lower", "Гантелі: верх / низ"),
    summary: T("Four home sessions for strength and size with dumbbells only.", "Чотири домашні тренування на силу й м'язи тільки з гантелями."),
    daysPerWeek: [4, 4, 4],
    days: [
      { title: T("Upper A", "Верх A"), slots: ["db_floor_press", "db_bent_row", "db_press_standing", "db_row", "db_lateral", "db_curl", "db_triceps_ext"] },
      { title: T("Lower A", "Низ A"), slots: ["goblet_squat", "db_rdl", "db_bulgarian", "db_step_up", "db_calf", "plank", "dead_bug"] },
      { title: T("Upper B", "Верх B"), slots: [{ b: "incline_pushup", i: "pushup", a: "decline_pushup" }, "db_row", "db_press_standing", "renegade_row", "db_fly", "hammer_curl", "db_reverse_fly"] },
      { title: T("Lower B", "Низ B"), slots: ["db_bulgarian", "db_hip_thrust", "db_reverse_lunge", "db_rdl", "db_calf", "db_russian_twist", "side_plank"] },
    ],
  },
  {
    id: "db-glutes", place: "dumbbells", audience: "women", style: "glutes", goal: "muscle",
    name: T("Dumbbells: glutes & legs", "Гантелі: сідниці й ноги"),
    summary: T("Glute-focused home plan with dumbbells, plus upper body for posture.", "Домашній план з акцентом на сідниці з гантелями, плюс верх для постави."),
    daysPerWeek: [3, 3, 4],
    days: [
      { title: T("Glutes & hamstrings", "Сідниці й задня поверхня"), slots: ["db_hip_thrust", "db_rdl", "db_bulgarian", "donkey_kick", "side_leg_raise", "plank", "db_calf"] },
      { title: T("Upper body & core", "Верх тіла й корпус"), slots: ["db_bent_row", "db_press_standing", { b: "incline_pushup", i: "knee_pushup", a: "pushup" }, "db_lateral", "db_reverse_fly", "dead_bug", "db_triceps_ext"] },
      { title: T("Quads & glutes", "Квадрицепси й сідниці"), slots: ["goblet_squat", "db_sumo_squat", "db_step_up", "db_reverse_lunge", "sl_bridge", "side_plank", "db_calf"] },
    ],
  },
  {
    id: "db-ppl", place: "dumbbells", audience: "men", style: "muscle", goal: "muscle",
    name: T("Dumbbells: push / pull / legs", "Гантелі: жим / тяга / ноги"),
    summary: T("Muscle-building split for home: each muscle group gets its own day.", "Спліт на м'язи вдома: кожна група м'язів має свій день."),
    daysPerWeek: [3, 3, 6],
    days: [
      { title: T("Push", "Жим"), slots: ["db_floor_press", "db_press_standing", { b: "incline_pushup", i: "pushup", a: "decline_pushup" }, "db_lateral", "db_triceps_ext", "db_fly", "chair_dips"] },
      { title: T("Pull", "Тяга"), slots: ["db_bent_row", "db_row", "renegade_row", "db_reverse_fly", "db_curl", "hammer_curl", "superman"] },
      { title: T("Legs & core", "Ноги й корпус"), slots: ["goblet_squat", "db_rdl", "db_bulgarian", "db_hip_thrust", "db_calf", "db_russian_twist", "plank"] },
    ],
  },
  {
    id: "db-toned", place: "dumbbells", audience: "women", style: "toned", goal: "fatloss",
    name: T("Dumbbells: fat-burn circuits", "Гантелі: жироспалюючі кола"),
    summary: T("Full-body circuits with light dumbbells and short rests: tone and burn in 30–40 minutes.", "Кола на все тіло з легкими гантелями й коротким відпочинком: тонус і спалювання за 30–40 хвилин."),
    daysPerWeek: [3, 3, 4],
    days: [
      { title: T("Circuit A", "Коло A"), slots: ["db_thruster", "db_reverse_lunge", "db_bent_row", "db_swing", "mountain_climber", "db_lateral", "plank"] },
      { title: T("Circuit B", "Коло B"), slots: ["goblet_squat", "db_press_standing", "db_rdl", "renegade_row", "jumping_jack", "db_russian_twist", "glute_bridge"] },
      { title: T("Circuit C", "Коло C"), slots: ["db_sumo_squat", { b: "incline_pushup", i: "knee_pushup", a: "pushup" }, "db_step_up", "db_swing", "high_knees", "dead_bug", "db_triceps_ext"] },
    ],
  },

  // ---- no equipment ----
  {
    id: "bw-fullbody", place: "bodyweight", audience: "all", style: "muscle", goal: "recomp",
    name: T("No equipment: full body", "Без інвентарю: все тіло"),
    summary: T("Bodyweight only, anywhere: three full-body sessions with harder variants as you progress.", "Тільки власна вага, будь-де: три тренування на все тіло, вправи ускладнюються з рівнем."),
    daysPerWeek: [3, 3, 3],
    days: [
      { title: T("Full body A", "Все тіло A"), slots: [{ b: "bw_squat", i: "bw_bulgarian", a: "pistol_assisted" }, { b: "incline_pushup", i: "pushup", a: "decline_pushup" }, "table_row", "glute_bridge", "plank", "superman", "sl_calf"] },
      { title: T("Full body B", "Все тіло B"), slots: [{ b: "reverse_lunge", i: "reverse_lunge", a: "jump_squat" }, { b: "knee_pushup", i: "pike_pushup", a: "pike_pushup" }, "table_row", "sl_bridge", "dead_bug", "chair_dips", "side_plank"] },
      { title: T("Full body C", "Все тіло C"), slots: [{ b: "bw_squat", i: "bw_bulgarian", a: "bw_bulgarian" }, { b: "incline_pushup", i: "diamond_pushup", a: "diamond_pushup" }, "prone_ytw", "wall_sit", "leg_raise", "burpee", "sl_calf"] },
    ],
  },
  {
    id: "bw-strength", place: "bodyweight", audience: "men", style: "strength", goal: "strength",
    name: T("No equipment: calisthenics strength", "Без інвентарю: сила з власною вагою"),
    summary: T("Push-up, row and single-leg progressions for real strength without a gym.", "Прогресії віджимань, тяг і вправ на одній нозі для справжньої сили без залу."),
    daysPerWeek: [3, 4, 4],
    days: [
      { title: T("Upper: push", "Верх: жим"), slots: [{ b: "pushup", i: "decline_pushup", a: "decline_pushup" }, { b: "pike_pushup", i: "pike_pushup", a: "pike_pushup" }, "diamond_pushup", "chair_dips", "plank", "hollow_hold", "pushup"] },
      { title: T("Lower", "Низ"), slots: [{ b: "bw_bulgarian", i: "pistol_assisted", a: "pistol_assisted" }, "sl_bridge", "jump_squat", "reverse_lunge", "sl_calf", "wall_sit", "side_plank"] },
      { title: T("Upper: pull & core", "Верх: тяга й корпус"), slots: ["table_row", "prone_ytw", "superman", "leg_raise", "hollow_hold", "table_row", "dead_bug"] },
      { title: T("Full-body power", "Вибухова сила"), slots: ["burpee", { b: "jump_squat", i: "jump_squat", a: "skater_jump" }, "pushup", "table_row", "mountain_climber", "bw_bulgarian", "plank"] },
    ],
  },
  {
    id: "bw-glutes", place: "bodyweight", audience: "women", style: "glutes", goal: "recomp",
    name: T("No equipment: glutes & legs", "Без інвентарю: сідниці й ноги"),
    summary: T("Glutes, legs and core at home with no equipment at all.", "Сідниці, ноги й корпус удома зовсім без інвентарю."),
    daysPerWeek: [3, 3, 4],
    days: [
      { title: T("Glutes", "Сідниці"), slots: [{ b: "glute_bridge", i: "sl_bridge", a: "sl_bridge" }, "donkey_kick", "side_leg_raise", "reverse_lunge", "superman", "dead_bug", "skater_jump"] },
      { title: T("Legs & core", "Ноги й корпус"), slots: [{ b: "bw_squat", i: "bw_bulgarian", a: "bw_bulgarian" }, "reverse_lunge", "wall_sit", "glute_bridge", "sl_calf", "side_plank", "jump_squat"] },
      { title: T("Upper body & core", "Верх тіла й корпус"), slots: [{ b: "incline_pushup", i: "knee_pushup", a: "pushup" }, "table_row", "chair_dips", "prone_ytw", "plank", "bicycle_crunch", "pike_pushup"] },
    ],
  },
  {
    id: "bw-hiit", place: "bodyweight", audience: "all", style: "conditioning", goal: "fatloss",
    name: T("No equipment: HIIT fat burn", "Без інвентарю: HIIT-жироспалення"),
    summary: T("Short, intense interval sessions at home: 20–30 minutes, maximum burn.", "Короткі інтенсивні інтервальні тренування вдома: 20–30 хвилин, максимум спалювання."),
    daysPerWeek: [3, 3, 4],
    days: [
      { title: T("HIIT A", "HIIT A"), slots: ["jumping_jack", { b: "bw_squat", i: "jump_squat", a: "jump_squat" }, { b: "incline_pushup", i: "pushup", a: "pushup" }, "mountain_climber", "reverse_lunge", "burpee", "plank"] },
      { title: T("HIIT B", "HIIT B"), slots: ["high_knees", "skater_jump", { b: "knee_pushup", i: "pushup", a: "diamond_pushup" }, "glute_bridge", "bicycle_crunch", "burpee", "side_plank"] },
      { title: T("HIIT C", "HIIT C"), slots: ["jumping_jack", "reverse_lunge", "mountain_climber", "table_row", "jump_squat", "hollow_hold", "high_knees"] },
    ],
  },
  {
    id: "bw-toned", place: "bodyweight", audience: "women", style: "toned", goal: "fatloss",
    name: T("No equipment: toned body", "Без інвентарю: тонус тіла"),
    summary: T("Gentle-to-tough full-body toning at home: legs, glutes, arms and core.", "Тонус усього тіла вдома від м'якого до інтенсивного: ноги, сідниці, руки й корпус."),
    daysPerWeek: [3, 3, 4],
    days: [
      { title: T("Lower body tone", "Тонус низу"), slots: [{ b: "bw_squat", i: "bw_squat", a: "jump_squat" }, "glute_bridge", "reverse_lunge", "side_leg_raise", "donkey_kick", "wall_sit", "sl_calf"] },
      { title: T("Upper body & core tone", "Тонус верху й корпусу"), slots: [{ b: "incline_pushup", i: "knee_pushup", a: "pushup" }, "chair_dips", "prone_ytw", "plank", "dead_bug", "bicycle_crunch", "superman"] },
      { title: T("Full body flow", "Все тіло в потоці"), slots: ["bw_squat", { b: "incline_pushup", i: "knee_pushup", a: "pushup" }, "glute_bridge", "mountain_climber", "reverse_lunge", "side_plank", "jumping_jack"] },
    ],
  },
];

// ---------------------------------------------------------------------------------------------
// Load levels.
// ---------------------------------------------------------------------------------------------
const LEVELS: ExperienceLevel[] = ["beginner", "intermediate", "advanced"];
const LEVEL_INDEX: Record<ExperienceLevel, 0 | 1 | 2> = { beginner: 0, intermediate: 1, advanced: 2 };
/** Exercises per session at each level. */
const EXERCISES_PER_DAY = [5, 6, 7];
/** Reference load multiplier per level (adapted again per person on apply). */
const LOAD_FACTOR = [0.6, 1, 1.2];
const RPE = ["7", "8", "8-9"];

type Scheme = { sets: number; reps: string; rest: string };

/** Sets × reps and rest by style, level and the slot's role. */
function scheme(style: Style, level: 0 | 1 | 2, primary: boolean, kind: Kind): Scheme {
  if (kind === "time") {
    const hold = style === "conditioning" || style === "toned" ? ["30s", "40s", "45s"] : ["20s", "40s", "60s"];
    return { sets: [3, 3, 4][level], reps: hold[level], rest: ["60s", "45s", "30s"][level] };
  }
  if (kind === "bw") {
    const reps = style === "strength" ? ["6-10", "8-12", "10-15"] : style === "conditioning" || style === "toned" ? ["10-12", "12-15", "15-20"] : ["8-12", "10-15", "12-20"];
    return { sets: [2, 3, 4][level], reps: reps[level], rest: style === "conditioning" ? ["45s", "30s", "20s"][level] : ["75s", "60s", "60s"][level] };
  }
  switch (style) {
    case "strength":
      return primary
        ? { sets: [3, 4, 5][level], reps: ["8-10", "5-8", "3-6"][level], rest: ["90s", "2-3 min", "3 min"][level] }
        : { sets: [2, 3, 4][level], reps: ["10-12", "8-12", "8-10"][level], rest: ["75s", "90s", "90s"][level] };
    case "muscle":
      return primary
        ? { sets: [3, 4, 4][level], reps: ["10-12", "8-10", "6-10"][level], rest: ["90s", "2 min", "2 min"][level] }
        : { sets: [2, 3, 4][level], reps: ["12-15", "10-12", "8-12"][level], rest: ["60s", "75s", "75s"][level] };
    case "glutes":
      return primary
        ? { sets: [3, 4, 4][level], reps: ["12-15", "8-12", "6-10"][level], rest: ["90s", "2 min", "2 min"][level] }
        : { sets: [2, 3, 4][level], reps: ["12-15", "12-15", "10-12"][level], rest: ["60s", "60s", "75s"][level] };
    default: // toned / conditioning
      return { sets: [2, 3, 4][level], reps: ["12-15", "12-15", "15-20"][level], rest: ["60s", "45s", "30s"][level] };
  }
}

const WEEKDAYS: Record<number, Weekday[]> = {
  2: [1, 4], 3: [1, 3, 5], 4: [1, 2, 4, 5], 5: [1, 2, 3, 5, 6], 6: [1, 2, 3, 4, 5, 6],
};

const BODYWEIGHT: Bi = { en: "Bodyweight", uk: "Власна вага" };

function slotKey(slot: Slot, level: 0 | 1 | 2): ExerciseKey {
  return typeof slot === "string" ? slot : [slot.b, slot.i, slot.a][level];
}

function exercise(key: ExerciseKey, style: Style, level: 0 | 1 | 2, lang: Lang): PlanExercise {
  const def: ExerciseDef = EX[key];
  const primary = !!def.primary;
  const s = scheme(style, level, primary, def.kind);
  const name = lang === "en" ? def.en : def.uk;
  const kg = def.kg ? Math.max(2, Math.round((def.kg * LOAD_FACTOR[level]) / (def.kg < 30 ? 2 : 2.5)) * (def.kg < 30 ? 2 : 2.5)) : undefined;
  return {
    name,
    canonicalName: def.en,
    sets: `${s.sets} × ${s.reps}`,
    startWeight: kg ? `${kg} kg` : BODYWEIGHT[lang],
    technique: def.cue[lang],
    muscles: def.muscles,
    rest: s.rest,
    ...(def.kind === "time" ? { metric: "time" as const } : { rpe: RPE[level] }),
    ...(def.mode ? { weightMode: def.mode } : {}),
    ...(primary ? { role: "primary" as const, isKeyLift: def.kind === "kg" } : { role: "accessory" as const }),
  };
}

const WARM_UP: Record<ProgramPlace, Bi[]> = {
  gym: [T("5 min easy cardio (bike or rower)", "5 хв легкого кардіо (вело або гребля)"), T("Dynamic stretches: leg swings, arm circles", "Динамічна розминка: махи ногами, кола руками"), T("2 light warm-up sets of the first exercise", "2 легкі розминкові підходи першої вправи")],
  dumbbells: [T("3 min marching or jumping jacks", "3 хв ходьби на місці або «зірочки»"), T("10 bodyweight squats and 10 arm circles", "10 присідань і 10 кіл руками"), T("1 light set of the first exercise", "1 легкий підхід першої вправи")],
  bodyweight: [T("3 min marching, then 1 min jumping jacks", "3 хв ходьби на місці, потім 1 хв «зірочок»"), T("Hip circles, arm circles, 10 slow squats", "Кола тазом і руками, 10 повільних присідань")],
};
const COOL_DOWN: Bi[] = [T("Stretch the muscles you trained, 30 s each", "Розтягни м'язи, які тренував, по 30 с"), T("1–2 min slow breathing", "1–2 хв спокійного дихання")];

const DURATION: Record<Style, [number, number, number]> = {
  strength: [45, 60, 75], muscle: [45, 60, 70], glutes: [45, 55, 65], toned: [30, 40, 45], conditioning: [25, 35, 40],
};

export interface CatalogProgram {
  id: string;
  styleId: string;
  place: ProgramPlace;
  audience: ProgramAudience;
  level: ExperienceLevel;
  goal: GoalBucket;
  daysPerWeek: number;
  minutes: number;
  name: Bi;
  summary: Bi;
}

const LEVEL_NAME: Record<ExperienceLevel, Bi> = {
  beginner: T("beginner", "новачок"),
  intermediate: T("intermediate", "середній рівень"),
  advanced: T("advanced", "досвідчений"),
};

/** All 45 programs (15 styles × 3 load levels), in catalog order. */
export const PROGRAMS: CatalogProgram[] = STYLES.flatMap((st) =>
  LEVELS.map((level) => {
    const li = LEVEL_INDEX[level];
    return {
      id: `${st.id}-${level}`,
      styleId: st.id,
      place: st.place,
      audience: st.audience,
      level,
      goal: st.goal,
      daysPerWeek: st.daysPerWeek[li],
      minutes: DURATION[st.style][li],
      name: T(`${st.name.en} · ${LEVEL_NAME[level].en}`, `${st.name.uk} · ${LEVEL_NAME[level].uk}`),
      summary: st.summary,
    };
  }),
);

export function findProgram(id: string): CatalogProgram | undefined {
  return PROGRAMS.find((p) => p.id === id);
}

const METHOD: Record<Style, Bi> = {
  strength: T("Strength focus: heavy compound lifts first with long rests; add weight when every set reaches the top of the rep range.", "Акцент на силу: важкі базові вправи на початку з довгим відпочинком; додавай вагу, коли всі підходи доходять до верхньої межі повторень."),
  muscle: T("Hypertrophy: moderate weights, 8–15 reps close to failure (RPE 7–9), steady weekly progression.", "Гіпертрофія: помірні ваги, 8–15 повторень близько до відмови (RPE 7–9), поступова прогресія щотижня."),
  glutes: T("Glute focus: hip thrusts and hinges are the key lifts; slow lowering, squeeze at the top.", "Акцент на сідниці: ягідний міст і тяги — ключові вправи; повільне опускання, стискання вгорі."),
  toned: T("Toning: light-to-moderate load, higher reps, short rests; move steadily through the circuit.", "Тонус: легка-помірна вага, більше повторень, короткий відпочинок; рівномірно рухайся по колу."),
  conditioning: T("Conditioning: short rests and a cardio finisher keep the heart rate up for fat loss.", "Кондиція: короткий відпочинок і кардіо в кінці тримають пульс для спалювання жиру."),
};

/** The program as a plan in one language, for a reference body (adaptPlan personalises it). */
export function buildProgram(id: string, lang: Lang): BankPlan | null {
  const meta = findProgram(id);
  const st = STYLES.find((s) => s.id === meta?.styleId);
  if (!meta || !st) return null;
  const li = LEVEL_INDEX[meta.level];
  const weekdays = WEEKDAYS[meta.daysPerWeek] ?? WEEKDAYS[3];
  const split: PlanDay[] = weekdays.map((weekday, i) => {
    const day = st.days[i % st.days.length];
    const keys = day.slots.slice(0, EXERCISES_PER_DAY[li]).map((s) => slotKey(s, li));
    // A slot list may repeat an exercise on purpose for volume; keep only its first use per day.
    const unique = keys.filter((k, j) => keys.indexOf(k) === j);
    return {
      weekday,
      muscleGroup: day.title[lang],
      sessionType: st.style === "conditioning" || st.style === "toned" ? "conditioning" : st.style === "strength" ? "strength" : "hypertrophy",
      durationMin: meta.minutes,
      warmUp: WARM_UP[st.place].map((w) => w[lang]),
      coolDown: COOL_DOWN.map((c) => c[lang]),
      exercises: unique.map((k) => exercise(k, st.style, li, lang)),
    };
  });
  return {
    split,
    nutrition: { calories: 2200, protein: 140, fats: 70, carbs: 240 }, // reference; recomputed per person
    supplements: [],
    methodology: `${meta.name[lang]}. ${METHOD[st.style][lang]}`,
  };
}

/** The catalog as plan-bank entries, so the bank can pick them for new athletes too. "all"
 *  programs are offered to both sexes. Equipment: the gym is "gym", the rest "home". */
export function catalogBankEntries(): PlanBankEntry[] {
  return PROGRAMS.flatMap((p) => {
    const en = buildProgram(p.id, "en");
    const uk = buildProgram(p.id, "uk");
    if (!en || !uk) return [];
    const sexes: Array<"male" | "female"> = p.audience === "men" ? ["male"] : p.audience === "women" ? ["female"] : ["male", "female"];
    const daysBucket = p.daysPerWeek <= 3 ? "d23" : p.daysPerWeek === 4 ? "d4" : "d56";
    return sexes.map((sex) => ({
      id: `catalog:${p.id}:${sex}`,
      variant: 100,
      goal: p.goal,
      level: p.level,
      daysBucket,
      sex,
      equipment: p.place === "gym" ? "gym" : "home",
      plan: { en, uk },
    }) as PlanBankEntry);
  });
}
