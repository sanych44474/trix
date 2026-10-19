import type { Lang } from "./types";
import { escapeHtml, mdToHtml } from "./locales/i18n";

// Versioned, bilingual release notes — the last 2 only. Newest first. Bodies use the same
// *bold*/_italic_ markers as the locale catalog; keep them author-controlled (no raw <, >, & —
// they're HTML-escaped first). The owner broadcasts the latest entry to every user (each in
// their own language) with a confirm gate. Older history lives in docs/release-notes.md (add each
// new entry there too), not in the Worker bundle — /whatsnew only needs the current and previous version.
export interface ReleaseNote {
  version: string; // YYYY-MM-DD (also the display tag)
  en: string;
  uk: string;
}

export const RELEASE_NOTES: ReleaseNote[] = [
  {
    version: "2026-10-18",
    en: `🎉 *What's new in trix*

📓 *A training journal* — the app is rebuilt around today's workout: five tabs (Today, Training, Food, Progress, More), calm colours and less text on every screen.

🏋️ *Today* — the day's workout with its real length from your plan, the week as done / planned / rest marks, and water and steps logged right there.

🎯 *Focus mode* — one exercise on screen: a set in one tap, the rest timer at the bottom, the muscles the exercise works, and a summary with volume and records when you finish.

🗓 *Plan as a week* — Monday to Sunday at a glance; edit an exercise or add a training day in a panel over the schedule.

📈 *Progress in three sections* — Training (muscle map, calendar, 1RM), Body (weight for a week, month or 3 months, measurements, photos) and Food.

🍽 *Faster food logging* — calories and macros as bars, and four quick ways to log: search with recent foods, photo, voice and barcode. Search now starts from a 400-food base.

📋 *45 ready programs* — gym, dumbbells or no equipment, for every level. Pick one in More → Ready programs.

🔴 *Red theme* — Settings → Screen → Colour. Works in light and dark.

✅ *More accurate* — muscles are matched correctly for hundreds more exercises, cardio no longer counts as dozens of sets, and a swapped exercise doesn't inherit the old weight.

Tap *📱 Open trix* below.`,
    uk: `🎉 *Що нового в trix*

📓 *Щоденник тренувань* — застосунок перебудовано навколо тренування дня: п'ять вкладок (Сьогодні, Тренування, Харчування, Прогрес, Ще), спокійні кольори й менше тексту на кожному екрані.

🏋️ *Сьогодні* — тренування дня з реальною тривалістю за твоїм планом, тиждень позначками «зроблено / заплановано / відпочинок», а воду й кроки записуєш просто тут.

🎯 *Режим фокусу* — на екрані одна вправа: підхід одним дотиком, таймер відпочинку внизу, м'язи, які працюють, і підсумок з обсягом і рекордами наприкінці.

🗓 *План як тиждень* — з понеділка по неділю одним поглядом; вправу чи новий день редагуєш у панелі поверх розкладу.

📈 *Прогрес у трьох розділах* — Тренування (карта м'язів, календар, 1ПМ), Тіло (вага за тиждень, місяць чи 3 місяці, заміри, фото) і Харчування.

🍽 *Швидше записувати їжу* — калорії та БЖВ смужками і чотири швидкі способи: пошук із нещодавніми, фото, голос і штрихкод. Пошук тепер починається з бази на 400 продуктів.

📋 *45 готових програм* — зал, гантелі чи без інвентарю, для будь-якого рівня. Обирай у Ще → Готові програми.

🔴 *Червона тема* — Налаштування → Екран → Колір. Працює у світлій і темній.

✅ *Точніше* — м'язи правильно визначаються ще для сотень вправ, кардіо більше не рахується як десятки підходів, а замінена вправа не успадковує стару вагу.

Тисни *📱 Відкрити trix* нижче.`,
  },
  {
    version: "2026-10-07",
    en: `🎉 *What's new in trix*

📱 *Everything in one app* — trix now lives in the Mini App: onboarding, workouts, food, the coach and your trainer. The bot just opens the app and sends reminders.

📷 *Meal by photo* — snap your plate: trix finds the foods and portions, you fix the grams if needed and log it in one tap.

🎥 *Form check in the app* — film a set (up to 60 s) right from an exercise and get 2–3 technique cues.

🎙 *Voice notes* — dictate a meal, a question to the coach or a message to your trainer instead of typing.

💬 *Chat with your trainer* — messages, read receipts and notifications, all in the app. Don't have a trainer? *Choose a trainer* from the list.

👥 *Squads without a group* — create a squad, invite friends with a link and see who trained this week.

🔁 *Rebuild my plan* — changed your goal, days or equipment? Get a fresh plan in a minute. Coming from Strong or Hevy? *Import your history* from a CSV.

🔕 *Calmer reminders* — none at night (22:00–07:00 unless you set your own quiet hours) and at most 3 a day.

🌗 *Easier to read* — higher-contrast colours and a high-contrast theme.

Tap *📱 Open trix* below! 💪`,
    uk: `🎉 *Що нового в trix*

📱 *Усе в одному застосунку* — trix тепер живе в Mini App: анкета, тренування, харчування, коуч і твій тренер. Бот лише відкриває застосунок і надсилає нагадування.

📷 *Їжа за фото* — сфотографуй тарілку: trix розпізнає продукти й порції, ти за потреби правиш грами й записуєш одним дотиком.

🎥 *Перевірка техніки в застосунку* — зніми підхід (до 60 с) просто з вправи й отримай 2–3 підказки щодо техніки.

🎙 *Голосом* — надиктуй прийом їжі, питання коучу чи повідомлення тренеру замість набору тексту.

💬 *Чат із тренером* — повідомлення, позначки «прочитано» і сповіщення, усе в застосунку. Ще без тренера? *Обери тренера* зі списку.

👥 *Сквади без групи* — створи сквад, запроси друзів посиланням і дивись, хто тренувався цього тижня.

🔁 *Перебудувати план* — змінив ціль, дні чи обладнання? Новий план за хвилину. Переходиш зі Strong чи Hevy? *Імпортуй історію* з CSV.

🔕 *Спокійніші нагадування* — жодних уночі (22:00–07:00, якщо не задав свої тихі години) і не більше 3 на день.

🌗 *Легше читати* — контрастніші кольори та висококонтрастна тема.

Тисни *📱 Відкрити trix* нижче! 💪`,
  },
];

export function latestRelease(): ReleaseNote {
  return RELEASE_NOTES[0];
}

/** The release-note body for a language, rendered to Telegram HTML. */
export function releaseBody(lang: Lang, note: ReleaseNote = latestRelease()): string {
  return mdToHtml(escapeHtml(lang === "en" ? note.en : note.uk));
}
