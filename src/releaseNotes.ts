import type { Lang } from "./types";
import { escapeHtml, mdToHtml } from "./locales/i18n";

// Versioned, bilingual release notes — the last 2 only. Newest first. Bodies use the same
// *bold*/_italic_ markers as the locale catalog; keep them author-controlled (no raw <, >, & —
// they're HTML-escaped first). The owner broadcasts the latest entry to every user (each in
// their own language) with a confirm gate. Older history lives in docs/release-notes.md (add each
// new entry there too), not in the Worker bundle — /whatsnew only needs the current and previous version.
interface ReleaseNote {
  version: string; // YYYY-MM-DD (also the display tag)
  en: string;
  uk: string;
}

export const RELEASE_NOTES: ReleaseNote[] = [
  {
    version: "2026-11-14",
    en: `🎉 *What's new in Hack Limits*

🏋️ *Your own limits* — your dumbbells stop at 30 kg? Set the heaviest weight for an exercise, or for all dumbbell exercises at once, from its menu while you train or in Settings. The app will never suggest more; at your limit it adds reps instead. You can also switch automatic increases off.

🔔 *Tap the rest notification* — on Android it now opens your workout (it needs the new app version).

🩹 *Safer swaps* — swapping or adding an exercise checks it against your active injuries, in English and Russian too.

📶 *Saves that hold* — a workout saved offline is no longer lost or sent twice, and tapping a slow save again does not log a meal twice.

🔥 *Volume and calories* — bodyweight moves like pull-ups and push-ups now count in a session's volume, and the summary shows an estimate of the calories you burned.

✏️ *Your day, your names* — rename the muscle groups of a training day in the plan.

🔧 *Fixed* — time and distance targets ("3 x 1 min", "5 km") are suggested correctly, a typo in a record no longer blocks the real one, cancelling a vacation ends the streak freeze, and a quick log on a skipped day counts as a workout.

Tap *📱 Open Hack Limits* below.`,
    uk: `🎉 *Що нового в Hack Limits*

🏋️ *Твої власні ліміти* — гантелі закінчуються на 30 кг? Задай найбільшу вагу для вправи або одразу для всіх вправ із гантелями: у меню вправи під час тренування чи в Налаштуваннях. Застосунок більше не запропонує важче; на твоєму ліміті він додає повторення. Автоматичне збільшення можна й вимкнути.

🔔 *Тап по сповіщенню про відпочинок* — в Android тепер відкриває твоє тренування (потрібна нова версія застосунку).

🩹 *Безпечніша заміна* — заміна чи додавання вправи перевіряється за твоїми активними травмами, також українською та російською.

📶 *Збереження, що не губиться* — тренування, збережене офлайн, більше не зникає і не надсилається двічі, а повторний тап по повільному збереженню не записує їжу двічі.

🔥 *Обсяг і калорії* — вправи з власною вагою, як підтягування й віджимання, тепер враховуються в обсязі тренування, а підсумок показує оцінку спалених калорій.

✏️ *Твій день, твої назви* — перейменуй групи м'язів тренувального дня в плані.

🔧 *Виправлено* — цілі за часом і дистанцією («3 x 1 хв», «5 км») пропонуються правильно, помилка в рекорді більше не блокує справжній, скасування відпустки завершує заморозку серії, а швидкий запис у пропущений день зараховується як тренування.

Тисни *📱 Відкрити Hack Limits* нижче.`,
  },
  {
    version: "2026-10-26",
    en: `🎉 *What's new in Hack Limits*

📲 *Hack Limits for Android* — a real app with the same account: an exact rest alarm, steps from Health Connect and push reminders. Download it in More → Hack Limits for Android; after that it updates itself.

⏱ *A rest timer that keeps time* — it keeps counting when you close the app, and fixing a set you already did no longer restarts it.

🔔 *One "rest is over"* — a rest started in the Android app rings on the phone only, not in this chat as well.

↕️ *Reordering that stays put* — moving or removing an exercise keeps the one you're on in front of you.

👟 *Steps on Android* — when Samsung Health doesn't sync to Health Connect, the app counts steps with the phone's own sensor.

🔐 *Sign-in for everyone* — signing in to the app with Telegram works on every account.

📵 *iPhone fix* — the blank white screen on older iPhones is gone.

💬 *Answers to your feedback* — when you send feedback, the reply comes back right here in the bot.

🌍 *Fully translated* — grams, kilos, minutes and days are no longer left in English.

Tap *📱 Open Hack Limits* below.`,
    uk: `🎉 *Що нового в Hack Limits*

📲 *Hack Limits для Android* — справжній застосунок з тим самим акаунтом: точний таймер відпочинку, кроки з Health Connect і push-нагадування. Завантаж у Ще → Hack Limits для Android; далі він оновлюється сам.

⏱ *Таймер відпочинку, що не збивається* — рахує далі, коли закриваєш застосунок, а виправлення вже зробленого підходу більше не запускає його спочатку.

🔔 *Одне «відпочинок завершено»* — відпочинок, запущений в Android-застосунку, дзвонить лише на телефоні, а не ще й у цьому чаті.

↕️ *Перестановка без стрибків* — коли переміщуєш чи видаляєш вправу, перед тобою лишається та, на якій ти зараз.

👟 *Кроки на Android* — коли Samsung Health не передає дані в Health Connect, застосунок рахує кроки датчиком телефона.

🔐 *Вхід для всіх* — увійти в застосунок через Telegram тепер можна з будь-якого акаунта.

📵 *Виправлено на iPhone* — білий екран на старіших iPhone зник.

💬 *Відповіді на відгуки* — коли надсилаєш відгук, відповідь приходить просто сюди, у бот.

🌍 *Повністю перекладено* — грами, кілограми, хвилини й дні більше не лишаються англійською.

Тисни *📱 Відкрити Hack Limits* нижче.`,
  },
];

export function latestRelease(): ReleaseNote {
  return RELEASE_NOTES[0];
}

/** The release-note body for a language, rendered to Telegram HTML. */
export function releaseBody(lang: Lang, note: ReleaseNote = latestRelease()): string {
  return mdToHtml(escapeHtml(lang === "en" ? note.en : note.uk));
}
