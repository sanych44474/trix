// Vacation / pause mode and the comeback interview that follows it — extracted from bot.ts
// (god-file split; same barrel seam via bot.ts's `export * from "./bot/vacation"`).
import { InlineKeyboard } from "grammy";
import { clearVacation, setVacation, updateUser } from "../db/repos";
import { t } from "../locales/i18n";
import { generateClientDraft, generatePlan } from "./plan";
import { type MyContext, type TKey, menuBtn, reply, setMode } from "../bot";

export async function cmdVacation(ctx: MyContext) {
  const lang = ctx.user.lang;
  if (ctx.user.vacationUntil && ctx.user.vacationUntil > new Date()) {
    const kb = new InlineKeyboard().text(t(lang, "vacation_end_btn"), "vac:end");
    await reply(ctx, t(lang, "vacation_on", { date: ctx.user.vacationUntil.toISOString().slice(0, 10) }), kb);
    return;
  }
  const kb = new InlineKeyboard()
    .text(t(lang, "vac_1w"), "vac:set:7")
    .text(t(lang, "vac_2w"), "vac:set:14")
    .row()
    .text(t(lang, "vac_4w"), "vac:set:28")
    .text(t(lang, "vac_custom"), "vac:custom");
  await reply(ctx, t(lang, "vacation_pick_duration"), kb);
}

export async function setVacationDays(ctx: MyContext, days: number) {
  const lang = ctx.user.lang;
  const until = new Date(Date.now() + days * 86_400_000);
  await setVacation(ctx.db, ctx.user._id, until.toISOString());
  ctx.user.vacationUntil = until;
  await rememberVacationWindow(ctx, until);
  await setMode(ctx, "idle");
  await reply(ctx, t(lang, "vacation_set", { date: until.toISOString().slice(0, 10) }), menuBtn(lang));
}

// Persist the vacation window so the week streak treats those weeks as FROZEN (an agreed
// pause must not break a streak) — used by /records, the week card and the weekly nudge.
async function rememberVacationWindow(ctx: MyContext, until: Date) {
  const reminders = {
    ...ctx.user.reminders,
    lastVacation: { from: new Date().toISOString().slice(0, 10), until: until.toISOString().slice(0, 10) },
  };
  await updateUser(ctx.db, ctx.user._id, { reminders });
  ctx.user.reminders = reminders;
}

export async function handleVacationCustom(ctx: MyContext, text: string) {
  const lang = ctx.user.lang;
  const m = /(\d{4}-\d{2}-\d{2})/.exec(text.trim());
  const until = m ? new Date(`${m[1]}T00:00:00Z`) : null;
  if (!until || Number.isNaN(until.getTime()) || until <= new Date()) {
    await reply(ctx, t(lang, "vacation_custom_prompt"));
    return;
  }
  await setVacation(ctx.db, ctx.user._id, until.toISOString());
  ctx.user.vacationUntil = until;
  await rememberVacationWindow(ctx, until);
  await setMode(ctx, "idle");
  await reply(ctx, t(lang, "vacation_set", { date: until.toISOString().slice(0, 10) }), menuBtn(lang));
}

export async function endVacation(ctx: MyContext) {
  await clearVacation(ctx.db, ctx.user._id);
  ctx.user.vacationUntil = undefined;
  await startComeback(ctx);
}

// ---------- comeback interview (after vacation) ----------

interface ComebackStep { key: string; q: TKey; kind: "text" | "buttons"; buttons?: { label: TKey; value: string }[] }
export function comebackSteps(): ComebackStep[] {
  return [
    { key: "feel", q: "comeback_q_feel", kind: "text" },
    { key: "goals", q: "comeback_q_goals", kind: "buttons", buttons: [
      { label: "comeback_goals_same", value: "same" }, { label: "comeback_goals_changed", value: "changed" }] },
    { key: "weight", q: "comeback_q_weight", kind: "buttons", buttons: [
      { label: "comeback_wt_up", value: "up" }, { label: "comeback_wt_same", value: "same" }, { label: "comeback_wt_down", value: "down" }] },
    { key: "changed", q: "comeback_q_changed", kind: "buttons", buttons: [
      { label: "comeback_yes", value: "yes" }, { label: "comeback_no", value: "no" }] },
    { key: "decision", q: "comeback_q_decision", kind: "buttons", buttons: [
      { label: "comeback_keep", value: "keep" }, { label: "comeback_adjust", value: "adjust" }, { label: "comeback_recreate", value: "recreate" }] },
  ];
}

