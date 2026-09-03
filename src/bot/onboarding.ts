// Onboarding wizard: deterministic steps (buttons + minimal typed numbers/text), extracted
// from bot.ts. No per-turn AI — instant, no hangs, no parse ambiguity. The one AI call is the
// final plan gen, which stays in bot.ts (generatePlan / generateClientDraft — imported back,
// same value-cycle pattern as bot/trainer.ts; calls happen at request time only).
import { InlineKeyboard } from "grammy";
import { parseHeightWeight, realisticHeightCm, realisticWeightKg } from "../domain/progression";
import { listIncompleteOnboarding, updateUser } from "../db/repos";
import { escapeHtml, t } from "../locales/i18n";
import { HTML, generateClientDraft, generatePlan, reply, type MyContext, type TKey } from "../bot";
import type { Env, Lang, UserDoc, UserProfile, Weekday } from "../types";

export interface ObStep {
  field: "sex" | "age" | "hw" | "goal" | "level" | "daysPerWeek" | "trainingWeekdays" | "equipment" | "lifestyle" | "sleepSchedule" | "dietPrefs" | "limitations";
  q: TKey; // i18n question key
  buttons?: { label: string; value: string }[];
  input?: "number" | "number2" | "text";
  acceptsText?: boolean; // a button step that also accepts a typed free-text answer
  multiselect?: boolean; // weekday picker
  noneKey?: TKey; // optional "skip/none" button (i18n key) for text steps
}

export function obSteps(lang: Lang): ObStep[] {
  const b = (label: TKey, value: string) => ({ label: t(lang, label), value });
  return [
    { field: "sex", q: "ob_q_sex", buttons: [b("ob_sex_male", "male"), b("ob_sex_female", "female")] },
    { field: "age", q: "ob_q_age", input: "number" },
    { field: "hw", q: "ob_q_hw", input: "number2" },
    { field: "goal", q: "ob_q_goal", buttons: [b("ob_goal_fatloss", "fat loss"), b("ob_goal_muscle", "muscle gain"), b("ob_goal_recomp", "recomposition"), b("ob_goal_strength", "strength"), b("ob_goal_endurance", "endurance")] },
    { field: "level", q: "ob_q_level", buttons: [b("ob_level_beginner", "beginner"), b("ob_level_intermediate", "intermediate"), b("ob_level_advanced", "advanced")] },
    // Single source of truth for training frequency: the day picker. daysPerWeek is derived
    // from the count (no separate "how many days" question → no contradictions).
    { field: "trainingWeekdays", q: "ob_q_weekdays", multiselect: true },
    { field: "equipment", q: "ob_q_equipment", buttons: [b("ob_eq_gym", "full gym"), b("ob_eq_home", "home basics (dumbbells, bands)"), b("ob_eq_dumbbells", "dumbbells only"), b("ob_eq_bodyweight", "bodyweight only")] },
    { field: "lifestyle", q: "ob_q_lifestyle", buttons: [b("ob_life_sedentary", "sedentary"), b("ob_life_moderate", "moderate"), b("ob_life_active", "active")] },
    { field: "sleepSchedule", q: "ob_q_sleep", buttons: [b("ob_sleep_morning", "morning"), b("ob_sleep_evening", "evening")] },
    { field: "dietPrefs", q: "ob_q_diet", acceptsText: true, buttons: [b("ob_diet_none", "none"), b("ob_diet_vegetarian", "vegetarian"), b("ob_diet_vegan", "vegan")] },
    { field: "limitations", q: "ob_q_injuries", input: "text", noneKey: "ob_injuries_none" },
  ];
}

export const OB_WEEKDAY_KEYS: Record<number, TKey> = { 1: "wd_mon", 2: "wd_tue", 3: "wd_wed", 4: "wd_thu", 5: "wd_fri", 6: "wd_sat", 7: "wd_sun" };

// Build the inline keyboard for a step (shared by first render, in-place edits, and the
// cross-context push to a freshly-accepted client). Context-free so it can target any chat.
export function obKeyboard(lang: Lang, step: ObStep, selectedDays: number[] = [], canBack = false): InlineKeyboard | undefined {
  const kb = new InlineKeyboard();
  if (step.multiselect) {
    const sel = new Set(selectedDays);
    for (let d = 1; d <= 7; d++) {
      kb.text(`${sel.has(d as Weekday) ? "✅ " : ""}${t(lang, OB_WEEKDAY_KEYS[d])}`, `ob:wd:${d}`);
      if (d % 4 === 0) kb.row();
    }
    kb.row().text(t(lang, "ob_done"), "ob:wddone");
  } else if (step.buttons) {
    step.buttons.forEach((bt, idx) => {
      kb.text(bt.label, `ob:v:${idx}`);
      if ((idx + 1) % 2 === 0) kb.row();
    });
  } else if (step.noneKey) {
    kb.text(t(lang, step.noneKey), "ob:none");
  }
  // Back button to fix a previous answer without restarting (also gives typed steps a keyboard).
  if (canBack) kb.row().text(t(lang, "ob_back"), "ob:back");
  return kb.inline_keyboard.length ? kb : undefined;
}

