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
  {
    version: "2026-09-09",
    en: `🎉 *What's new in trix*

🏅 *Two new leaderboards* — 🧊 longest active streak and 🏆 most PRs this month, alongside the existing four.

🥊 *Buddy duels* — a running weekly win/loss tally against your accountability buddy, plus new badges for a first duel win and a 4-week win streak.

🎯 *More challenges* — 4 new goals to join, including an easy *2 workouts a week* for getting back into it, plus 2 new badges for winning a challenge.

🧹 *Tidier profile* — settings are now collapsible sections instead of one long wall of cards.

👆 *Snappier taps* — buttons give a little press feedback everywhere in the app now.

Tap *Menu → 📱 Dashboard*! 💪`,
    uk: `🎉 *Що нового в trix*

🏅 *Два нових лідерборди* — 🧊 найдовший активний streak і 🏆 найбільше рекордів за місяць, поруч із чотирма попередніми.

🥊 *Баддi-дуелі* — постійний тижневий рахунок перемог/поразок із твоїм напарником, а ще нові бейджі за першу перемогу в дуелі та серію з 4 перемог поспіль.

🎯 *Більше челленджів* — 4 нові цілі, серед них легкий *2 тренування на тиждень* для повернення в ритм, і 2 нових бейджі за перемогу в челленджі.

🧹 *Охайніший профіль* — налаштування тепер згортаються в секції замість суцільної стіни карток.

👆 *Чіткіші тапи* — кнопки тепер дають легкий відгук при натисканні по всьому застосунку.

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
