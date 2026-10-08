// Hand-written knowledge-base guides (uk + en) for AI Search: the training, nutrition and
// recovery rules the app itself follows, plus how to use the app. The coach retrieves passages
// from these to ground its answers (knowledge/search.ts). Keep them factual and conservative --
// general guidance for healthy adults, never medical advice -- and in line with the engine:
// progression (domain/progression*), deload (domain/mesocycle.ts), nutrition (domain/calc.ts).
// Each guide is one document; short sections with a heading each so chunks stay self-contained.

export interface Guide {
  slug: string;
  uk: string;
  en: string;
}

export const GUIDES: Guide[] = [
  {
    slug: "progression",
    en: `# Progressive overload: how to add weight and reps

## The rule the app uses (double progression)
Every exercise has a rep range, e.g. 3 × 8–12. Stay on the same weight until EVERY set reaches the top of the range with good form, then add weight and start again from the bottom of the range.
- Upper-body barbell and machine lifts: +2.5 kg.
- Lower-body lifts (squat, deadlift, leg press, hip thrust): +5 kg.
- Dumbbells: the next dumbbell pair (usually +1–2 kg per hand).
- Bodyweight exercises: add reps, then slow the lowering (3–4 s), then a harder variation or a weight vest.

## RPE and RIR
RPE (rate of perceived exertion, 1–10) says how hard a set was. RIR (reps in reserve) is how many more clean reps you could have done.
- RPE 10 = failure, 0 RIR. RPE 9 = 1 rep left. RPE 8 = 2 reps left. RPE 7 = 3 reps left.
- Most working sets should end at RPE 7–9. Beginners work at RPE 6–8 while they learn technique.
- If a set feels RPE 10 well before the top of the range, the weight is too heavy -- drop 5–10 %.

## When progress stalls
- Two or three sessions without a new rep on the same weight = a plateau.
- Check sleep, food (especially protein and total calories) and stress first.
- Then: reduce the weight by ~10 % and build back up, change the rep range, or swap to a close variation for 4–6 weeks.

## Beginners vs experienced
- Beginners can add load almost every session for the first 2–3 months.
- Intermediate lifters progress week to week; advanced lifters month to month.
- Technique comes before load: a rep that changes shape to get the weight up does not count.`,
    uk: `# Прогресивне навантаження: як додавати вагу і повторення

## Правило, яким користується застосунок (подвійна прогресія)
Кожна вправа має діапазон повторень, напр. 3 × 8–12. Залишайся на тій самій вазі, доки КОЖЕН підхід не дійде до верхньої межі діапазону з гарною технікою, потім додай вагу й почни знову з нижньої межі.
- Вправи на верх тіла зі штангою чи в тренажері: +2,5 кг.
- Вправи на ноги (присідання, станова, жим ногами, ягідний міст): +5 кг.
- Гантелі: наступна пара гантелей (зазвичай +1–2 кг на руку).
- Вправи з власною вагою: більше повторень, потім повільніше опускання (3–4 с), потім складніший варіант або жилет з обтяженням.

## RPE і RIR
RPE (суб'єктивна важкість, 1–10) показує, наскільки важким був підхід. RIR (повторення в запасі) — скільки ще чистих повторень ти міг би зробити.
- RPE 10 = відмова, 0 RIR. RPE 9 = залишилось 1 повторення. RPE 8 = 2. RPE 7 = 3.
- Більшість робочих підходів має закінчуватись на RPE 7–9. Новачки працюють на RPE 6–8, поки вчать техніку.
- Якщо підхід відчувається як RPE 10 задовго до верхньої межі — вага завелика, зменш на 5–10 %.

## Коли прогрес зупинився
- Два-три тренування без нового повторення на тій самій вазі = плато.
- Спершу перевір сон, харчування (особливо білок і калорії) та стрес.
- Далі: зменш вагу на ~10 % і знову нарощуй, зміни діапазон повторень або заміни вправу на близький варіант на 4–6 тижнів.

## Новачки і досвідчені
- Новачки можуть додавати вагу майже кожне тренування перші 2–3 місяці.
- Середній рівень прогресує щотижня, досвідчені — щомісяця.
- Техніка важливіша за вагу: повторення, у якому рух змінив форму, щоб підняти вагу, не зараховується.`,
  },
  {
    slug: "deload-and-periodization",
    en: `# Deload weeks and training blocks

## What a deload is
A planned easier week: the same exercises with about 40–50 % fewer sets and ~10 % lighter weights, or the same weights with half the sets. Fatigue drops while strength and skill stay.

## How often
The app plans training in blocks (mesocycles): usually 4–6 weeks of building, then one deload week. Beginners can go longer between deloads; advanced lifters and people over 40 often need them more often.

## Signs you need one earlier
- Weights that were easy feel heavy for a week or more.
- Joint aches that do not go away between sessions.
- Poor sleep, low motivation, resting heart rate higher than usual.

## After the deload
Start the new block at about the weights you used before the deload. They usually feel lighter and progress resumes.`,
    uk: `# Розвантажувальні тижні та тренувальні блоки

## Що таке розвантаження (делоад)
Запланований легший тиждень: ті самі вправи, але приблизно на 40–50 % менше підходів і на ~10 % менші ваги, або ті самі ваги з удвічі меншою кількістю підходів. Втома спадає, а сила і навичка зберігаються.

## Як часто
Застосунок планує тренування блоками (мезоциклами): зазвичай 4–6 тижнів нарощування, потім тиждень розвантаження. Новачкам можна рідше, досвідченим і людям після 40 часто потрібно частіше.

## Ознаки, що розвантаження потрібне раніше
- Ваги, які були легкими, тиждень і більше здаються важкими.
- Біль у суглобах, що не минає між тренуваннями.
- Поганий сон, немає мотивації, пульс у спокої вищий, ніж зазвичай.

## Після розвантаження
Почни новий блок приблизно з тих ваг, що були до розвантаження. Зазвичай вони здаються легшими, і прогрес відновлюється.`,
  },
  {
    slug: "rest-between-sets",
    en: `# Rest between sets

## Guidelines
- Heavy compound lifts for strength (1–6 reps): 2–4 minutes.
- Hypertrophy work (6–12 reps): 1.5–2.5 minutes for big lifts, 60–90 seconds for isolation exercises.
- Light toning circuits and conditioning: 30–60 seconds.
- Supersets: little or no rest between the paired exercises, then the normal rest.

## Rest timer in the app
The logger starts a rest timer after each set using the rest written in the plan (for example "3 min" or "90 s"). The chips under the timer change the rest for that exercise only. Rest longer when the next set would otherwise fall short of the target reps.`,
    uk: `# Відпочинок між підходами

## Орієнтири
- Важкі базові вправи на силу (1–6 повторень): 2–4 хвилини.
- Робота на масу (6–12 повторень): 1,5–2,5 хвилини для великих вправ, 60–90 секунд для ізольованих.
- Легкі кола на тонус і кондиція: 30–60 секунд.
- Суперсети: мінімум відпочинку між парними вправами, потім звичайний відпочинок.

## Таймер відпочинку в застосунку
Після кожного підходу логер запускає таймер відпочинку з тим часом, що записаний у плані (наприклад «3 хв» або «90 с»). Кнопки під таймером змінюють відпочинок лише для цієї вправи. Відпочивай довше, якщо інакше наступний підхід не дотягне до цільових повторень.`,
  },
  {
    slug: "training-volume-and-frequency",
    en: `# Sets per muscle and training frequency

## Weekly volume
- Most people grow well on 10–20 hard sets per muscle per week. Beginners: 8–12 are enough.
- Small muscles (biceps, triceps, calves, rear delts) also get work from compound lifts.
- More is not always better: if recovery suffers, cut sets before cutting intensity.

## Frequency
- Training each muscle 2 times a week beats once a week for the same number of sets.
- 2–3 days a week: full-body sessions. 4 days: upper/lower. 5–6 days: push/pull/legs or body-part splits.

## The body map
The app's body map colours each muscle by how many sets it got this week and shows which muscles are recovering. Tap a muscle to see which exercises trained it and its 12-week trend.`,
    uk: `# Підходи на м'яз і частота тренувань

## Тижневий об'єм
- Більшість людей добре ростуть на 10–20 важких підходах на м'яз на тиждень. Новачкам достатньо 8–12.
- Малі м'язи (біцепс, трицепс, литки, задні дельти) також працюють у базових вправах.
- Більше — не завжди краще: якщо страждає відновлення, зменшуй кількість підходів, а не інтенсивність.

## Частота
- Тренувати кожен м'яз 2 рази на тиждень краще, ніж раз, за тієї самої кількості підходів.
- 2–3 дні на тиждень: тренування на все тіло. 4 дні: верх/низ. 5–6 днів: жими/тяги/ноги або спліт по групах м'язів.

## Карта м'язів
Карта м'язів у застосунку фарбує кожен м'яз за кількістю підходів цього тижня і показує, які м'язи ще відновлюються. Натисни на м'яз, щоб побачити, які вправи його тренували, і тренд за 12 тижнів.`,
  },
  {
    slug: "warm-up-and-technique",
    en: `# Warm-up and safe technique

## General warm-up (5–10 minutes)
Light cardio until you feel warm (bike, brisk walk, jumping jacks), then joint circles for hips, shoulders and ankles.

## Specific warm-up sets
Before the first heavy exercise do 2–4 ramp-up sets: an empty bar or ~40 % for 8–10 reps, ~60 % for 5, ~80 % for 2–3, then the working sets. Later exercises for the same muscles need one or two light sets at most.

## Technique basics
- Brace your core before every rep of squats, deadlifts, rows and presses: breathe in, tighten, then move.
- Keep a neutral spine; the lower back should not round under load.
- Control the lowering (2–3 s); do not bounce out of the bottom.
- Full range of motion you can control beats a heavier partial rep.
- Pain is a stop signal. Muscle burn and fatigue are normal; sharp, joint or nerve-like pain is not.

## Form check
Record a set from the side and send it in the app (AI form check). The AI comments on posture, depth and tempo. It is a second opinion, not a replacement for a coach in person.`,
    uk: `# Розминка і безпечна техніка

## Загальна розминка (5–10 хвилин)
Легке кардіо до відчуття тепла (велосипед, швидка ходьба, «зірочки»), потім обертання в кульшових, плечових і гомілковостопних суглобах.

## Спеціальні розминкові підходи
Перед першою важкою вправою зроби 2–4 підвідні підходи: порожній гриф або ~40 % на 8–10 повторень, ~60 % на 5, ~80 % на 2–3, потім робочі підходи. Наступним вправам на ті самі м'язи достатньо одного-двох легких підходів.

## Основи техніки
- Перед кожним повторенням присідань, тяг і жимів напружуй корпус: вдих, напруга, потім рух.
- Тримай нейтральну спину; поперек не повинен округлюватись під вагою.
- Контролюй опускання (2–3 с), не відбивайся від нижньої точки.
- Повна амплітуда, яку ти контролюєш, краща за неповне повторення з більшою вагою.
- Біль — сигнал зупинитися. Печіння в м'язах і втома — нормально; гострий біль у суглобі чи схожий на нервовий — ні.

## Перевірка техніки
Зніми підхід збоку і надішли в застосунку (ШІ-перевірка техніки). ШІ прокоментує положення тіла, глибину і темп. Це друга думка, а не заміна живого тренера.`,
  },
  {
    slug: "nutrition-basics",
    en: `# Nutrition basics: calories and macros

## Calories
- The app estimates maintenance calories from weight, height, age, sex and activity (Mifflin–St Jeor × activity factor), then adjusts by goal.
- Fat loss: about 15–25 % below maintenance, aiming for 0.5–1 % of body weight per week.
- Muscle gain: about 5–15 % above maintenance, aiming for 0.25–0.5 % of body weight per week.
- Recomposition (beginners, returning lifters): around maintenance with high protein.
- After 2–3 weeks the app compares the real weight trend with the target and corrects calories.

## Protein
1.6–2.2 g per kg of body weight a day, split over 3–5 meals of 20–40 g each. In a calorie deficit stay near the top of the range to keep muscle.

## Fat and carbs
- Fat: at least 0.6–0.8 g per kg (hormonal health), usually 20–35 % of calories.
- Carbs fill the rest; they fuel hard training. More on training days, a bit less on rest days -- the app shows separate rest-day targets.

## Fibre, water, alcohol
- 25–35 g fibre a day from vegetables, fruit, legumes, whole grains.
- Water: about 30–35 ml per kg a day, more in heat and on training days.
- Alcohol slows recovery and adds empty calories; keep it occasional.`,
    uk: `# Основи харчування: калорії та макроси

## Калорії
- Застосунок оцінює калорії для підтримки ваги за вагою, зростом, віком, статтю та активністю (Міффлін–Сан Жеор × коефіцієнт активності), потім коригує під ціль.
- Схуднення: приблизно на 15–25 % нижче підтримки, ціль — 0,5–1 % ваги тіла на тиждень.
- Набір м'язів: приблизно на 5–15 % вище підтримки, ціль — 0,25–0,5 % ваги тіла на тиждень.
- Рекомпозиція (новачки, ті, хто повертається): близько підтримки з високим білком.
- Через 2–3 тижні застосунок порівнює реальний тренд ваги з цільовим і коригує калорії.

## Білок
1,6–2,2 г на кг ваги тіла на день, розподілено на 3–5 прийомів по 20–40 г. У дефіциті калорій тримайся ближче до верхньої межі, щоб зберегти м'язи.

## Жири і вуглеводи
- Жири: щонайменше 0,6–0,8 г на кг (гормональне здоров'я), зазвичай 20–35 % калорій.
- Вуглеводи — решта; вони дають енергію для важких тренувань. Більше в дні тренувань, трохи менше в дні відпочинку — застосунок показує окремі цілі на день відпочинку.

## Клітковина, вода, алкоголь
- 25–35 г клітковини на день з овочів, фруктів, бобових, цільних злаків.
- Вода: приблизно 30–35 мл на кг на день, більше в спеку і в дні тренувань.
- Алкоголь сповільнює відновлення і додає порожні калорії; нехай буде рідко.`,
  },
  {
    slug: "protein-foods",
    en: `# Protein-rich foods (approximate, per 100 g)

- Chicken breast, cooked: 31 g protein, 165 kcal.
- Turkey breast: 29 g, 135 kcal.
- Lean beef: 26 g, 215 kcal.
- Salmon: 22 g, 200 kcal. Tuna, canned in water: 25 g, 115 kcal. White fish (cod, hake): 18 g, 85 kcal.
- Eggs: 13 g, 155 kcal (one large egg ≈ 6 g protein).
- Cottage cheese 5 %: 17 g, 120 kcal. Greek yogurt 2 %: 10 g, 75 kcal.
- Hard cheese: 25 g, 350 kcal.
- Lentils, cooked: 9 g, 115 kcal. Chickpeas, cooked: 9 g, 165 kcal. Tofu: 12 g, 120 kcal.
- Buckwheat, cooked: 4 g, 100 kcal. Oats, dry: 13 g, 370 kcal.
- Whey protein: about 20–25 g per scoop (30 g).

## Easy ways to reach the target
Add a protein source to every meal, keep cottage cheese or yogurt for snacks, and use a shake only to close the gap.`,
    uk: `# Продукти з високим вмістом білка (приблизно, на 100 г)

- Куряче філе, готове: 31 г білка, 165 ккал.
- Філе індички: 29 г, 135 ккал.
- Пісна яловичина: 26 г, 215 ккал.
- Лосось: 22 г, 200 ккал. Тунець у власному соку: 25 г, 115 ккал. Біла риба (тріска, хек): 18 г, 85 ккал.
- Яйця: 13 г, 155 ккал (одне велике яйце ≈ 6 г білка).
- Сир кисломолочний 5 %: 17 г, 120 ккал. Грецький йогурт 2 %: 10 г, 75 ккал.
- Твердий сир: 25 г, 350 ккал.
- Сочевиця, варена: 9 г, 115 ккал. Нут, варений: 9 г, 165 ккал. Тофу: 12 г, 120 ккал.
- Гречка, варена: 4 г, 100 ккал. Вівсянка, суха: 13 г, 370 ккал.
- Сироватковий протеїн: приблизно 20–25 г на мірну ложку (30 г).

## Прості способи добрати норму
Додавай джерело білка до кожного прийому їжі, тримай кисломолочний сир чи йогурт для перекусів, а коктейль використовуй лише щоб закрити різницю.`,
  },
  {
    slug: "fat-loss",
    en: `# Losing fat without losing muscle

- Keep lifting with the same weights as long as you can; the training is the signal to keep muscle.
- Moderate deficit (15–25 %), high protein (2–2.2 g/kg), 7–10 k steps a day.
- Expect strength to hold or rise slowly at first; small drops late in a long diet are normal.
- Weigh yourself 3–7 mornings a week after the toilet and before food; follow the 7-day average, not single days (water swings of 1–2 kg are normal).
- If the average does not move for 2–3 weeks, cut about 100–200 kcal or add steps.
- Diet breaks of 1–2 weeks at maintenance after 8–12 weeks help adherence.
- Cardio helps, but steps and food matter more than long cardio sessions.`,
    uk: `# Як схуднути без втрати м'язів

- Продовжуй тренуватися з тими самими вагами, скільки можеш; тренування — сигнал тілу зберігати м'язи.
- Помірний дефіцит (15–25 %), високий білок (2–2,2 г/кг), 7–10 тис. кроків на день.
- Спершу сила тримається або повільно росте; невелике зниження наприкінці довгої дієти — нормально.
- Зважуйся 3–7 ранків на тиждень після туалету й до їжі; дивись на середнє за 7 днів, а не на окремі дні (коливання води на 1–2 кг — норма).
- Якщо середнє не змінюється 2–3 тижні, зменш калорії на 100–200 ккал або додай кроків.
- Перерви на 1–2 тижні на підтримці після 8–12 тижнів дієти допомагають втриматися.
- Кардіо допомагає, але кроки і харчування важать більше за довгі кардіосесії.`,
  },
  {
    slug: "muscle-gain",
    en: `# Building muscle

- Train each muscle 2× a week with 10–20 hard sets, most sets 6–15 reps at RPE 7–9.
- Small calorie surplus (5–15 %); gaining faster than ~0.5 % body weight a week is mostly fat.
- Protein 1.6–2.2 g/kg; carbs around training help performance.
- Sleep 7–9 hours -- it is when recovery happens.
- Progress shows as more reps or weight over weeks; track it in the logger and on the muscle trend chart.
- Women build muscle with the same methods; the rate is slower in absolute terms, and heavy training does not make anyone "bulky" by accident.`,
    uk: `# Набір м'язової маси

- Тренуй кожен м'яз 2 рази на тиждень, 10–20 важких підходів, більшість — 6–15 повторень на RPE 7–9.
- Невеликий профіцит калорій (5–15 %); набір швидше за ~0,5 % ваги тіла на тиждень — переважно жир.
- Білок 1,6–2,2 г/кг; вуглеводи навколо тренування покращують результат.
- Сон 7–9 годин — саме тоді відбувається відновлення.
- Прогрес видно як більше повторень чи ваги за тижні; відстежуй у логері та на графіку тренду м'язів.
- Жінки набирають м'язи тими самими методами; темп в абсолютних числах повільніший, і важкі тренування нікого «випадково» не роблять масивним.`,
  },
  {
    slug: "recovery-and-sleep",
    en: `# Recovery, sleep and soreness

## Sleep
7–9 hours. Regular bed and wake times, a dark cool room, no heavy meals or screens right before bed. Short sleep lowers strength, raises hunger and slows fat loss.

## Muscle soreness (DOMS)
Soreness 24–72 hours after a new or harder session is normal and not a measure of a good workout. Light movement, walking and the next session with lighter weights help it pass. Sharp pain, swelling or pain that gets worse is not soreness -- stop and see a professional.

## Between sessions
- 48 hours before training the same muscles hard again is a good default.
- Active recovery days: walking, easy cycling, mobility, 20–40 minutes.
- The daily check-in in the app (sleep, energy, soreness) lets the plan suggest an easier day when you are run down.

## Stress
High life stress uses the same recovery budget as training. In heavy weeks keep the sessions but cut a set or two.`,
    uk: `# Відновлення, сон і крепатура

## Сон
7–9 годин. Регулярний час сну і пробудження, темна прохолодна кімната, без важкої їжі та екранів перед сном. Недосип знижує силу, посилює голод і сповільнює схуднення.

## Крепатура (DOMS)
Біль у м'язах через 24–72 години після нового чи важчого тренування — нормально і не є мірилом гарного тренування. Легкий рух, ходьба і наступне тренування з меншими вагами допомагають. Гострий біль, набряк або біль, що посилюється, — це не крепатура: зупинись і звернись до фахівця.

## Між тренуваннями
- 48 годин перед повторним важким тренуванням тих самих м'язів — гарне правило за замовчуванням.
- Дні активного відновлення: ходьба, легкий велосипед, мобільність, 20–40 хвилин.
- Щоденний чек-ін у застосунку (сон, енергія, біль у м'язах) дозволяє плану запропонувати легший день, коли ти виснажений.

## Стрес
Сильний життєвий стрес витрачає той самий ресурс відновлення, що й тренування. У важкі тижні не пропускай тренування, але прибери підхід-два.`,
  },
  {
    slug: "cardio-and-steps",
    en: `# Cardio and daily steps

- Health baseline: 150 minutes a week of moderate cardio or 75 minutes vigorous, plus strength training twice a week.
- Steps: 7,000–10,000 a day is a good target; it burns more over a week than most cardio sessions.
- Zone 2 (you can talk in full sentences): 30–60 minutes, 2–3× a week builds the aerobic base and recovers well.
- Intervals (HIIT): 1–2× a week at most, not right before leg day.
- Do cardio after lifting or on separate days so it does not take strength from the main lifts.
- Runs and rides from Strava can be imported in the app (More → Cardio from Strava).`,
    uk: `# Кардіо і кроки

- Базова норма для здоров'я: 150 хвилин помірного кардіо на тиждень або 75 хвилин інтенсивного, плюс силові двічі на тиждень.
- Кроки: 7 000–10 000 на день — гарна ціль; за тиждень це спалює більше, ніж більшість кардіотренувань.
- Зона 2 (можеш говорити повними реченнями): 30–60 хвилин, 2–3 рази на тиждень розвиває аеробну базу і добре відновлює.
- Інтервали (HIIT): не більше 1–2 разів на тиждень і не перед днем ніг.
- Роби кардіо після силових або в окремі дні, щоб воно не забирало силу з основних вправ.
- Пробіжки і заїзди зі Strava можна імпортувати в застосунку (Ще → Кардіо зі Strava).`,
  },
  {
    slug: "home-training",
    en: `# Training at home: dumbbells or no equipment

## With dumbbells
- Adjustable dumbbells cover almost everything: goblet squat, Romanian deadlift, split squat, floor or bench press, one-arm row, overhead press, curls, triceps extensions.
- When the dumbbells get too light: more reps (up to 20–25), slower lowering, pauses, single-leg/single-arm versions, shorter rests.

## Bodyweight only
- Squat → split squat → Bulgarian split squat → pistol progressions.
- Push-up: incline (hands on a table) → floor → feet raised → slow or archer push-ups.
- Pull: inverted rows under a sturdy table, towel rows on a door; a pull-up bar is the best single purchase.
- Hinge: glute bridge → single-leg bridge → hip thrust from a sofa.
- Count progress in reps and harder variations instead of kilograms.

## Ready programs
The app has 15 home programs with dumbbells and 15 without equipment (and 15 for the gym), each in beginner, intermediate and advanced versions, for men, women or everyone: More → Ready programs.`,
    uk: `# Тренування вдома: з гантелями або без нічого

## З гантелями
- Розбірні гантелі покривають майже все: гоблет-присідання, румунська тяга, випади на місці, жим лежачи на підлозі чи лаві, тяга однією рукою, жим над головою, згинання на біцепс, розгинання на трицепс.
- Коли гантелі стають легкими: більше повторень (до 20–25), повільніше опускання, паузи, варіанти на одну ногу/руку, коротший відпочинок.

## Лише власна вага
- Присідання → випади на місці → болгарські випади → підвідні до «пістолетика».
- Віджимання: від столу → від підлоги → ноги на підвищенні → повільні або «лучник».
- Тяги: австралійські підтягування під міцним столом, тяга рушником на дверях; турнік — найкраща покупка.
- Тазові вправи: ягідний міст → на одній нозі → з опорою на диван.
- Рахуй прогрес у повтореннях і складніших варіантах замість кілограмів.

## Готові програми
У застосунку є 15 домашніх програм з гантелями, 15 без обладнання (і 15 для залу), кожна в рівнях новачок, середній і досвідчений, для чоловіків, жінок або всіх: Ще → Готові програми.`,
  },
  {
    slug: "safety-and-health",
    en: `# Safety and when to see a professional

- The app gives general fitness guidance for healthy adults, not medical advice.
- See a doctor before starting if you have heart, lung or metabolic disease, high blood pressure, are pregnant or postpartum, have a recent injury or surgery, or feel chest pain, dizziness or breathlessness during exercise.
- Stop the exercise on sharp pain, numbness, tingling, or pain that changes how you move. Train around an injury only with exercises that are completely pain-free, and see a physiotherapist.
- In the app you can mark injuries in the profile; plans then avoid exercises that load that area.
- Very low-calorie diets (below about 1,200 kcal for women or 1,500 kcal for men) need medical supervision.
- Supplements with good evidence: creatine monohydrate 3–5 g a day, caffeine before training, vitamin D if deficient, protein powder for convenience. Others are mostly unnecessary.`,
    uk: `# Безпека і коли звертатися до фахівця

- Застосунок дає загальні фітнес-поради для здорових дорослих, а не медичні рекомендації.
- Порадься з лікарем перед стартом, якщо маєш хвороби серця, легень чи обміну речовин, підвищений тиск, вагітність або післяпологовий період, нещодавню травму чи операцію, або відчуваєш біль у грудях, запаморочення чи задишку під час навантаження.
- Зупини вправу при гострому болю, онімінні, поколюванні або болю, що змінює рух. Тренуйся при травмі лише вправами, які повністю безболісні, і звернись до фізіотерапевта.
- У застосунку можна вказати травми в профілі — тоді плани уникатимуть вправ, що навантажують цю зону.
- Дуже низькокалорійні дієти (менше приблизно 1 200 ккал для жінок чи 1 500 ккал для чоловіків) потребують нагляду лікаря.
- Добавки з гарною доказовою базою: креатин моногідрат 3–5 г на день, кофеїн перед тренуванням, вітамін D при дефіциті, протеїн для зручності. Інші здебільшого не потрібні.`,
  },
  {
    slug: "app-how-to",
    en: `# How to use the app

## Today and the logger
Today shows the session for the day. Open it to log sets: weight and reps for each set, with the next target suggested from your last session. The rest timer starts after each set. Finish the workout to save it; it is also saved offline and synced when the connection returns.

## Plan
- Your plan is built from the onboarding answers (goal, level, days, equipment, injuries). Change any of them in Profile and rebuild the plan (More → Rebuild plan).
- More → Ready programs: 45 ready plans (gym, dumbbells, no equipment; beginner to advanced) adapted to your body and records when you apply one.
- Swap an exercise from the logger if the machine is busy or you lack the equipment.

## Food
Log meals by text, by photo (the AI estimates calories and macros, you can correct them) or from the food list. The day shows calories and protein against your targets.

## Coach
Ask the AI coach anything about training and food. It sees your plan and recent logs and can change the plan with one tap (add, swap, make easier or harder). Voice messages are transcribed. Send a short video for a form check.

## Progress
Weight chart with a 7-day average, records per exercise, body map of trained muscles, progress photos side by side, weekly report every Sunday.

## Social
Squads: small groups with a shared weekly goal. Buddies and duels, monthly challenges, weekly quests and badges.

## Trainers
A human trainer can manage clients' plans, chat with them in the app and answer their questions; clients of a trainer get their questions routed to the trainer.`,
    uk: `# Як користуватися застосунком

## Сьогодні і логер
«Сьогодні» показує тренування на день. Відкрий його, щоб записувати підходи: вага і повторення в кожному, з підказкою наступної цілі з минулого тренування. Таймер відпочинку стартує після кожного підходу. Заверши тренування, щоб зберегти; воно також зберігається офлайн і синхронізується, коли з'явиться зв'язок.

## План
- План будується з відповідей при старті (ціль, рівень, дні, обладнання, травми). Зміни будь-що в Профілі і перебудуй план (Ще → Перебудувати план).
- Ще → Готові програми: 45 готових планів (зал, гантелі, без обладнання; від новачка до досвідченого), які підлаштовуються під твоє тіло і рекорди, коли ти застосовуєш програму.
- Заміни вправу прямо з логера, якщо тренажер зайнятий чи немає обладнання.

## Їжа
Записуй їжу текстом, фото (ШІ оцінить калорії й макроси, їх можна виправити) або зі списку продуктів. День показує калорії і білок відносно цілей.

## Тренер
Питай ШІ-тренера про тренування і харчування. Він бачить твій план і останні записи та може змінити план одним дотиком (додати, замінити, полегшити чи ускладнити). Голосові повідомлення розпізнаються. Надішли коротке відео для перевірки техніки.

## Прогрес
Графік ваги з середнім за 7 днів, рекорди по вправах, карта натренованих м'язів, фото прогресу поруч, щотижневий звіт щонеділі.

## Спільнота
Скводи: невеликі групи зі спільною ціллю на тиждень. Друзі й дуелі, щомісячні челенджі, тижневі квести і нагороди.

## Тренери
Живий тренер може вести плани клієнтів, листуватися з ними в застосунку і відповідати на їхні питання; питання клієнтів тренера надходять тренеру.`,
  },
];
