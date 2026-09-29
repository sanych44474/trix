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
    version: "2026-09-29",
    en: `🎉 *What's new in trix*

📚 *Exercise library* — 750 exercises with start and finish pictures, in Ukrainian and English: filter by muscle and equipment, search by name, add any to a plan day in one tap.

🖼 *Sunday report with a picture* — your week on a body map, a balance score out of 100, what lagged, records and one focus for next week.

🎯 *Weekly quests* — three small goals each week picked from your own training (workouts, the muscle that lagged, one habit), +50 XP each.

⚖️ *This week on Today* — the balance score so far and your run of balanced weeks.

🗓 *Seasonal challenge* — a new challenge every month with its own badges; join with one tap.

🏅 *New badges* — for a full-body week, every key muscle at its minimum, 4 balanced weeks in a row, a form check, all quests of a week and seasons won. New ones pop up the next time you open the app.

Tap *Menu → 📱 Dashboard*! 💪`,
    uk: `🎉 *Що нового в trix*

📚 *Бібліотека вправ* — 750 вправ із фото початку й кінця руху, українською та англійською: фільтр за м'язом і обладнанням, пошук за назвою, додавання в день плану одним дотиком.

🖼 *Недільний звіт з картинкою* — твій тиждень на карті тіла, оцінка балансу зі 100, що відстало, рекорди й один фокус на наступний тиждень.

🎯 *Квести тижня* — три невеликі цілі щотижня з твоїх же тренувань (тренування, відсталий м'яз, одна звичка), +50 XP за кожну.

⚖️ *Цей тиждень на головній* — баланс тижня і серія збалансованих тижнів.

🗓 *Сезонний челендж* — щомісяця новий челендж зі своїми бейджами; приєднатися — одним дотиком.

🏅 *Нові бейджі* — за тиждень на все тіло, мінімум для кожного ключового м'яза, 4 збалансовані тижні поспіль, перевірку техніки, усі квести тижня та виграні сезони. Нові з'являються при наступному відкритті застосунку.

Тисни *Меню → 📱 Дашборд*! 💪`,
  },
  {
    version: "2026-09-28",
    en: `🎉 *What's new in trix*

🫀 *Body map* — an anatomical figure (front and back) on the Progress screen: your week muscle by muscle, a *recovery map* (🔴 still recovering, 🟡 almost, 🟢 ready), any plan day or single exercise lit up, and a *12-week trend* for each muscle. Share it to your story in one tap.

⚖️ *Balanced plans* — new AI plans check themselves: if the back, hamstrings or any key muscle is missing or far behind, the right exercise is added before you ever see the plan. Existing plans get a "worth adding" card with a one-tap fix.

🔋 *Recovery-aware days* — if today's muscles are still tired from the last session, trix offers to swap today with a later day whose muscles are ready.

📸 *Technique pictures* — the start and finish position of each exercise, with 3–5 short steps, right in the logger.

🎥 *Form check* — send a short video of a set in the chat and get 2–3 concrete technique cues.

🏃 *Strava import* — runs, rides and swims land in your log by themselves.

💾 *Reliable logging* — the save button is always in view, drafts sync between devices, and the real session length is recorded.

Tap *Menu → 📱 Dashboard*! 💪`,
    uk: `🎉 *Що нового в trix*

🫀 *Карта тіла* — анатомічна фігура (спереду і ззаду) на екрані прогресу: твій тиждень по кожному м'язу, *карта відновлення* (🔴 ще відновлюються, 🟡 майже, 🟢 готові), підсвітка будь-якого дня плану чи окремої вправи і *тренд за 12 тижнів* для кожного м'яза. Можна поділитися в сторіс одним тапом.

⚖️ *Збалансовані плани* — нові AI-плани перевіряють себе самі: якщо бракує спини, біцепса стегна чи іншого ключового м'яза, потрібна вправа додається ще до того, як ти побачиш план. Для наявних планів — картка «Варто додати» з виправленням в один тап.

🔋 *Дні з урахуванням відновлення* — якщо сьогоднішні м'язи ще втомлені після минулого тренування, trix запропонує поміняти день із пізнішим, де м'язи вже готові.

📸 *Фото техніки* — початок і кінець руху для кожної вправи та 3–5 коротких кроків прямо в логері.

🎥 *Перевірка техніки* — надішли в чат коротке відео підходу й отримай 2–3 конкретні підказки.

🏃 *Імпорт зі Strava* — біг, велосипед і плавання потрапляють у журнал самі.

💾 *Надійний запис* — кнопка збереження завжди на екрані, чернетки синхронізуються між пристроями, а тривалість тренування записується точно.

Тисни *Меню → 📱 Дашборд*! 💪`,
  },

];

export function latestRelease(): ReleaseNote {
  return RELEASE_NOTES[0];
}

/** The release-note body for a language, rendered to Telegram HTML. */
export function releaseBody(lang: Lang, note: ReleaseNote = latestRelease()): string {
  return mdToHtml(escapeHtml(lang === "en" ? note.en : note.uk));
}
