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
    version: "2026-10-26",
    en: `🎉 *What's new in trix*

📲 *trix for Android* — a real app with the same account: an exact rest alarm, steps from Health Connect and push reminders. Download it in More → trix for Android; after that it updates itself.

⏱ *A rest timer that keeps time* — it keeps counting when you close the app, and fixing a set you already did no longer restarts it.

🔔 *One "rest is over"* — a rest started in the Android app rings on the phone only, not in this chat as well.

↕️ *Reordering that stays put* — moving or removing an exercise keeps the one you're on in front of you.

👟 *Steps on Android* — when Samsung Health doesn't sync to Health Connect, the app counts steps with the phone's own sensor.

🔐 *Sign-in for everyone* — signing in to the app with Telegram works on every account.

📵 *iPhone fix* — the blank white screen on older iPhones is gone.

💬 *Answers to your feedback* — when you send feedback, the reply comes back right here in the bot.

🌍 *Fully translated* — grams, kilos, minutes and days are no longer left in English.

Tap *📱 Open trix* below.`,
    uk: `🎉 *Що нового в trix*

📲 *trix для Android* — справжній застосунок з тим самим акаунтом: точний таймер відпочинку, кроки з Health Connect і push-нагадування. Завантаж у Ще → trix для Android; далі він оновлюється сам.

⏱ *Таймер відпочинку, що не збивається* — рахує далі, коли закриваєш застосунок, а виправлення вже зробленого підходу більше не запускає його спочатку.

🔔 *Одне «відпочинок завершено»* — відпочинок, запущений в Android-застосунку, дзвонить лише на телефоні, а не ще й у цьому чаті.

↕️ *Перестановка без стрибків* — коли переміщуєш чи видаляєш вправу, перед тобою лишається та, на якій ти зараз.

👟 *Кроки на Android* — коли Samsung Health не передає дані в Health Connect, застосунок рахує кроки датчиком телефона.

🔐 *Вхід для всіх* — увійти в застосунок через Telegram тепер можна з будь-якого акаунта.

📵 *Виправлено на iPhone* — білий екран на старіших iPhone зник.

💬 *Відповіді на відгуки* — коли надсилаєш відгук, відповідь приходить просто сюди, у бот.

🌍 *Повністю перекладено* — грами, кілограми, хвилини й дні більше не лишаються англійською.

Тисни *📱 Відкрити trix* нижче.`,
  },
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

📉 *Honest plateau alerts* — only when nothing moved for weeks (weight, reps, sets or volume), with your numbers and one concrete next step.

🔕 *One switch for notifications* — Settings → What nudges you → All Telegram notifications.

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

📉 *Чесні сповіщення про плато* — лише коли за кілька тижнів не зросло нічого (вага, повторення, підходи чи обʼєм), з твоїми цифрами й конкретним наступним кроком.

🔕 *Один перемикач сповіщень* — Налаштування → Які нагадування отримувати → Усі сповіщення в Telegram.

Тисни *📱 Відкрити trix* нижче.`,
  },
];

export function latestRelease(): ReleaseNote {
  return RELEASE_NOTES[0];
}

/** The release-note body for a language, rendered to Telegram HTML. */
export function releaseBody(lang: Lang, note: ReleaseNote = latestRelease()): string {
  return mdToHtml(escapeHtml(lang === "en" ? note.en : note.uk));
}
