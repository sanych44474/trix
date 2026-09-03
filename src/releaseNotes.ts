import type { Lang } from "./types";
import { escapeHtml, mdToHtml } from "./locales/i18n";

// Versioned, bilingual release notes. Newest first. Bodies use the same *bold*/_italic_ markers as
// the locale catalog; keep them author-controlled (no raw <, >, & — they're HTML-escaped first).
// The owner broadcasts the latest entry to every user (each in their own language) with a confirm gate.
export interface ReleaseNote {
  version: string; // YYYY-MM-DD (also the display tag)
  en: string;
  uk: string;
}

export const RELEASE_NOTES: ReleaseNote[] = [
  {
    version: "2026-08-01",
    en: `🎉 *What's new in trix*

🏆 *Bigger record celebrations* — beat a lift and you get a full-screen 💥 banner, a trophy pop and a punchy haptic. New badges for *10* and *25* personal records, plus a *Perfect day* badge for hitting all three daily quests.

🤝 *Buddy, expanded* — tap your buddy's card to see their progress (level/streak), this week's workouts and their plan, plus a weekly *you-vs-them duel*.

📅 *Weekly recap & quick start* — a tidy "this week" card with a share button, and a friendly get-started guide for new athletes.

⚡ *Level-up celebration* — a ⚡ pop when you reach a new level.

🧊 *Protected streak* — at a 4-week streak, one missed week no longer breaks it (shown on your level card).

🩹 *Smarter plateau detection* — adding weight with a rep reset is now correctly read as progress, not a plateau, so you won't get false "you've stalled" nudges.

Tap *Menu → 📱 Dashboard*! 💪`,
    uk: `🎉 *Що нового в trix*

🏆 *Більше свята за рекорди* — поб'єш вагу — і отримаєш повноекранний 💥 банер, кубок і потужний хаптик. Нові бейджі за *10* та *25* особистих рекордів і бейдж *Ідеальний день* за виконання всіх трьох щоденних квестів.

🤝 *Напарник — детальніше* — тапни картку напарника й побач його прогрес (рівень/серія), тренування цього тижня та його план, а ще тижневу *дуель ти-проти-нього*.

📅 *Тижневий підсумок і швидкий старт* — акуратна картка «цього тижня» з кнопкою поділитися і привітний гайд для новачків.

⚡ *Святкування нового рівня* — ⚡ вікно, коли досягаєш нового рівня.

🧊 *Захищена серія* — на серії 4 тижні один пропущений тиждень більше її не ламає (видно на картці рівня).

🩹 *Розумніше визначення плато* — додавання ваги зі скиданням повторів тепер правильно читається як прогрес, а не плато — жодних хибних «ти застопорився».

Тисни *Меню → 📱 Дашборд*! 💪`,
  },
  {
    version: "2026-07-27",
    en: `🎉 *What's new in trix*

🎯 *Daily quests* — three goals a day (log a workout · hit your water & protein targets) with live progress right on your dashboard. Complete all three for a "perfect day".

🎖 *Achievements* — a full showcase of every badge (earned & locked) in your profile.

🧠 *Weekly AI insight* — tap it on the dashboard: the coach analyses your last 45 days (what's progressing, what stalled) and gives specific fixes for your real lifts.

🍳 *Smart food tools* — a recipe for your day's *remaining* macros, one-tap re-add of *recent foods*, and an *"ate too much?"* recovery plan for tomorrow.

🤝 *Accountability buddy* — pair up with a friend (⚙️ Profile → Invite a buddy) and see each other's weekly workouts on the dashboard.

💧 *Scheduled water reminders* — optional pings every 2/3/4h until you hit your goal (⚙️ Profile).

🎨 *Theme* — force Light/Dark or follow Telegram (⚙️ Profile).

📣 *Share your progress* — post your level, streak & badges from your profile.

🎤 *Voice logging* — send a voice note and log a workout, food, or ask the coach.

Tap *Menu → 📱 Dashboard* and enjoy! 💪`,
    uk: `🎉 *Що нового в trix*

🎯 *Щоденні квести* — три цілі на день (запиши тренування · досягни цілей по воді та білку) з живим прогресом прямо на дашборді. Виконай усі три — «ідеальний день».

🎖 *Досягнення* — повна вітрина всіх бейджів (отримані й заблоковані) у профілі.

🧠 *AI-інсайт тижня* — тисни на дашборді: тренер аналізує останні 45 днів (що прогресує, що застопорилось) і дає конкретні поради по твоїх реальних вправах.

🍳 *Розумні харчові інструменти* — рецепт під *залишок* КБЖУ на сьогодні, ре-ввод *нещодавніх страв* у один тап і план відновлення *«переїв?»* на завтра.

🤝 *Напарник* — об'єднайся з другом (⚙️ Профіль → Запросити напарника) і бачте тренування одне одного на дашборді.

💧 *Нагадування про воду за розкладом* — опційні пінги кожні 2/3/4 год, доки не досягнеш цілі (⚙️ Профіль).

🎨 *Тема* — примусово Світла/Темна або за Telegram (⚙️ Профіль).

📣 *Поділись прогресом* — опублікуй рівень, серію та бейджі з профілю.

🎤 *Голосовий запис* — надішли голосове й запиши тренування, їжу або спитай тренера.

Тисни *Меню → 📱 Дашборд* і користуйся! 💪`,
  },
  {
    version: "2026-07-25",
    en: `🎉 *What's new in trix*

📤 *Share your plan to the library*
Got a plan you love? Open *⭐ More → 📚 Program library → 📤 Share my plan*, give it a name, and it becomes a reusable template anyone can browse and take. Weights auto-adapt to whoever takes it.

📥 *Copy a past workout*
In the 📱 logger, tap *📥 Copy a past workout* to pick any previous session — its exercises, sets and weights prefill into today so you just review and save. Works on rest days too, for an unplanned session.

Tap *Menu → 📱 Dashboard*. Train smart! 💪`,
    uk: `🎉 *Що нового в trix*

📤 *Поділись своїм планом у бібліотеці*
Маєш план, який тобі подобається? Відкрий *⭐ Ще → 📚 Бібліотека програм → 📤 Поділитися своїм планом*, дай йому назву — і він стане багаторазовим шаблоном, який будь-хто зможе переглянути й забрати. Ваги автоматично підлаштуються під того, хто його візьме.

📥 *Копіювання минулого тренування*
У 📱 журналі тисни *📥 Скопіювати минуле тренування* й обери будь-яку попередню сесію — її вправи, підходи та ваги підставляться на сьогодні, лишається переглянути й зберегти. Працює й у дні відпочинку, для позапланової сесії.

Тисни *Меню → 📱 Дашборд*. Тренуйся з розумом! 💪`,
  },
  {
    version: "2026-07-24",
    en: `🎉 *What's new in trix*

🍽 *Food database + barcode scanner*
In 🍽 Food → "Food database": search a real product database (FatSecret + Open Food Facts) for exact per-100g macros, or tap "📷 Scan barcode" to read a package barcode with the camera (📷 switch lens if it opens the wrong one). Not in any database? "🤖 Estimate with AI" reads your free-text ("borsch 300 g") and logs it — so any food, in any language, gets logged. Every meal is editable: tap ✏️ to fix kcal/protein/fat/carbs.

📐 *Block periodization*
"⭐ More → 📐 Periodization" runs your training in phases — hypertrophy → strength → peak → deload — advancing automatically each week, with the target reps & intensity shown in your plan header.

📊 *Structured cardio*
Cardio menu → "Structured session": interval / tempo / LISS workouts with YOUR personal heart-rate zones (from your age).

🔗 *Supersets*
Link two exercises with 🔗 in the plan editor — they show as A1/A2 pairs in the plan and logger.

📏 *Measurement charts* — waist/chest/hips/arm/thigh now trend on the dashboard, and you can set them right in the app.

🏅 *Friends leaderboard* — invite friends (⭐ More → 👥) and compete in your own circle, not just globally.

🔕 *Quiet hours* — set a do-not-disturb window in your profile; no reminders during it.

✏️ *Fix a logged workout* — reopen today's (or a past week's) log and correct it.

⚖️ *Per-hand / per-side weights* — for one-arm machine work or dumbbells, tap ⚖️ in the logger to mark how the weight is counted.

_For trainers:_ 👥 *group / semi-private sessions* (book one slot for several clients at once) · 💰 *business snapshot* in your report (clients, retention, paying, est. revenue) · 📅 clients can add a confirmed session to their phone calendar.

Tap *Menu → 📱 Dashboard*. Train smart! 💪`,
    uk: `🎉 *Що нового в trix*

🍽 *База продуктів + сканер штрихкодів*
У 🍽 Їжа → "База продуктів": шукай у реальній базі (FatSecret + Open Food Facts) точні макроси на 100 г, або тисни "📷 Сканувати штрихкод", щоб зчитати штрихкод камерою (📷 перемкни камеру, якщо відкрилась не та). Немає в базі? "🤖 Оцінити через AI" зрозуміє вільний текст ("борщ 300 г") і запише — тож будь-який продукт будь-якою мовою логується. Кожен прийом можна виправити: тисни ✏️ і зміни ккал/Б/Ж/В.

📐 *Блокова періодизація*
"⭐ Ще → 📐 Періодизація" веде тренування фазами — гіпертрофія → сила → пік → розвантаження — просуваючись щотижня, з цільовими повторами та інтенсивністю в шапці плану.

📊 *Структуроване кардіо*
Меню кардіо → "Структурована сесія": інтервальні / темпові / LISS сесії з ТВОЇМИ пульсовими зонами (за віком).

🔗 *Суперсети*
Зв'яжи дві вправи кнопкою 🔗 у редакторі плану — показуються парами A1/A2 у плані та журналі.

📏 *Графіки замірів* — талія/груди/стегна/рука/нога тепер у динаміці на дашборді, і вводити їх можна прямо в застосунку.

🏅 *Рейтинг друзів* — запрошуй друзів (⭐ Ще → 👥) і змагайся у своєму колі, а не лише глобально.

🔕 *Тихі години* — постав вікно "не турбувати" в профілі; протягом нього — жодних нагадувань.

✏️ *Виправ записане тренування* — відкрий журнал за сьогодні (чи минулий тиждень) і виправ.

⚖️ *Вага на руку / на гантель* — для роботи однією рукою чи з гантелями тисни ⚖️ в журналі, щоб позначити, як рахується вага.

_Для тренерів:_ 👥 *групові / semi-private сесії* (заброньуй один слот одразу кільком клієнтам) · 💰 *бізнес-зведення* у звіті (клієнти, утримання, платять, орієнт. дохід) · 📅 клієнт може додати підтверджену сесію в календар телефону.

Тисни *Меню → 📱 Дашборд*. Тренуйся з розумом! 💪`,
  },
  {
    version: "2026-07-18",
    en: `🎉 *What's new in trix*

📱 *The app got a real navigation bar* — 🏠 Home · 🏋️ Workout · 📋 Plan · 🍽 Food · ⭐ More at the bottom, profile under 👤. And during a workout the bar becomes your control panel: Food/More turn into *✅ Finish* and *⏱ Timer*. The timer opens a picker (0:30–3:00, your choice is remembered) and counts down right in the tab; Finish asks for a confirmation so nothing saves by accident.

⚡ *Opens instantly* — the dashboard renders from cache the moment you open it and refreshes quietly in the background. Pull down to refresh manually.

💍 *Activity rings* — workouts this week, water and steps today at the top of the dashboard. Set YOUR daily water & steps goals in the profile — the rings follow them.

✏️ *Fix a logged workout* — open the logger on a logged day and your saved sets are prefilled; edit and "Save changes". Past 7 days are editable via date chips (past fixes don't ping your trainer).

↺ *Repeat last workout* — each exercise shows what you actually did last time (weight × reps); apply per exercise or all at once.

🔗 *Supersets* — link two exercises with the 🔗 button in the plan editor; they show as A1/A2 pairs in the plan and the logger. AI-generated supersets display the same way.

🥫 *Food database* — in Food, search a real product database (exact kcal/protein per 100g), pick, enter grams — logged precisely. AI stays for free-text.

📏 *Measurement charts* — waist/chest/hips/arm/thigh now trend on the dashboard next to your weight.

🧊 *Streak freeze* — one missed week inside a solid streak (4+ weeks) no longer burns it. Vacation mode still freezes too.

📸 *Progress photo gallery* — send a photo via "📸 Progress photo" (menu → More) and browse your gallery in the app profile; trainers see their clients' photos on the card.

👥 *Invite a friend* — grab your personal link in the menu; when your friend finishes the interview you earn the 🤝 badge.

🏅 *Rank battles* — the weekly digest now tells you when someone overtakes you (or you climb). Opt-in on the leaderboards.

Tap *Menu → 📱 Dashboard*. Train smart! 💪`,
    uk: `🎉 *Що нового в trix*

📱 *У застосунку з'явилась справжня навігація* — 🏠 Головна · 🏋️ Тренування · 📋 План · 🍽 Їжа · ⭐ Ще внизу екрана, профіль — під 👤. А під час тренування панель стає пультом: Їжа/Ще перетворюються на *✅ Завершити* та *⏱ Таймер*. Таймер відкриває вибір часу (0:30–3:00, твій вибір запам'ятовується) і рахує прямо у вкладці; Завершення питає підтвердження — нічого не збережеться випадково.

⚡ *Відкривається миттєво* — дашборд рендериться з кешу одразу, а свіжі дані тихо підтягуються фоном. Потягни вниз, щоб оновити вручну.

💍 *Кільця активності* — тренування тижня, вода і кроки сьогодні вгорі дашборда. Постав СВОЇ денні цілі води та кроків у профілі — кільця слухаються їх.

✏️ *Виправ записане тренування* — відкрий журнал у день із записом: збережені підходи вже підставлені; виправ і "Зберегти зміни". Останні 7 днів редагуються через чипи дат (виправлення минулого не пінгують тренера).

↺ *Повторити минуле тренування* — кожна вправа показує, що ти реально робив минулого разу (вага × повтори); застосуй для однієї вправи або всіх одразу.

🔗 *Суперсети* — зв'яжи дві вправи кнопкою 🔗 у редакторі плану; вони показуються парами A1/A2 у плані та журналі. AI-згенеровані суперсети виглядають так само.

🥫 *База продуктів* — у Їжі шукай по реальній базі (точні ккал/білок на 100г), обери, введи грами — записано точно. AI лишається для вільного тексту.

📏 *Графіки замірів* — талія/груди/стегна/рука/нога тепер у динаміці на дашборді поруч із вагою.

🧊 *Заморозка стріку* — один пропущений тиждень усередині міцного стріку (4+ тижні) більше не спалює його. Відпустка теж заморожує, як і раніше.

📸 *Галерея фото прогресу* — надішли фото через "📸 Фото прогресу" (меню → Ще) і дивись галерею в профілі застосунку; тренер бачить фото своїх клієнтів на картці.

👥 *Запроси друга* — персональне посилання в меню; коли друг завершить анкету — отримаєш бейдж 🤝.

🏅 *Битви за рейтинг* — тижневий дайджест тепер каже, коли тебе обійшли (або ти піднявся). Для учасників рейтингів.

Тисни *Меню → 📱 Дашборд*. Тренуйся з розумом! 💪`,
  },
  {
    version: "2026-07-17",
    en: `🎉 *What's new in trix*

⚡ *Reminders open the app directly* — the workout reminder now has a "📱 Log in the app" button and the evening check-in a "📱 Fill in the app" button. One tap and you're already on the right screen — no digging through the menu.

🏋️ *"Today" card on the dashboard* — the first thing you see in the morning: today's muscle group and exercise count with a *Start* button that drops you straight into the logger. It disappears once the workout is logged (and on rest days).

⏱ *Rest timer always in sight* — the timer moved into the sticky bar at the bottom of the logger, right next to "Finish workout". Doing your last exercise? The countdown and the 1/2/3-min buttons are right there — no more scrolling up to find them.

🗑 *Remove an exercise from today* — next to ⬆️⬇️ and Swap, each exercise card now has a delete button. Not doing curls today? One tap and it's out of the session (with a confirm if you already typed sets in).

⭐ *Level, streak & progress bar* — the dashboard header now shows a visual XP bar toward your next level and your 🔥 week streak (vacations don't break it).

🏅 *Real leaderboards* — "More" now shows the top-5 of every board (consistency, progress, relative strength, total volume) with 🥇🥈🥉 medals and your row highlighted — not just your rank number.

🎖 *Badge collection* — all 12 badges in one screen: earned ones shine ✅, locked ones show 🔒 what's still ahead. And when you earn a new badge, the app celebrates it with a small animation the moment you open it.

📈 *Tap a record — see its history* — personal records marked 📈 unfold into an e1RM trend chart for that exact lift, built from every set you've ever logged.

Tap *Menu → 📱 Dashboard*. Train smart! 💪`,
    uk: `🎉 *Що нового в trix*

⚡ *Нагадування відкривають застосунок одразу* — у нагадуванні про тренування тепер є кнопка "📱 Записати в застосунку", а у вечірньому чек-іні — "📱 Заповнити в застосунку". Один тап — і ти вже на потрібному екрані, без блукання по меню.

🏋️ *Картка "Сьогодні" на дашборді* — перше, що бачиш зранку: група м'язів і кількість вправ на сьогодні з кнопкою *Почати*, яка веде прямо в журнал тренування. Після запису тренування (і в дні відпочинку) картка зникає.

⏱ *Таймер відпочинку завжди на видноті* — таймер переїхав у закріплену панель внизу журналу, поруч із "Завершити тренування". Робиш останню вправу? Відлік і кнопки 1/2/3 хв просто перед очима — більше не треба скролити вгору.

🗑 *Прибрати вправу з сьогодні* — поруч із ⬆️⬇️ та Заміною в кожній картці вправи з'явилася кнопка видалення. Сьогодні без біцепса? Один тап — і вправи немає в сесії (з підтвердженням, якщо вже ввів підходи).

⭐ *Рівень, стрік і прогрес-бар* — у шапці дашборда тепер візуальна смужка XP до наступного рівня і твій 🔥 тижневий стрік (відпустка його не обриває).

🏅 *Справжні рейтинги* — у "Ще" тепер топ-5 кожного рейтингу (стабільність, прогрес, відносна сила, загальний об'єм) з медалями 🥇🥈🥉 і підсвіченим твоїм рядком — а не лише номер твого місця.

🎖 *Колекція бейджів* — усі 12 бейджів на одному екрані: здобуті сяють ✅, закриті показують 🔒 що ще попереду. А коли здобудеш новий — застосунок відсвяткує це маленькою анімацією при відкритті.

📈 *Тапни рекорд — побач історію* — особисті рекорди з позначкою 📈 розгортаються у графік тренду 1ПМ саме цієї вправи, побудований з усіх твоїх записаних підходів.

Тисни *Меню → 📱 Дашборд*. Тренуйся з розумом! 💪`,
  },
  {
    version: "2026-07-15",
    en: `🎉 *What's new in trix*

📱 *The Mini App now does almost everything* — open 📱 Dashboard:

📋 *Training plan* — view your whole week and edit it right in the app: change weight or sets, swap an exercise (catalog search or your own name — with a video looked up automatically), add / delete / reorder exercises. Trainers edit a client's plan the same way from the client card.

🍽 *Nutrition* — today's meals with one-tap re-weigh (½ / 1.5× / 2× or exact grams) and delete, totals vs your targets, and your meal-plan.

⚙️ *Profile & settings* — edit goal, level, equipment, diet, training days, goal weight, reminder hour, and (clients) exactly what your trainer may see.

🏆 *Challenges, injuries & boards* — join challenges and watch progress bars, report an injury, and see your leaderboard ranks.

🚴 *Cardio & more logging* — log rowing/cycling/running by time & distance (bot & app), plus quick steps, measurements and a daily check-in on the dashboard — each with instant confirmation.

🌙 *One evening check-in at 9pm* — water, steps, food and well-being in a single tap-through checklist instead of four separate pings.

⭐ *Rate trix* — a light bi-weekly "how's it going?" so your feedback shapes what's next.

_For trainers (in the app):_ client card with health/personal notes, interview summary + reminders, a ⚡ mini-interview to draft a plan, an on-demand client report, billing edits, a ❓ questions inbox, program templates, 📢 broadcast, and 📅 session booking.

Tap *Menu → 📱 Dashboard*. Train smart! 💪`,
    uk: `🎉 *Що нового в trix*

📱 *Mini App тепер вміє майже все* — відкрий 📱 Дашборд:

📋 *План тренувань* — переглядай весь тиждень і редагуй прямо в застосунку: зміна ваги чи підходів, заміна вправи (пошук по каталогу або своя назва — з автоматичним підбором відео), додавання / видалення / зміна порядку. Тренер так само редагує план клієнта з картки.

🍽 *Харчування* — прийоми їжі за сьогодні з пере-зважуванням у тап (½ / 1.5× / 2× або точні грами) та видаленням, підсумки проти цілей і твій план харчування.

⚙️ *Профіль і налаштування* — ціль, рівень, обладнання, харчування, дні тренувань, цільова вага, година нагадувань і (для клієнтів) що саме бачить тренер.

🏆 *Челенджі, травми та рейтинги* — приєднуйся до челенджів із прогрес-барами, повідом про травму, дивись свої місця в рейтингах.

🚴 *Кардіо та більше записів* — веслування/велосипед/біг за часом і дистанцією (бот і застосунок), плюс швидкі кроки, заміри та щоденний чек-ін на дашборді — з миттєвим підтвердженням.

🌙 *Один вечірній чек-ін о 21:00* — вода, кроки, їжа та самопочуття одним чек-лістом замість чотирьох окремих пінгів.

⭐ *Оцінка trix* — легке питання раз на 2 тижні, щоб твій відгук впливав на розвиток.

_Для тренерів (у застосунку):_ картка клієнта з нотатками, зведення інтерв'ю + нагадування, ⚡ міні-інтерв'ю для драфту плану, звіт по клієнтах на вимогу, правки біллінгу, ❓ інбокс питань, шаблони програм, 📢 розсилка та 📅 запис сесій.

Тисни *Меню → 📱 Дашборд*. Тренуйся з розумом! 💪`,
  },
  {
    version: "2026-07-10",
    en: `🎉 *What's new in trix*

🏋️ *Log your workout in the Mini App*
Open 📱 Dashboard → "🏋️ Log today's workout". Every exercise is its own card with your planned weights and reps already filled in as hints. Did it exactly as planned? Tap the "✓ 4×9 · 50 kg" chip — the whole exercise is logged in one touch. You can add or remove sets, type your own numbers, and mark how hard it felt (Easy / Moderate / Hard / Max effort) — that feeds your future weight progression. Machine busy? "↔ Swap" offers 3 alternatives for the same muscles. The rest timer (1/2/3 min) counts down on screen AND pings you in chat even if the screen locks. Everything you type is saved as a draft, so a dropped connection loses nothing. Finish with one button — new records 🏆, badges 🏅 and level-ups ⬆️ show up right there.

ℹ️ *Technique & video inside each exercise*
Every exercise card has a fold-out "ℹ️ Technique & video": short form cues plus a "▶️ Watch video" button — the video opens in your browser while your workout stays put.

🗓 *Plan days are yours to manage*
Plan → "🗓 Days": delete a day you don't need (with a confirm), or add a new one — pick a free weekday, choose what it trains (Chest, Back, Legs…), and the bot fills it with exercises matched to your level. Reminders and the calendar adjust automatically.

✏️ *Plan editing without extra steps*
Changed a weight or sets, or swapped an exercise? The editor re-opens by itself for the next one. Done editing — tap "✅ Done" to see the updated day.

☰ *A lighter menu*
Only daily actions on top: Today, Plan, Log, Nutrition, Coach, Progress. Everything else (measurements, steps, water, calendar, library, vacation…) is one tap away under "➕ More". Nothing was removed — and "📣 What's new" now lives right in the menu.

🤝 *You decide what your trainer sees*
Settings → "🤝 Sharing with trainer": body data (height, weight, measurements) and health info (limitations, injuries) are visible to your trainer ONLY if you switch them on. Off by default. Workouts, plan and progress stay visible as before.

_For trainers:_
• The client card grew: 🩺 health notes (injuries, pain triggers) and 🎂 personal notes + birthday (with a heads-up when it's close) — written by you, visible to you.
• 📝 "Interview" on the card: every intake answer in one place, plus progress (e.g. 7/11) and a "🔔 Remind to finish" button — the client receives exactly the question they stopped at.
• ⚡ Mini-interview: answer 6 quick questions FOR a client and get a plan draft immediately. Their own interview keeps running untouched — once they finish it, you receive an updated draft proposal with corrections.
• 📊 "Report" in your menu: a table of all clients — interview status, plan/draft, activity (workouts, check-ins, food, steps) and last-active date.
• 🗓 Add/remove days in a client's plan, and the client card is now in the Mini App too — with charts and note editing.

Tap *Menu* to explore. Train smart! 💪`,
    uk: `🎉 *Що нового в trix*

🏋️ *Журнал тренування тепер у Mini App*
Відкрий 📱 Дашборд → "🏋️ Записати тренування". Кожна вправа — окрема картка, планові ваги й повтори вже підставлені як підказки. Виконав як у плані? Тисни чип "✓ 4×9 · 50 кг" — вправа записана одним дотиком. Можна додати чи прибрати підходи, вписати свої цифри та відмітити, наскільки важко було (Легко / Помірно / Важко / На межі) — це впливає на майбутню прогресію ваг. Тренажер зайнятий? "↔ Замінити" запропонує 3 альтернативи на ті самі м'язи. Таймер відпочинку (1/2/3 хв) рахує на екрані І надішле пінг у чат, навіть якщо екран згас. Усе введене зберігається як чернетка — обрив інтернету нічого не зітре. Наприкінці одна кнопка — і нові рекорди 🏆, бейджі 🏅 та рівні ⬆️ покажуться одразу.

ℹ️ *Техніка і відео просто у вправі*
У кожній картці вправи є розкривний блок "ℹ️ Техніка і відео": короткі підказки з техніки та кнопка "▶️ Дивитись відео" — ролик відкриється у браузері, а тренування залишиться на місці.

🗓 *Дні плану — під твоїм контролем*
План → "🗓 Дні": видали непотрібний день (з підтвердженням) або додай новий — обери вільний день тижня, вкажи, що тренуємо (Груди, Спина, Ноги…), і бот сам наповнить день вправами під твій рівень. Нагадування та календар підлаштуються автоматично.

✏️ *Редагування плану без зайвих кроків*
Змінив вагу чи підходи, замінив вправу? Редактор одразу відкриється знову для наступної. Закінчив — тисни "✅ Готово" і побачиш оновлений день.

☰ *Меню стало легшим*
Зверху лише щоденні дії: Сьогодні, План, Записати, Харчування, Тренер, Прогрес. Усе інше (заміри, кроки, вода, календар, бібліотека, відпустка…) — за один дотик у "➕ Ще". Нічого не видалено — а "📣 Що нового" тепер прямо в меню.

🤝 *Ти вирішуєш, що бачить тренер*
Налаштування → "🤝 Доступ тренеру": дані тіла (зріст, вага, заміри) та здоров'я (обмеження, травми) видно тренеру, ЛИШЕ якщо ти сам це увімкнеш. За замовчуванням — вимкнено. Тренування, план і прогрес видно як і раніше.

_Для тренерів:_
• Картка клієнта поповнилась: 🩺 нотатки про здоров'я (травми, що тригерить біль) та 🎂 особисте + день народження (з підказкою, коли він близько) — пишеш ти, бачиш ти.
• 📝 "Інтерв'ю" на картці: всі відповіді анкети в одному місці, прогрес (наприклад, 7/11) і кнопка "🔔 Нагадати завершити" — клієнту прийде саме те питання, на якому він зупинився.
• ⚡ Міні-інтерв'ю: відповідаєш на 6 швидких питань ЗА клієнта — і одразу готовий драфт плану. Власне інтерв'ю клієнта не збивається; коли він завершить його повністю, ти отримаєш оновлений драфт із правками.
• 📊 "Звіт" у меню: таблиця по всіх клієнтах — статус анкети, план/драфт, активність (тренування, чек-іни, їжа, кроки) та дата останньої активності.
• 🗓 Дні плану клієнта теж додаються й видаляються, а картка клієнта тепер є і в Mini App — з графіками та редагуванням нотаток.

Тисни *Меню*, щоб усе спробувати. Тренуйся з розумом! 💪`,
  },
  {
    version: "2026-07-04",
    en: `🎉 *What's new in trix*

🏋️ *Log a whole exercise in ONE message* — send "80 8" (all sets), "80 8,7,6" (reps per set) or "80x8 75x10". No more three questions per exercise — and you can tap any logged set to fix its reps or weight.
   ↳ Menu → 📝 Log workout

⏱ *Rest timer* — after logging an exercise, one tap on 1/2/3 min and I'll ping you when rest is over.

⭐ *Levels & XP* — every workout, meal log and check-in earns XP. Your level shows in 📊 Progress, the week card and the dashboard.

📱 *Quick log in the Dashboard* — add water, an exercise or a meal (AI-estimated) right from the Mini App, without the chat.
   ↳ Menu → 📊 Dashboard

📈 *Strength charts by muscle group* — the e1RM chart now overlays all lifts of a group (Chest, Back, Legs…) instead of one lift at a time.

🤖 *Smarter plans* — plan generation now thinks like a live coach: exercise order, no duplicate movements, fatigue and time budgets, weekly volume per muscle. The AI coach also weighs your WHOLE training day before suggesting edits.

📊 *Tidier menu* — progress, reports, records, challenges and check-in now live under one 📊 Progress & stats section.

🎙 *Voice → coach* — a voice note while idle can now go straight to the AI coach, not only to logging.

_For trainers:_ 📋 reusable program templates (save a client's plan, assign to others — weights auto-adapt) · 💳 billing per client (paid-until / session packages) with a 💰 finance summary · 📤 forwardable client week card · 📸 request a progress photo · ❓ question archive · 👥 client limit with a waitlist · 🌍 sessions respect time zones + meeting links.

Tap *Menu* to explore. Train smart! 💪`,
    uk: `🎉 *Що нового в trix*

🏋️ *Логуй вправу ОДНИМ повідомленням* — надішли "80 8" (всі підходи), "80 8,7,6" (повтори по підходах) або "80x8 75x10". Більше жодних трьох питань на вправу — а будь-який записаний підхід можна виправити тапом.
   ↳ Меню → 📝 Записати тренування

⏱ *Таймер відпочинку* — після запису вправи один тап на 1/2/3 хв, і я пінгую, коли відпочинок закінчився.

⭐ *Рівні та XP* — кожне тренування, лог їжі та чек-ін дають XP. Рівень видно в 📊 Прогресі, картці тижня та дашборді.

📱 *Швидкий запис у Дашборді* — додай воду, вправу чи їжу (AI порахує калорії) просто з Mini App, без чату.
   ↳ Меню → 📊 Дашборд

📈 *Графіки сили по групах м'язів* — графік 1ПМ тепер показує всі вправи групи разом (Груди, Спина, Ноги…), а не по одній.

🤖 *Розумніші плани* — генерація тепер думає як живий тренер: порядок вправ, без дублів рухів, бюджет втоми і часу, тижневий об'єм на м'яз. AI-тренер теж зважує ВЕСЬ твій тренувальний день перед порадою.

📊 *Охайніше меню* — прогрес, звіти, рекорди, челенджі та чек-ін тепер в одному розділі 📊 Прогрес і статистика.

🎙 *Голос → тренер* — голосове у вільному режимі тепер можна відправити прямо AI-тренеру, а не лише в лог.

_Для тренерів:_ 📋 шаблони програм (збережи план клієнта, признач іншим — ваги адаптуються) · 💳 облік оплат по клієнту (оплачено до / пакети сесій) і 💰 фінансова зведення · 📤 картка тижня клієнта для пересилання · 📸 запит фото прогресу · ❓ архів питань · 👥 ліміт клієнтів з листом очікування · 🌍 сесії враховують часові пояси + посилання на зустріч.

Тисни *Меню*, щоб усе спробувати. Тренуйся з розумом! 💪`,
  },
  {
    version: "2026-07-02",
    en: `🎉 *What's new in trix*

📊 *Dashboard (Mini App)* — interactive charts right inside Telegram: weight trend with a goal forecast, a tappable month calendar, volume by muscle, e1RM history per exercise and macro adherence. Dark/light theme follows Telegram.
   ↳ Menu → 📊 Dashboard (charts moved here from /progress)

🍽 *Adaptive calories* — once in a while I compare your real weight trend with your goal pace and gently tune your daily kcal target (±150 max), telling you why.
   ↳ automatic · needs a goal weight + regular logging

⏰ *Smart reminder timing* — if you always train at a different time than your reminder assumes, I'll offer to move it. One tap to accept.
   ↳ automatic

🎙 *Voice logging* — send a voice note; when idle I'll ask whether to log a workout or food, then handle it like typed text.
   ↳ just record a voice message

🩹 *Injury tracking* — report pain in an area and I'll swap the conflicting exercises in your plan for safe ones, then check back as it heals.
   ↳ Settings → 🩹 Injury

📅 *Calendar* — a month view of your planned days, logged workouts and booked sessions at a glance.
   ↳ Menu → 📅 Calendar

📅 *Book sessions with your trainer* — pick a date and time; the other side confirms, and you both get reminders the day before and on the day.
   ↳ a trainer's profile → 📅 Book · or the calendar day card

_For trainers:_ 📅 a sessions calendar, book clients from their card, and automatic *at-risk alerts* when a client misses two planned sessions in a row or stops logging food.

Tap *Menu* to explore. Train smart! 💪`,
    uk: `🎉 *Що нового в trix*

📊 *Дашборд (Mini App)* — інтерактивні графіки просто в Telegram: тренд ваги з прогнозом до цілі, місячний календар з тапом у день, об'єм по м'язах, історія 1ПМ по вправах і дотримання макросів. Темна/світла тема — як у Telegram.
   ↳ Меню → 📊 Дашборд (графіки переїхали сюди з /progress)

🍽 *Адаптивні калорії* — час від часу я звіряю реальний тренд ваги з темпом до цілі та обережно коригую денну ціль ккал (до ±150), пояснюючи чому.
   ↳ автоматично · потрібні цільова вага + регулярні логи

⏰ *Розумний час нагадувань* — якщо ти постійно тренуєшся в інший час, ніж стоїть нагадування, я запропоную перенести його. Один тап — і готово.
   ↳ автоматично

🎙 *Голосове логування* — надішли голосове; коли ти вільний, я спитаю, що записати — тренування чи їжу, і оброблю як текст.
   ↳ просто запиши голосове повідомлення

🩹 *Відстеження травм* — повідом про біль у зоні, і я заміню конфліктні вправи в плані на безпечні, а потім перевірю, як загоюється.
   ↳ Налаштування → 🩹 Травма

📅 *Календар* — місячний огляд запланованих днів, залогованих тренувань і записаних сесій.
   ↳ Меню → 📅 Календар

📅 *Запис на сесію з тренером* — обери дату й час; друга сторона підтверджує, і ви обидва отримуєте нагадування напередодні та в день сесії.
   ↳ профіль тренера → 📅 Записатись · або картка дня в календарі

_Для тренерів:_ 📅 календар сесій, запис клієнтів з їхньої картки та автоматичні *алерти про ризик*, коли клієнт пропускає два заплановані тренування поспіль або перестає логувати їжу.

Тисни *Меню*, щоб усе спробувати. Тренуйся з розумом! 💪`,
  },
  {
    version: "2026-06-30",
    en: `🎉 *What's new in trix*

🎯 *Weight goal + forecast* — set a target weight and see your trend (kg/wk) and an ETA to reach it.
   ↳ Settings → 🎯 Goal weight · shows on 📊 Progress

📊 *Volume by muscle (MEV/MAV)* — weekly working sets per region vs. smart landmarks.
   ↳ Progress → 📊 Volume

🔢 *Plate & warm-up calculator* — working weight → plates per side + a warm-up ramp.
   ↳ Progress → 🔢 Calculator (or /plates)

🤖 *What to eat* — an AI suggestion to hit the macros you have LEFT today.
   ↳ Nutrition → 🤖 What to eat

📉 *Plateau alerts* — I flag lifts that stopped progressing and suggest a fix.
   ↳ automatic · also shown on Progress

📊 *Weekly digest* — a Sunday recap of your week in numbers.
   ↳ automatic (toggle in 🔔 Reminders)

😴 *Wellbeing trend* — energy / sleep / stress charted over time.
   ↳ Progress → 😴 Wellbeing

🖼️ *Shareable week card* — a clean image of your week to share.
   ↳ Progress → 🖼️ Share card

📄 *Better data export* — a readable report with dates and clear sections.
   ↳ /export

Tap *Menu* to explore. Keep crushing it! 💪`,
    uk: `🎉 *Що нового в trix*

🎯 *Ціль по вазі + прогноз* — вкажи цільову вагу й дивись тренд (кг/тиж) та орієнтовний час до цілі.
   ↳ Налаштування → 🎯 Цільова вага · видно на 📊 Прогрес

📊 *Об'єм по м'язах (MEV/MAV)* — тижневі робочі підходи по групах проти розумних орієнтирів.
   ↳ Прогрес → 📊 Об'єм

🔢 *Калькулятор блинів і розминки* — робоча вага → блини на сторону + розминкова прогресія.
   ↳ Прогрес → 🔢 Калькулятор (або /plates)

🤖 *Що з'їсти* — AI-підказка під макроси, що ЗАЛИШИЛИСЬ на сьогодні.
   ↳ Харчування → 🤖 Що з'їсти

📉 *Сповіщення про плато* — позначаю вправи, що перестали прогресувати, і пропоную рішення.
   ↳ автоматично · також на Прогресі

📊 *Тижневий дайджест* — недільний підсумок тижня в цифрах.
   ↳ автоматично (вмикається в 🔔 Нагадування)

😴 *Тренд самопочуття* — енергія / сон / стрес у динаміці.
   ↳ Прогрес → 😴 Самопочуття

🖼️ *Картка тижня* — гарне зображення твого тижня, щоб поділитися.
   ↳ Прогрес → 🖼️ Картка тижня

📄 *Кращий експорт даних* — читабельний звіт з датами та зрозумілими секціями.
   ↳ /export

Тисни *Меню*, щоб усе спробувати. Тримай темп! 💪`,
  },
  {
    version: "2026-06-29",
    en: `🎉 *What's new in trix*

💧 *Water tracking* — log your water with one tap and hit your daily goal.
   ↳ Menu → 💧 Water

🎯 *Challenges* — join consistency goals (e.g. "4 workouts a week") and watch your progress bar fill.
   ↳ Menu → 🎯 Challenges

🏆 *Strength standards* — see how your big lifts rank (beginner → elite) for your bodyweight, and the load for the next tier.
   ↳ Menu → 📊 Progress → 🏆 Standards

📏 *Measurement charts* — waist / chest / arm / hips / thigh now trend over time alongside your weight chart.
   ↳ Menu → 📊 Progress

📈 *Per-exercise chart* — track one lift's estimated 1RM over time.
   ↳ Menu → 📊 Progress → 📈 Exercise chart

🍎 *Photo portion buttons* — sent a meal photo? Fix the portion with ½ / 1.5× / 2× in one tap before logging.

⭐ *Quick re-log* — re-add foods you eat often without typing.
   ↳ Menu → 🍎 Nutrition → ⭐ Frequent foods

🔔 *Reminder settings* — switch each reminder on/off (including the new water nudge).
   ↳ Menu → ⚙️ Settings → 🔔 Reminders

🏖 *Vacation mode* — pause all reminders while you rest; I'll check in when you're back.
   ↳ Menu → 🏖 Vacation mode

_For trainers:_ 📣 message all clients at once · 📝 keep private notes on each client · 📅 clients can request offline sessions from your profile.

Tap *Menu* to explore. Train smart! 💪`,
    uk: `🎉 *Що нового в trix*

💧 *Відстеження води* — логуй воду одним тапом і виконуй денну норму.
   ↳ Меню → 💧 Вода

🎯 *Челенджі* — приєднуйся до цілей на стабільність (напр. "4 тренування на тиждень") і дивись, як заповнюється прогрес-бар.
   ↳ Меню → 🎯 Челенджі

🏆 *Силові стандарти* — побач, на якому рівні твої базові вправи (початківець → еліта) відносно ваги тіла, і яку вагу взяти для наступного рівня.
   ↳ Меню → 📊 Прогрес → 🏆 Стандарти

📏 *Графіки замірів* — талія / груди / рука / стегна / нога тепер показані в динаміці поруч із графіком ваги.
   ↳ Меню → 📊 Прогрес

📈 *Графік по вправі* — відстежуй орієнтовний 1ПМ окремої вправи в часі.
   ↳ Меню → 📊 Прогрес → 📈 Графік вправи

🍎 *Кнопки порції на фото* — надіслав фото їжі? Виправ порцію через ½ / 1.5× / 2× одним тапом перед логуванням.

⭐ *Швидкий ре-лог* — додавай улюблені продукти без набору тексту.
   ↳ Меню → 🍎 Харчування → ⭐ Часті продукти

🔔 *Налаштування нагадувань* — вмикай/вимикай кожне нагадування (зокрема нове — про воду).
   ↳ Меню → ⚙️ Налаштування → 🔔 Нагадування

🏖 *Режим відпустки* — постав усі нагадування на паузу, поки відпочиваєш; я нагадаю, коли повернешся.
   ↳ Меню → 🏖 Режим відпустки

_Для тренерів:_ 📣 повідомлення всім клієнтам одразу · 📝 приватні нотатки по кожному клієнту · 📅 клієнти можуть записатися на офлайн з твого профілю.

Тисни *Меню*, щоб усе спробувати. Тренуйся з розумом! 💪`,
  },
];

export function latestRelease(): ReleaseNote {
  return RELEASE_NOTES[0];
}

/** The release-note body for a language, rendered to Telegram HTML. */
export function releaseBody(lang: Lang, note: ReleaseNote = latestRelease()): string {
  return mdToHtml(escapeHtml(lang === "en" ? note.en : note.uk));
}
