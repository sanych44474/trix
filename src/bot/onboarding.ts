// Onboarding wizard: deterministic steps (buttons + minimal typed numbers/text), extracted
// from bot.ts. No per-turn AI — instant, no hangs, no parse ambiguity. The one AI call is the
// final plan gen, which stays in bot.ts (generatePlan / generateClientDraft — imported back,
// same value-cycle pattern as features/trainer/trainer.ts; calls happen at request time only).
import { pingOther } from "../notify";
import { onboardingAppMarkup, onboardingUrlFromEnv } from "../notify/onboardingApp";
import { InlineKeyboard } from "grammy";
import { logInfo } from "../log";
import { parseHeightWeight } from "../domain/workoutText";
import { AGE_RANGE } from "../domain/onboardingQuestions";
import { listIncompleteOnboarding, updateUser } from "../adapters/d1/v2Users";
import { FUNNEL_FINISHED, FUNNEL_STARTED, bumpEvent } from "../adapters/d1/v2Analytics";
import { localParts } from "../domain/localTime";
import { escapeHtml, t } from "../locales/i18n";
import { reply, type MyContext } from "../adapters/telegram/context";
import { generateClientDraft, generatePlan } from "./plan";
import type { Env, UserProfile, Weekday } from "../types";
import { obKeyboard, obProgress, obSteps, type ObStep } from "../features/onboarding/questions";
import { renderObQuestion } from "../features/onboarding/sendStep";


export async function renderObStep(ctx: MyContext, i: number) {
  if (!(await renderObQuestion(ctx, i))) await finishOnboarding(ctx);
}


// One-off "finish your interview" ping to every non-onboarded reachable user (owner-triggered,
// ctx-free). Resumes at the right place: AI-interview users get their last question re-sent;
// button-wizard users get their current step WITH its keyboard (so they can just tap).
export async function pingIncompleteOnboarding(env: Env, db: D1Database): Promise<{ pinged: number; total: number }> {
  const users = await listIncompleteOnboarding(db);
  let pinged = 0;
  for (const u of users) {
    try {
      const prefix = t(u.lang, "ob_resume_nudge");
      const transcript = u.session?.transcript;
      let text: string;
      let reply_markup: InlineKeyboard | ReturnType<typeof onboardingAppMarkup> | undefined;
      const appUrl = onboardingUrlFromEnv(env);
      if (appUrl) {
        // The questionnaire lives in the Mini App: one button, it resumes from the saved draft.
        text = `${prefix}\n\n${t(u.lang, "ob_app_prompt")}`;
        reply_markup = onboardingAppMarkup(u.lang, appUrl);
        await updateUser(db, u._id, { session: { mode: "onboarding", step: 0 } });
      } else if (u.session?.mode === "onboarding" && transcript?.length) {
        const lastQ = [...transcript].reverse().find((m) => m.role === "assistant");
        text = `${prefix}\n\n${escapeHtml(lastQ?.text ?? "")}`.trim();
        // Keep them in the interview so their reply advances it (mode may have drifted).
        await updateUser(db, u._id, { session: { mode: "onboarding", transcript } });
      } else {
        const steps = obSteps(u.lang);
        const raw = u.session?.mode === "onboarding" && typeof u.session.step === "number" ? u.session.step : obProgress(u.profile).next;
        const idx = Math.max(0, Math.min(raw, steps.length - 1));
        const step = steps[idx];
        text = `${prefix}\n\n(${idx + 1}/${steps.length}) ${t(u.lang, step.q)}`;
        reply_markup = obKeyboard(u.lang, step, u.profile.trainingWeekdays ?? [], idx > 0);
        // CRITICAL: put the session back into the wizard at this step, or their typed answer
        // routes to whatever stale mode they were in (e.g. msg_trainer) and never onboards.
        await updateUser(db, u._id, { session: { mode: "onboarding", step: idx } });
      }
      if (await pingOther(env, u.chatId, text, reply_markup)) pinged++;
    } catch (err) {
      console.error("pingIncompleteOnboarding", u._id, err);
    }
  }
  return { pinged, total: users.length };
}

// Funnel steps are plain per-day counters in v2_analytics_events (distinct accounts = users reached).
const funnel = (ctx: MyContext, event: string) =>
  bumpEvent(ctx.db, ctx.user._id, event, localParts(ctx.user.profile.timezone).date).catch(() => {});

// Save a value to the profile, advance the wizard, render the next step (or finish).
async function obApplyAndAdvance(ctx: MyContext, step: ObStep, raw: string | number) {
  // The first answer is the funnel's "started". Typed and tapped answers both land here; the first
  // step is a button, so counting only typed text (as before) almost never fired. Going back to
  // step 0 and answering again counts again -- the funnel reads distinct accounts, so that's harmless.
  if ((ctx.user.session.step ?? 0) === 0) {
    logInfo("onboarding_started", { role: ctx.user.role });
    ctx.waitUntil(funnel(ctx, FUNNEL_STARTED));
  }
  const profile = { ...ctx.user.profile };
  if (step.field === "daysPerWeek") profile.daysPerWeek = Number(raw);
  else if (step.field === "age") profile.age = Number(raw);
  else if (step.field === "sex") profile.sex = raw === "female" ? "female" : "male";
  else if (step.field === "level") {
    profile.level = raw as UserProfile["level"];
    // A beginner has no working weights to tell: skip that question (they pick weights by feel in
    // the first session — domain/startWeights.ts), but keep any numbers already given.
    if (profile.level === "beginner" && profile.baselineLifts === undefined) profile.baselineLifts = "none";
  }
  else if (step.field === "lifestyle") profile.lifestyle = raw as UserProfile["lifestyle"];
  else if (step.field === "sleepSchedule") profile.sleepSchedule = raw as UserProfile["sleepSchedule"];
  else if (step.field === "goal") profile.goal = String(raw);
  else if (step.field === "equipment") profile.equipment = String(raw);
  else if (step.field === "dietPrefs") profile.dietPrefs = String(raw);
  else if (step.field === "limitations") profile.limitations = String(raw);
  else if (step.field === "baselineLifts") profile.baselineLifts = String(raw);
  else if (step.field === "sessionMinutes") profile.sessionMinutes = Number(raw);
  let next = (ctx.user.session.step ?? 0) + 1;
  if (step.field === "level" && profile.level === "beginner" && obSteps(ctx.user.lang)[next]?.field === "baselineLifts") next++;
  ctx.user.profile = profile;
  ctx.user.session = { ...ctx.user.session, step: next, awaitText: undefined };
  await updateUser(ctx.db, ctx.user._id, { profile, session: ctx.user.session });
  await renderObStep(ctx, next);
}