export async function startComeback(ctx: MyContext) {
  ctx.user.session = { mode: "comeback", comeback: { step: 0, answers: {} } };
  await updateUser(ctx.db, ctx.user._id, { session: ctx.user.session });
  await renderComebackStep(ctx, 0);
}

export async function renderComebackStep(ctx: MyContext, i: number) {
  const lang = ctx.user.lang;
  const steps = comebackSteps();
  const step = steps[i];
  if (!step) { await finishComeback(ctx); return; }
  let kb: InlineKeyboard | undefined;
  if (step.kind === "buttons" && step.buttons) {
    kb = new InlineKeyboard();
    step.buttons.forEach((b, idx) => { kb!.text(t(lang, b.label), `cmb:${step.key}:${b.value}`); if ((idx + 1) % 2 === 0) kb!.row(); });
  }
  // Match the (N/M) progress convention used by renderObStep so the user always knows how much is left.
  const progress = `(${i + 1}/${steps.length})`;
  await reply(ctx, `${progress} ${t(lang, step.q)}`, kb);
}

export async function comebackButton(ctx: MyContext, data: string) {
  if (ctx.user.session.mode !== "comeback") return;
  const [, key, value] = data.split(":");
  const cb = ctx.user.session.comeback ?? { step: 0, answers: {} };
  const step = comebackSteps()[cb.step];
  if (!step || step.key !== key) { await renderComebackStep(ctx, cb.step); return; }
  cb.answers[key] = value;
  cb.step += 1;
  ctx.user.session = { ...ctx.user.session, comeback: cb };
  await updateUser(ctx.db, ctx.user._id, { session: ctx.user.session });
  await renderComebackStep(ctx, cb.step);
}

export async function handleComebackText(ctx: MyContext, text: string) {
  const cb = ctx.user.session.comeback ?? { step: 0, answers: {} };
  const step = comebackSteps()[cb.step];
  if (!step) { await finishComeback(ctx); return; }
  if (step.kind !== "text") { await renderComebackStep(ctx, cb.step); return; }
  cb.answers[step.key] = text.trim().slice(0, 300);
  cb.step += 1;
  ctx.user.session = { ...ctx.user.session, comeback: cb };
  await updateUser(ctx.db, ctx.user._id, { session: ctx.user.session });
  await renderComebackStep(ctx, cb.step);
}

export async function finishComeback(ctx: MyContext) {
  const lang = ctx.user.lang;
  const decision = ctx.user.session.comeback?.answers.decision ?? "keep";
  if (decision === "recreate") {
    ctx.user.session = { mode: "plan_pending" };
    await updateUser(ctx.db, ctx.user._id, { session: ctx.user.session });
    await reply(ctx, t(lang, "comeback_done_recreate"));
    if (ctx.user.role === "client" && ctx.user.trainerId) await generateClientDraft(ctx, ctx.user.profile);
    else await generatePlan(ctx, ctx.user.profile);
    return;
  }
  if (decision === "adjust") {
    // Reuse the existing adaptive micro-adjustment flow — the user's next message drives it.
    ctx.user.session = { mode: "checkin_adaptive" };
    await updateUser(ctx.db, ctx.user._id, { session: ctx.user.session });
    await reply(ctx, t(lang, "comeback_done_adjust"));
    return;
  }
  ctx.user.session = { mode: "idle" };
  await updateUser(ctx.db, ctx.user._id, { session: ctx.user.session });
  await reply(ctx, t(lang, "comeback_done_keep"), menuBtn(lang));
}
