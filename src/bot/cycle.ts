// Menstrual-cycle tracking (opt-in, female profiles). The Coach and the plan don't force this
// — but if a user turns it on and logs a period start, the coach context includes the current
// phase so advice can adapt (deload around menstruation, heavier lifts late follicular, extra
// carbs in luteal, etc.). Nothing is inferred from age or silence: opt-in is explicit and
// reversible. Extracted from bot.ts (god-file split; same barrel seam via bot.ts's
// `export * from "./bot/cycle"`).
import { InlineKeyboard } from "grammy";
import { updateUser } from "../db/repos";
import { ymOf } from "../domain/calendar";
import { computeCyclePhase } from "../domain/cycle";
import { localParts } from "../domain/progression";
import { t } from "../locales/i18n";
import { type MyContext, calendarKeyboard, reply } from "../bot";

export async function showCycleSettings(ctx: MyContext) {
  const lang = ctx.user.lang;
  if (ctx.user.profile.sex !== "female") { await reply(ctx, t(lang, "cycle_female_only")); return; }
  const p = ctx.user.profile;
  const { date } = localParts(p.timezone);
  const info = computeCyclePhase(p, date);
  const on = !!p.cycleTracking;
  const cycleLen = p.cycleLengthDays ?? 28;
  let body = t(lang, "cycle_title") + "\n\n";
  if (!on) {
    body += t(lang, "cycle_off_hint");
  } else if (!p.lastPeriodStart) {
    body += t(lang, "cycle_no_date");
  } else if (info) {
    const label = t(lang, `cycle_phase_${info.phase}` as Parameters<typeof t>[1]);
    body += t(lang, "cycle_now", { phase: label, day: info.day, len: info.cycleLength, start: p.lastPeriodStart });
  }
  const kb = new InlineKeyboard()
    .text(t(lang, on ? "cycle_disable_btn" : "cycle_enable_btn"), "cycle:toggle");
  if (on) {
    kb.row().text(t(lang, "cycle_log_start_btn"), "cycle:logstart");
    kb.text(t(lang, "cycle_length_btn", { len: cycleLen }), "cycle:len");
  }
  kb.row().text(t(lang, "back"), "menu:settings");
  await reply(ctx, body, kb);
}

export async function toggleCycleTracking(ctx: MyContext) {
  if (ctx.user.profile.sex !== "female") return;
  const next = !ctx.user.profile.cycleTracking;
  const profile = { ...ctx.user.profile, cycleTracking: next };
  await updateUser(ctx.db, ctx.user._id, { profile });
  ctx.user.profile = profile;
  // Turning tracking ON immediately asks for the anchor date — a calendar, not "today only",
  // because the period usually started a few days before the user reaches this screen.
  if (next) await showCycleCalendar(ctx);
  else await showCycleSettings(ctx);
}

// Month calendar for picking the last-period start date (future days are inert dots).
function cycleCalendarKb(ctx: MyContext, ym: string): InlineKeyboard {
  const p = ctx.user.profile;
  const { date: today } = localParts(p.timezone);
  const kb = calendarKeyboard(
    ctx.user.lang,
    ym,
    (d) => (d === p.lastPeriodStart ? `[${Number(d.slice(8))}]` : d > today ? "·" : String(Number(d.slice(8)))),
    (d) => `cyd:pick:${d}`,
    (m) => `cyd:m:${m}`,
  );
  kb.row().text(t(ctx.user.lang, "back"), "set:cycle");
  return kb;
}

export async function showCycleCalendar(ctx: MyContext) {
  if (ctx.user.profile.sex !== "female" || !ctx.user.profile.cycleTracking) {
    await showCycleSettings(ctx);
    return;
  }
  const { date } = localParts(ctx.user.profile.timezone);
  await reply(ctx, t(ctx.user.lang, "cycle_pick_date"), cycleCalendarKb(ctx, ymOf(date)));
}

export async function onCycleCalNav(ctx: MyContext, ym: string) {
  if (ctx.user.profile.sex !== "female" || !ctx.user.profile.cycleTracking) return;
  await ctx.editMessageReplyMarkup({ reply_markup: cycleCalendarKb(ctx, ym) }).catch(() => {});
}

// A calendar day was tapped — anchor the cycle there. Future dates are ignored (inert dots).
export async function pickCycleDate(ctx: MyContext, iso: string) {
  const lang = ctx.user.lang;
  const p = ctx.user.profile;
  if (p.sex !== "female" || !p.cycleTracking) return;
  const { date: today } = localParts(p.timezone);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso) || iso > today) return;
  const profile = { ...p, lastPeriodStart: iso };
  await updateUser(ctx.db, ctx.user._id, { profile });
  ctx.user.profile = profile;
  await reply(ctx, t(lang, "cycle_logged", { date: iso }));
  await showCycleSettings(ctx);
}

// Cycle length picker — 4 common presets keeps the flow tap-only. Anything unusual can be set
// via /coach or by editing the profile with a trainer.
export async function pickCycleLength(ctx: MyContext) {
  const lang = ctx.user.lang;
  const kb = new InlineKeyboard();
  for (const len of [24, 26, 28, 30, 32]) kb.text(`${len}`, `cycle:setlen:${len}`);
  kb.row().text(t(lang, "back"), "set:cycle");
  await reply(ctx, t(lang, "cycle_length_prompt"), kb);
}

export async function setCycleLength(ctx: MyContext, len: number) {
  if (ctx.user.profile.sex !== "female") return;
  const clamped = Math.max(20, Math.min(45, Math.round(len)));
  const profile = { ...ctx.user.profile, cycleLengthDays: clamped };
  await updateUser(ctx.db, ctx.user._id, { profile });
  ctx.user.profile = profile;
  await showCycleSettings(ctx);
}
