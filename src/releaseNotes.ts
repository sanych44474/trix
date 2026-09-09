import type { Lang } from "./types";
import { escapeHtml, mdToHtml } from "./locales/i18n";

// Versioned, bilingual release notes — the last 2 only. Newest first. Bodies use the same
// *bold*/_italic_ markers as the locale catalog; keep them author-controlled (no raw <, >, & —
// they're HTML-escaped first). The owner broadcasts the latest entry to every user (each in
// their own language) with a confirm gate. Older history lives in GitHub Releases, not in the
// Worker bundle — /whatsnew only ever needs the current and previous version.
export interface ReleaseNote {
  version: string; // YYYY-MM-DD (also the display tag)
  en: string;
  uk: string;
}

export const RELEASE_NOTES: ReleaseNote[] = [
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
];

export function latestRelease(): ReleaseNote {
  return RELEASE_NOTES[0];
}

/** The release-note body for a language, rendered to Telegram HTML. */
export function releaseBody(lang: Lang, note: ReleaseNote = latestRelease()): string {
  return mdToHtml(escapeHtml(lang === "en" ? note.en : note.uk));
}
