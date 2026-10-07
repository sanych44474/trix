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
];

export function latestRelease(): ReleaseNote {
  return RELEASE_NOTES[0];
}

/** The release-note body for a language, rendered to Telegram HTML. */
export function releaseBody(lang: Lang, note: ReleaseNote = latestRelease()): string {
  return mdToHtml(escapeHtml(lang === "en" ? note.en : note.uk));
}
