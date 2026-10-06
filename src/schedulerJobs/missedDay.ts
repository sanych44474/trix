// Smart reschedule: the day after a single missed planned session, offer to move it. Called by
// processUser.
import { InlineKeyboard } from "grammy";
import type { Weekday } from "../types";
import { workoutLogsSince } from "../adapters/d1/v2Workouts";
import { dailyCheckinsSince } from "../adapters/d1/v2Tracking";
import { deloadSets, poorWellbeing } from "../domain/deload";
import { getPlanDay } from "../domain/progression";
import { recentConditioningStrain } from "../domain/conditioning";
import { isoWeekday, lastPlannedDates } from "../domain/atrisk";
import { rankMissedDayOptions, recentMissRate } from "../domain/missedDay";
import { escapeHtml, t } from "../locales/i18n";
import { HTML, isoDaysAgo } from "./shared";
import type { UserPass } from "./userPass";

export async function missedDay(p: UserPass): Promise<boolean> {
  const { user, db, lang, date, activePlan, markSent, send } = p;
  let claimed = false;
  const plan = activePlan;
  if (plan && plan.split.length) {
    const planWeekdays = plan.split.map((d) => d.weekday);
    const notBefore = plan.generatedAt.toISOString().slice(0, 10);
    const lastPlanned = lastPlannedDates(planWeekdays, date, 1, notBefore)[0];
    if (lastPlanned) {
      // workouts21() (the memoized per-invocation closure) isn't defined until later in this
      // function -- a direct read here, not the shared cache, since this block only ever runs
      // once (gated by already("missed_day")).
      const logs21 = await workoutLogsSince(db, user._id, isoDaysAgo(21));
      const completedDates = new Set(logs21.filter((l) => l.completed).map((l) => l.date));
      if (!completedDates.has(lastPlanned)) {
        markSent("missed_day");
        const recentPlanned = lastPlannedDates(planWeekdays, date, 5, notBefore);
        const missRate = recentMissRate(recentPlanned, completedDates);
        const checkins = await dailyCheckinsSince(db, user._id, isoDaysAgo(7)).catch(() => []);
        const strained = recentConditioningStrain(logs21, date, 2);
        const ranked = rankMissedDayOptions({ recentMissRate: missRate, poorRecovery: poorWellbeing(checkins) || strained });
        const lead = ranked[0];
        const kb = new InlineKeyboard();
        let body = t(lang, "missed_day_header", { date: lastPlanned });
        if (lead === "deload") {
          body += "\n\n" + t(lang, "missed_day_deload");
          kb.text(t(lang, "menu_coach"), "menu:coach");
        } else if (lead === "shorten") {
          const missedDay = getPlanDay(plan, isoWeekday(lastPlanned) as Weekday);
          const preview = (missedDay?.exercises ?? [])
            .slice(0, 6)
            .map((e) => `${escapeHtml(e.name)}: ${escapeHtml(deloadSets(e.sets))}`)
            .join("\n");
          body += "\n\n" + t(lang, "missed_day_shorten") + (preview ? `\n${preview}` : "");
          kb.text(t(lang, "log_done_btn"), "log:done");
        } else {
          body += "\n\n" + t(lang, "missed_day_makeup");
          kb.text(t(lang, "log_done_btn"), "log:done");
        }
        await send(body, { ...HTML, reply_markup: kb });
        claimed = true; // this tick's one user-facing message
      }
    }
  }
  return claimed;
}
