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
];

export function latestRelease(): ReleaseNote {
  return RELEASE_NOTES[0];
}

/** The release-note body for a language, rendered to Telegram HTML. */
export function releaseBody(lang: Lang, note: ReleaseNote = latestRelease()): string {
  return mdToHtml(escapeHtml(lang === "en" ? note.en : note.uk));
}