// Button taps during the wizard: ob:v:<idx> | ob:wd:<n> | ob:wddone | ob:none
export async function onboardingButton(ctx: MyContext, payload: string) {
  const lang = ctx.user.lang;
  const i = ctx.user.session.step ?? 0;
  const steps = obSteps(lang);
  const step = steps[i];
  if (!step) return finishOnboarding(ctx);

  if (payload === "back") {
    const prev = Math.max(0, i - 1);
    ctx.user.session = { ...ctx.user.session, step: prev, awaitText: undefined };
    await updateUser(ctx.db, ctx.user._id, { session: ctx.user.session });
    await renderObStep(ctx, prev);
    return;
  }
  if (payload.startsWith("wd:") && step.multiselect) {
    const d = Number(payload.slice(3)) as Weekday;
    const cur = new Set(ctx.user.profile.trainingWeekdays ?? []);
    cur.has(d) ? cur.delete(d) : cur.add(d);
    const days = [...cur].sort((a, b) => a - b) as Weekday[];
    ctx.user.profile = { ...ctx.user.profile, trainingWeekdays: days };
    await updateUser(ctx.db, ctx.user._id, { profile: ctx.user.profile });
    // Edit the SAME message's keyboard in place (don't spawn a new message per tap).
    await ctx.editMessageReplyMarkup({ reply_markup: obKeyboard(lang, step, days) }).catch(() => {});
    return;
  }
  if (payload === "wddone" && step.multiselect) {
    const days = ctx.user.profile.trainingWeekdays ?? [];
    if (!days.length) {
      await reply(ctx, t(lang, "ob_pick_one_day"));
      return;
    }
    // Derive daysPerWeek from the picked days so the count always matches the plan.
    ctx.user.profile = { ...ctx.user.profile, daysPerWeek: days.length };
    const next = i + 1;
    ctx.user.session = { ...ctx.user.session, step: next };
    await updateUser(ctx.db, ctx.user._id, { profile: ctx.user.profile, session: ctx.user.session });
    await renderObStep(ctx, next);
    return;
  }
  if (payload === "none" && step.input === "text") {
    await obApplyAndAdvance(ctx, step, "none");
    return;
  }
  if (payload.startsWith("v:") && step.buttons) {
    const opt = step.buttons[Number(payload.slice(2))];
    if (opt) await obApplyAndAdvance(ctx, step, opt.value);
    return;
  }
}

// Typed answers during the wizard (numbers + free-text steps).
export async function onboardingStep(ctx: MyContext, userText?: string) {
  const lang = ctx.user.lang;
  const i = ctx.user.session.step ?? 0;
  const steps = obSteps(lang);
  const step = steps[i];
  if (!step) return finishOnboarding(ctx);
  if (userText === undefined) {
    await renderObStep(ctx, i); // resume / first render
    return;
  }
  const text = userText.trim();
  if (step.input === "number") {
    const n = parseInt(text.replace(/[^\d]/g, ""), 10);
    if (!Number.isFinite(n) || n < AGE_RANGE.min || n > AGE_RANGE.max) {
      await reply(ctx, t(lang, "ob_invalid_number"));
      return;
    }
    await obApplyAndAdvance(ctx, step, n);
    return;
  }
  if (step.input === "number2") {
    const hw = parseHeightWeight(text);
    if (!hw) {
      await reply(ctx, t(lang, "ob_hw_unrealistic"));
      return;
    }
    const profile = { ...ctx.user.profile, heightCm: hw.heightCm, weightKg: hw.weightKg };
    const next = i + 1;
    ctx.user.profile = profile;
    ctx.user.session = { ...ctx.user.session, step: next };
    await updateUser(ctx.db, ctx.user._id, { profile, session: ctx.user.session });
    await renderObStep(ctx, next);
    return;
  }
  if (step.input === "text" || step.acceptsText) {
    await obApplyAndAdvance(ctx, step, text);
    return;
  }
  // Button-only step but user typed — re-show the buttons.
  await renderObStep(ctx, i);
}

async function finishOnboarding(ctx: MyContext) {
  const profile = ctx.user.profile;
  ctx.waitUntil(funnel(ctx, FUNNEL_FINISHED));
  // Park in plan_pending (not idle) before the slow AI call so a Worker timeout
  // leaves the user recoverable by the scheduler instead of stuck in idle/non-onboarded.
  ctx.user.session = { ...ctx.user.session, mode: "plan_pending", step: undefined };
  await updateUser(ctx.db, ctx.user._id, { session: ctx.user.session });
  if (ctx.user.role === "client" && ctx.user.trainerId) {
    await generateClientDraft(ctx, profile);
  } else {
    await generatePlan(ctx, profile);
  }
}
