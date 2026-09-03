// Evening survey checklist + cardio quick-log flows, extracted from bot.ts. Imports flow
// entrypoints back from ../bot (same value-cycle pattern as bot/trainer.ts — all calls happen
// at request time, after both modules are initialized).
import { InlineKeyboard } from "grammy";
import { localParts, parseWorkoutText } from "../domain/progression";
import { CARDIO_TEMPLATES, cardioTemplateByKey, zoneBpm } from "../domain/cardioPlan";
import {
  getDailyCheckin,
  getStepLog,
  nutritionLogsSince,
  updateUser,
  waterLogsSince,
} from "../db/repos";
import { t } from "../locales/i18n";
import {
  cmdCheckin,
  cmdNutrition,
  cmdSteps,
  cmdWater,
  handleWorkoutLog,
  menuBtn,
  reply,
  type MyContext,
} from "../bot";
import type { Lang, UserDoc } from "../types";

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

// A survey button tapped — arm the checklist for today, then launch that item's normal flow.
// On completion the flow calls showEveningSurvey (via the session.survey flag) to continue.
export async function onSurveyItem(ctx: MyContext, item: string) {
  const { date } = localParts(ctx.user.profile.timezone);
  ctx.user.session = { ...ctx.user.session, survey: date };
  await updateUser(ctx.db, ctx.user._id, { session: ctx.user.session });
  if (item === "food") await cmdNutrition(ctx);
  else if (item === "water") await cmdWater(ctx);
  else if (item === "steps") await cmdSteps(ctx);
  else if (item === "checkin") await cmdCheckin(ctx);
  else await showEveningSurvey(ctx);
}

// ===================== Cardio quick log =====================

const CARDIO_TYPES: { key: string; en: string; uk: string }[] = [
  { key: "row", en: "Rowing", uk: "Веслування" },
  { key: "bike", en: "Cycling", uk: "Велотренажер" },
  { key: "run", en: "Running", uk: "Біг" },
  { key: "walk", en: "Walking", uk: "Ходьба" },
  { key: "swim", en: "Swimming", uk: "Плавання" },
  { key: "ellipt", en: "Elliptical", uk: "Еліптичний" },
  { key: "rope", en: "Jump rope", uk: "Скакалка" },
  { key: "other", en: "Other", uk: "Інше" },
];

const cardioName = (lang: Lang, key: string): string => {
  const c = CARDIO_TYPES.find((x) => x.key === key);
  return c ? (lang === "uk" ? c.uk : c.en) : "";
};

export async function showCardioMenu(ctx: MyContext) {
  const lang = ctx.user.lang;
  const kb = new InlineKeyboard();
  CARDIO_TYPES.forEach((c, i) => {
    kb.text(t(lang, `cardio_${c.key}` as Parameters<typeof t>[1]), `cardio:t:${c.key}`);
    if (i % 2 === 1) kb.row();
  });
  // Structured conditioning sessions (zones/intervals) live one tap away.
  kb.row().text(t(lang, "cardio_structured_btn"), "cardio:plans");
  await reply(ctx, t(lang, "cardio_pick"), kb);
}

// Structured cardio: list the interval/tempo/LISS templates.
export async function showCardioPlans(ctx: MyContext) {
  const lang = ctx.user.lang;
  const kb = new InlineKeyboard();
  CARDIO_TEMPLATES.forEach((tpl, i) => {
    kb.text(`${tpl.emoji} ${t(lang, `cardio_tpl_${tpl.key}` as Parameters<typeof t>[1])} · ${tpl.totalMin}′`, `cardio:p:${tpl.key}`);
    if (i % 2 === 1) kb.row();
  });
  kb.row().text(t(lang, "menu_open"), "menu:open");
  await reply(ctx, t(lang, "cardio_structured_intro"), kb);
}

// Render one template with the user's personal HR zones (from age), then drop into the free
// cardio logger so they can record the actual time/distance when done.
export async function showCardioSession(ctx: MyContext, key: string) {
  const lang = ctx.user.lang;
  const tpl = cardioTemplateByKey(key);
  if (!tpl) { await showCardioPlans(ctx); return; }
  const age = ctx.user.profile.age ?? 30;
  const lines = [`${tpl.emoji} <b>${t(lang, `cardio_tpl_${tpl.key}` as Parameters<typeof t>[1])}</b> · ~${tpl.totalMin}′`, ""];
  for (const st of tpl.steps) {
    const bpm = zoneBpm(age, st.zone);
    const rep = st.reps && st.reps > 1 ? `${st.reps}× ` : "";
    lines.push(`• ${rep}${st.minutes}′ ${t(lang, `cardio_step_${st.label}` as Parameters<typeof t>[1])} — Z${st.zone} (${bpm.lo}–${bpm.hi} ${t(lang, "cardio_bpm")})`);
  }
  lines.push("", t(lang, "cardio_zone_note"));
  ctx.user.session = { ...ctx.user.session, mode: "cardio_log", cardio: t(lang, `cardio_tpl_${tpl.key}` as Parameters<typeof t>[1]) };
  await updateUser(ctx.db, ctx.user._id, { session: ctx.user.session });
  await reply(ctx, lines.join("\n"));
}

export async function startCardioLog(ctx: MyContext, key: string) {
  const lang = ctx.user.lang;
  // "other" → no name prefix; the user types the full "name time/distance" line themselves.
  const name = key === "other" ? "" : cardioName(lang, key);
  ctx.user.session = { ...ctx.user.session, mode: "cardio_log", cardio: name };
  await updateUser(ctx.db, ctx.user._id, { session: ctx.user.session });
  const label = name || t(lang, "cardio_other");
  await reply(ctx, t(lang, "cardio_prompt", { type: label }));
}

// Text in cardio_log mode: prepend the chosen exercise name and reuse the free-text log path.
export async function handleCardioLog(ctx: MyContext, text: string) {
  const lang = ctx.user.lang;
  const name = ctx.user.session.cardio ?? "";
  const line = name ? `${name} ${text}` : text;
  // Must carry a time or distance — a bare weight×reps here is almost certainly a mistake.
  const parsed = parseWorkoutText(line);
  const hasCardio = parsed.some((s) => (s.seconds ?? 0) > 0 || (s.meters ?? 0) > 0);
  if (!parsed.length || !hasCardio) {
    await reply(ctx, t(lang, "cardio_unreadable"));
    return;
  }
  // handleWorkoutLog re-parses the same line and finalizes (records + XP + trainer notify);
  // its finalize path resets the session to idle, clearing the cardio field.
  await handleWorkoutLog(ctx, line);
}
