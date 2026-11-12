// The evening survey checklist (food / water / steps / check-in): what is still unlogged today,
// its keyboard, and re-showing it after each log. Shared by the nutrition flows and the 21:00 nudge.
import { InlineKeyboard } from "grammy";
import { getDailyCheckin, getStepLog, waterLogsSince } from "../../adapters/d1/v2Tracking";
import { nutritionLogsSince } from "../../adapters/d1/v2Nutrition";
import { t } from "../../locales/i18n";
import type { Lang, UserDoc } from "../../types";

// ===================== Evening survey checklist =====================
// One daily prompt (21:00, scheduler) that lists ALL applicable daily logs — food / water /
// steps / check-in — and, after each is logged, re-shows itself with the REMAINING items until
// the day is complete. `session.survey` holds the date it's active for (survives sub-flow
// setMode via switchMode); the four log flows call showEveningSurvey when that flag is set.
interface SurveyItem { key: string; label: string; cb: string }

export async function surveyRemaining(db: D1Database, user: UserDoc, date: string, lang: Lang): Promise<SurveyItem[]> {
  const off = (k: string) => user.profile.remindersOff?.includes(k) ?? false;
  // The four checks are independent reads — fire them in parallel (was 4 serial round-trips).
  const [n, w, step, checkin] = await Promise.all([
    off("nutrition") ? Promise.resolve([]) : nutritionLogsSince(db, user._id, date).catch(() => []),
    off("water") ? Promise.resolve([]) : waterLogsSince(db, user._id, date).catch(() => []),
    off("steps") ? Promise.resolve(null) : getStepLog(db, user._id, date).catch(() => null),
    off("checkin") ? Promise.resolve(null) : getDailyCheckin(db, user._id, date).catch(() => null),
  ]);
  const items: SurveyItem[] = [];
  if (!off("nutrition") && !n.length) items.push({ key: "food", label: t(lang, "survey_food"), cb: "sv:food" });
  if (!off("water") && (w.find((x) => x.date === date)?.ml ?? 0) <= 0) items.push({ key: "water", label: t(lang, "survey_water"), cb: "sv:water" });
  if (!off("steps") && !step) items.push({ key: "steps", label: t(lang, "survey_steps"), cb: "sv:steps" });
  if (!off("checkin") && !checkin) items.push({ key: "checkin", label: t(lang, "survey_checkin"), cb: "sv:checkin" });
  return items;
}

export function surveyKb(items: SurveyItem[]): InlineKeyboard {
  const kb = new InlineKeyboard();
  items.forEach((s, i) => { kb.text(s.label, s.cb); if (i % 2 === 1) kb.row(); });
  return kb;
}
