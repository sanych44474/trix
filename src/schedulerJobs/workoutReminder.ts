// The workout reminder on a training day not yet logged, at the person's reminder hour. Called
// by processUser.
import { InlineKeyboard } from "grammy";
import { workoutLogsSince } from "../adapters/d1/v2Workouts";
import { updateUser } from "../adapters/d1/v2Users";
import { getPlanDay } from "../domain/progression";
import { t } from "../locales/i18n";
import { renderDay } from "../render";
import { HTML } from "./shared";
import type { UserPass } from "./userPass";

export async function workoutReminder(p: UserPass): Promise<boolean> {
  const { user, db, lang, date, weekday, activePlan, loggedToday, sent, sendAndMark, appView } = p;
  let claimed = false;
  const plan = activePlan;
  const day = plan ? getPlanDay(plan, weekday) : undefined;
  if (day && !loggedToday) {
    // Adaptive TONE (never frequency — cutting touchpoints is exactly wrong when someone's
    // lapsing). If the previous workout reminder went unanswered (nothing completed since),
    // extend the streak; a completed workout since then resets it. After 3 in a row, switch to
    // a softer, no-pressure variant instead of repeating the identical nag indefinitely.
    const prevSent = sent["workout"];
    let ignoredStreak = user.reminders?.workoutIgnoredStreak ?? 0;
    if (prevSent && prevSent !== date) {
      const sinceLogs = await workoutLogsSince(db, user._id, prevSent).catch(() => []);
      const actedOn = sinceLogs.some((l) => l.completed);
      ignoredStreak = actedOn ? 0 : ignoredStreak + 1;
      if (ignoredStreak !== (user.reminders?.workoutIgnoredStreak ?? 0)) {
        // Mutate the in-memory object (not just the DB row) — flushReminders() below rebuilds
        // `reminders` from this same object at the end of processUser, and would otherwise
        // clobber this write back to its stale value (same pattern as `lastRank` further down).
        user.reminders = { ...user.reminders, workoutIgnoredStreak: ignoredStreak };
        await updateUser(db, user._id, { reminders: user.reminders }).catch(() => {});
      }
    }
    const wd = weekday;
    const kb = new InlineKeyboard()
      .text(t(lang, "log_done"), "log:done")
      .text(t(lang, "log_skip"), "log:skip")
      .row()
      .text(t(lang, "swap_btn"), `swap:${wd}`).row()
      .text(t(lang, "plan_diff_edit_weight"), `wt:open:${wd}`);
    const logUrl = appView("log");
    if (logUrl) kb.row().webApp(t(lang, "app_log_btn"), logUrl);
    const reminderKey = ignoredStreak >= 3 ? "reminder_workout_soft" : "reminder_workout";
    const text =
      t(lang, reminderKey, { group: day.muscleGroup }) + "\n\n" + renderDay(lang, day, undefined, "none");
    await sendAndMark("workout", text, { ...HTML, reply_markup: kb });
    claimed = true; // this tick's one user-facing message
  }
  return claimed;
}
