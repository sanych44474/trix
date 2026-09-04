// Workout-day calendar: month-grid keyboard (shared with cycle tracking's period-start picker)
// and the athlete's own calendar view (planned/done/skipped markers, tap a day for detail).
// Extracted from bot.ts (god-file split; same barrel seam via bot.ts's
// `export * from "./bot/calendar"`). The "Calendar & session booking" banner also held five
// unrelated settings handlers (handleBodyEdit, onSetHour, onSmartHour, onSetTz, onToggleDay) —
// none of them are calendar code, so they stayed in bot.ts.
import { InlineKeyboard } from "grammy";
import type { Lang, Weekday } from "../types";
import { getActivePlan, getWorkoutLog, workoutLogsSince } from "../db/repos";
import { dayMarker, monthGrid, monthTitle, nextMonth, prevMonth, ymOf } from "../domain/calendar";
import { getPlanDay, localParts } from "../domain/progression";
import { t } from "../locales/i18n";
import { type MyContext, clearEditOwner, reply } from "../bot";

export const WD_SHORT: Record<Lang, string[]> = {
  uk: ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Нд"],
  en: ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"],
};
export function weekdayOf(date: string): Weekday {
  return (((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7) + 1) as Weekday;
}
// Generic month-grid keyboard. `marker` labels each day; `dayCb`/`navCb` build callback data.
export function calendarKeyboard(
  lang: Lang,
  ym: string,
  marker: (date: string) => string,
  dayCb: (date: string) => string,
  navCb: (ym: string) => string,
): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const d of WD_SHORT[lang]) kb.text(d, "cal:noop");
  kb.row();
  for (const week of monthGrid(ym)) {
    for (const cell of week) kb.text(cell ? marker(cell) : " ", cell ? dayCb(cell) : "cal:noop");
    kb.row();
  }
  kb.text("◀️", navCb(prevMonth(ym))).text(monthTitle(ym, lang), "cal:noop").text("▶️", navCb(nextMonth(ym)));
  return kb;
}

// --- user (athlete) calendar ---

export async function userCalendarKb(ctx: MyContext, ym: string): Promise<InlineKeyboard> {
  const uid = ctx.user._id;
  const { date: today } = localParts(ctx.user.profile.timezone);
  const monthEnd = `${ym}-31`;
  const [plan, wlogs] = await Promise.all([
    getActivePlan(ctx.db, uid),
    workoutLogsSince(ctx.db, uid, `${ym}-01`),
  ]);
  const plannedWeekdays = new Set<number>((plan?.split ?? []).map((d) => d.weekday));
  const logs = new Map<string, { completed: boolean }>();
  for (const w of wlogs) if (w.date <= monthEnd) logs.set(w.date, { completed: w.completed });
  const ctxD = { today, plannedWeekdays, logs };
  return calendarKeyboard(ctx.user.lang, ym, (d) => dayMarker(d, ctxD), (d) => `cal:d:${d}`, (m) => `cal:nav:${m}`);
}

export async function cmdCalendar(ctx: MyContext) {
  await clearEditOwner(ctx);
  const { date } = localParts(ctx.user.profile.timezone);
  await reply(ctx, t(ctx.user.lang, "cal_today_hint"), await userCalendarKb(ctx, ymOf(date)));
}

export async function onCalNav(ctx: MyContext, ym: string) {
  await ctx.editMessageReplyMarkup({ reply_markup: await userCalendarKb(ctx, ym) }).catch(() => {});
}

export async function onCalDay(ctx: MyContext, date: string) {
  const lang = ctx.user.lang;
  const uid = ctx.user._id;
  const plan = await getActivePlan(ctx.db, uid);
  const day = plan ? getPlanDay(plan, weekdayOf(date)) : undefined;
  const log = await getWorkoutLog(ctx.db, uid, date);
  const lines = [t(lang, "cal_day_title", { date })];
  lines.push(day ? t(lang, "cal_day_planned", { group: day.muscleGroup, n: day.exercises.length }) : t(lang, "cal_day_rest"));
  if (log) lines.push(log.completed ? t(lang, "cal_day_done") : t(lang, "cal_day_skipped"));
  const kb = new InlineKeyboard().text(t(lang, "cal_back"), `cal:nav:${ymOf(date)}`);
  await reply(ctx, lines.join("\n"), kb);
}
