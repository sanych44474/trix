// Smart reminder timing: when workouts are consistently logged at another hour than the reminder
// assumes, offer to move it (Mondays, at most every 30 days). Called by processUser.
import { InlineKeyboard } from "grammy";
import { workoutLogsSince } from "../adapters/d1/v2Workouts";
import { localParts } from "../domain/progression";
import { suggestReminderHour } from "../domain/reminderTiming";
import { t } from "../locales/i18n";
import { HTML, isoDaysAgo } from "./shared";
import type { UserPass } from "./userPass";

export async function smartReminderHour(p: UserPass): Promise<boolean> {
  const { user, db, lang, tz, reminderHour, sendAndMark } = p;
  let claimed = false;
  const recentLogs = (await workoutLogsSince(db, user._id, isoDaysAgo(45))).filter((l) => l.completed);
  const hours = recentLogs.map((l) => localParts(tz, l.createdAt).hour);
  const suggested = suggestReminderHour(hours, reminderHour);
  if (suggested !== null) {
    const kb = new InlineKeyboard()
      .text(t(lang, "smart_hour_yes", { h: suggested }), `shour:yes:${suggested}`)
      .text(t(lang, "smart_hour_no"), "shour:no");
    // Cooldown runs from the offer, whatever the answer — but only once the offer actually
    // got out, or a dropped send costs the user this prompt for another 30 days.
    await sendAndMark("smart_hour", t(lang, "smart_hour_offer", { habit: suggested + 1, cur: reminderHour, new: suggested }), {
      ...HTML,
      reply_markup: kb,
    });
    claimed = true; // this tick's one user-facing message
  }
  return claimed;
}
