// Evening survey checklist + cardio quick-log flows, extracted from bot.ts. Imports flow
// entrypoints back from ../bot (same value-cycle pattern as features/trainer/trainer.ts — all calls happen
// at request time, after both modules are initialized).
import { InlineKeyboard } from "grammy";
import { localParts } from "../domain/localTime";
import { parseWorkoutText } from "../domain/workoutText";
import { CARDIO_TEMPLATES, CARDIO_TYPES, cardioName, cardioTemplateByKey, zoneBpm } from "../domain/cardioPlan";
import { updateUser } from "../adapters/d1/v2Users";
import { t } from "../locales/i18n";
import { reply, type MyContext } from "../adapters/telegram/context";
import { cmdCheckin } from "./checkinCmds";
import { cmdNutrition, cmdSteps, cmdWater } from "./nutritionCmds";
import { handleWorkoutLog } from "./workoutSave";
import { showEveningSurvey } from "../features/survey/eveningSurvey";

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