// Render the question + keyboard for step i (also used to resume an in-progress wizard).
export async function renderObStep(ctx: MyContext, i: number) {
  const lang = ctx.user.lang;
  const steps = obSteps(lang);
  const step = steps[i];
  if (!step) return finishOnboarding(ctx);
  const progress = `(${i + 1}/${steps.length})`;
  await reply(ctx, `${progress} ${t(lang, step.q)}`, obKeyboard(lang, step, ctx.user.profile.trainingWeekdays ?? [], i > 0));
}

// Answered-question progress for the onboarding wizard, derived from the profile itself — works
// for both the button wizard and AI-interview users. `next` = first unanswered step (resume target).
// The checks mirror obSteps() order exactly.
export function obProgress(profile: UserProfile): { answered: number; total: number; next: number } {
  const checks: boolean[] = [
    !!profile.sex,
    profile.age !== undefined,
    profile.heightCm !== undefined && profile.weightKg !== undefined,
    !!profile.goal,
    !!profile.level,
    (profile.trainingWeekdays ?? []).length > 0,
    !!profile.equipment,
    !!profile.lifestyle,
    !!profile.sleepSchedule,
    !!profile.dietPrefs,
    profile.limitations !== undefined,
  ];
  const next = checks.indexOf(false);
  return { answered: checks.filter(Boolean).length, total: checks.length, next: next === -1 ? checks.length - 1 : next };
}

// Push onboarding step i (question + buttons) into an arbitrary chat. Needed when a trainer
// accepts a client — that runs in the trainer's context, so the client must be walked into
// the wizard proactively (otherwise they sit idle, never onboard, get no plan).
export async function sendObStepTo(ctx: MyContext, target: UserDoc, i: number, prefix: string) {
  const steps = obSteps(target.lang);
  const idx = Math.max(0, Math.min(i, steps.length - 1));
  const step = steps[idx];
  await ctx.api
    .sendMessage(target.chatId, `${prefix}\n\n(${idx + 1}/${steps.length}) ${t(target.lang, step.q)}`, {
      ...HTML,
      reply_markup: obKeyboard(target.lang, step, target.profile.trainingWeekdays ?? [], idx > 0),
    })
    .catch(() => {});
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
      let reply_markup: InlineKeyboard | undefined;
      if (u.session?.mode === "onboarding" && transcript?.length) {
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
      const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: u.chatId, text, parse_mode: "HTML", reply_markup }),
      });
      if (res.ok) pinged++;
    } catch (err) {
      console.error("pingIncompleteOnboarding", u._id, err);
    }
  }
  return { pinged, total: users.length };
}

export async function sendFirstObStep(ctx: MyContext, chatId: number, lang: Lang, prefix: string) {
  const steps = obSteps(lang);
  const step = steps[0];
  await ctx.api
    .sendMessage(chatId, `${prefix}\n\n(1/${steps.length}) ${t(lang, step.q)}`, { ...HTML, reply_markup: obKeyboard(lang, step, []) })
    .catch(() => {});
}

// Save a value to the profile, advance the wizard, render the next step (or finish).
export async function obApplyAndAdvance(ctx: MyContext, step: ObStep, raw: string | number) {
  const profile = { ...ctx.user.profile };
  if (step.field === "daysPerWeek") profile.daysPerWeek = Number(raw);
  else if (step.field === "age") profile.age = Number(raw);
  else if (step.field === "sex") profile.sex = raw === "female" ? "female" : "male";
  else if (step.field === "level") profile.level = raw as UserProfile["level"];
  else if (step.field === "lifestyle") profile.lifestyle = raw as UserProfile["lifestyle"];
  else if (step.field === "sleepSchedule") profile.sleepSchedule = raw as UserProfile["sleepSchedule"];
  else if (step.field === "goal") profile.goal = String(raw);
  else if (step.field === "equipment") profile.equipment = String(raw);
  else if (step.field === "dietPrefs") profile.dietPrefs = String(raw);
  else if (step.field === "limitations") profile.limitations = String(raw);
  const next = (ctx.user.session.step ?? 0) + 1;
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

// Drop implausible AI-provided body metrics so the interview re-asks instead of saving nonsense.
export function sanitizeBodyMetrics<T extends { heightCm?: number; weightKg?: number }>(p: T): T {
  const out = { ...p };
  if (out.heightCm !== undefined && !realisticHeightCm(out.heightCm)) out.heightCm = undefined;
  if (out.weightKg !== undefined && !realisticWeightKg(out.weightKg)) out.weightKg = undefined;
  return out;
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
    if (!Number.isFinite(n) || n <= 0 || n > 120) {
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

export async function finishOnboarding(ctx: MyContext) {
  const profile = ctx.user.profile;
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
