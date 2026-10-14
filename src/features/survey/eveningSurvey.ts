// The evening survey checklist (food / water / steps / check-in): what is still unlogged today,
// its keyboard, and re-showing it after each log. Shared by the nutrition flows and the 21:00 nudge.
import { InlineKeyboard } from "grammy";
import { localParts } from "../../domain/localTime";
import { getDailyCheckin, getStepLog, waterLogsSince } from "../../adapters/d1/v2Tracking";
import { updateUser } from "../../adapters/d1/v2Users";
import { nutritionLogsSince } from "../../adapters/d1/v2Nutrition";
import { t } from "../../locales/i18n";
import { reply, type MyContext } from "../../adapters/telegram/context";
import { menuBtn } from "../../adapters/telegram/keyboards";
import type { Lang, UserDoc } from "../../types";

// ===================== Evening survey checklist =====================
// One daily prompt (21:00, scheduler) that lists ALL applicable daily logs — food / water /
// steps / check-in — and, after each is logged, re-shows itself with the REMAINING items until
// the day is complete. `session.survey` holds the date it's active for (survives sub-flow
// setMode via switchMode); the four log flows call showEveningSurvey when that flag is set.
export interface SurveyItem { key: string; label: string; cb: string }

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

// Re-show the checklist with whatever's still unlogged today; when nothing's left, close it out.
// Called by the food/water/steps/check-in flows only while a survey is active for today.
export async function showEveningSurvey(ctx: MyContext) {
  const lang = ctx.user.lang;
  const { date } = localParts(ctx.user.profile.timezone);
  const clear = async () => {
    if (ctx.user.session.survey === undefined) return;
    const s = { ...ctx.user.session }; delete s.survey;
    ctx.user.session = s; await updateUser(ctx.db, ctx.user._id, { session: s });
  };
  // Stale flag from a previous day → silently drop it (a new day's survey re-arms via the cron).
  if (ctx.user.session.survey && ctx.user.session.survey !== date) { await clear(); return; }
  const items = await surveyRemaining(ctx.db, ctx.user, date, lang);
  if (!items.length) { await clear(); await reply(ctx, t(lang, "survey_done"), menuBtn(lang)); return; }
  if (ctx.user.session.survey !== date) {
    ctx.user.session = { ...ctx.user.session, survey: date };
    await updateUser(ctx.db, ctx.user._id, { session: ctx.user.session });
  }
  await reply(ctx, t(lang, "survey_prompt"), surveyKb(items));
}
