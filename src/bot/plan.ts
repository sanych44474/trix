// Plan authoring — the app's deepest module: AI interview retry, bank fallback, plan build /
// heal / translate, dynamic progression regeneration. Extracted from bot.ts (god-file split);
// behavior unchanged.
import { appLink, appMarkup } from "../notify/appKeyboard";
import { InlineKeyboard } from "grammy";
import type { Env, Lang, PlanDoc, UserDoc, Weekday } from "../types";
import type { MyContext } from "../adapters/telegram/context";
import { HTML, reply } from "../adapters/telegram/context";
import { localizePlanNames } from "./exerciseCatalog";
import { saveBaselineBody } from "./planGen";
import { videosForDays } from "./planView";
import { mainMenu, menuBtn, planActionsKb } from "./keyboards";
import { botDeepLink, shareUrl } from "./links";
import { logInfo } from "../log";
import { recordError } from "../adapters/d1/v2AiTelemetry";
import { recordPlanSource } from "../adapters/d1/v2Analytics";
import { listStrength } from "../adapters/d1/v2Workouts";
import { getActivePlan, listPlanBank, recentAdjustments, saveDraftPlan, setActivePlan } from "../adapters/d1/v2Plans";
import { getTrainer } from "../adapters/d1/v2Trainer";
import { getUser, stampOnboardedAt, updateUser } from "../adapters/d1/v2Users";
import { sanitizeBodyMetrics } from "../domain/workoutText";
import { trainerStyleBlock } from "../features/trainer/trainerWizard";
import { adaptPlan } from "../domain/planAdapt";
import { exerciseCountLimits } from "../domain/plan-lint";
import { MATCH_THRESHOLD, selectBest } from "../domain/planBank";
import { formatRecordBest } from "../domain/setFormat";
import { cleanAi, escapeHtml, t } from "../locales/i18n";
import { renderPlan } from "../render";
import { RateLimitError, aiJSON } from "../ai/index";
import * as P from "../ai/prompts";
import { buildPlanDoc, buildPlanDocRaw, resolveDislikedSwaps } from "./planBuild";
export * from "./planBuild";

// Standalone interview retry — called by the scheduler when session.retryAfter fires.
// No grammY ctx needed: uses direct Telegram API + env.
export async function retryInterviewStep(env: Env, db: D1Database, user: UserDoc): Promise<void> {
  const transcript = user.session.transcript ?? [];
  const lang = user.lang;

  // If the last transcript entry is already from the assistant, the AI question was generated
  // but the Telegram message may have been lost. Re-send it silently — no AI call needed.
  const lastTurn = transcript[transcript.length - 1];
  if (lastTurn?.role === "assistant") {
    await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: user.chatId, text: escapeHtml(lastTurn.text), parse_mode: "HTML" }),
    });
    // Clear retryAfter — message re-delivered.
    await updateUser(db, user._id, {
      session: { ...user.session, retryAfter: undefined } as typeof user.session,
    });
    return;
  }

  try {
    const result = await aiJSON<P.InterviewResult>(env, {
      system: P.interviewSystem(lang),
      user: P.interviewUser(transcript, user.profile.name),
      schema: P.INTERVIEW_SCHEMA,
      temperature: 0.6,
      kind: "interview",
      db,
      userId: user._id,
    });
    transcript.push({ role: "assistant", text: result.message });
    const mergedProfile = sanitizeBodyMetrics({ ...user.profile, ...result.profile });
    // Clear retryAfter — success.
    await updateUser(db, user._id, {
      profile: mergedProfile,
      session: { mode: "onboarding", transcript },
    });
    await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: user.chatId, text: escapeHtml(result.message), parse_mode: "HTML" }),
    });
    if (result.done) {
      // Onboarding complete — generate the plan. MUST be awaited: in a cron isolate a
      // fire-and-forget promise is killed when runSchedule resolves, which left users with
      // a "creating your plan…" message but no plan (stuck onboarded=0). finalizeOnboardingPlan
      // sets mode=plan_pending on failure so the plan-pending sweep retries it.
      await finalizeOnboardingPlan(env, db, { ...user, profile: mergedProfile });
    }
  } catch (err) {
    // Still failing — schedule another retry in 10 min (give up after 3 attempts).
    // Never show an error to the user — stay silent and keep retrying.
    const attempts = ((user.session as { retryAttempts?: number }).retryAttempts ?? 0) + 1;
    if (attempts >= 3) {
      // Give up silently — user can re-trigger by sending any message.
      await updateUser(db, user._id, { session: { mode: "onboarding", transcript } });
    } else {
      const retryAfter = new Date(Date.now() + 10 * 60_000).toISOString();
      await updateUser(db, user._id, {
        session: { mode: "onboarding", transcript, retryAfter, retryAttempts: attempts } as UserDoc["session"],
      });
    }
    console.error("retryInterviewStep failed attempt", attempts, user._id, err);
  }
}

// Build + activate the plan for a user whose interview is DONE, mark them onboarded, and
// notify. For trainer clients, saves a draft for trainer review instead of activating directly.
// On failure parks them in mode=plan_pending so the scheduler's plan-pending sweep
// retries — guaranteeing a finished interview always converges to a plan (never a dead end).
// Used by retryInterviewStep (done-branch) and the scheduler recovery sweep.
// Best-effort bank archetype for the AI-direct plan paths when AI generation fails, so a
// completed interview always converges to a plan instead of looping in plan_pending while the
// AI chain is down. Mirrors buildPlanForUser's emergency fallback but ctx-free; exercise names
// localize lazily on first view (healPlanNamesForDisplay). Returns null when no archetype fits.
async function bankFallbackPlan(
  db: D1Database, lang: Lang, profile: UserDoc["profile"], userId: number, authoredBy?: number,
): Promise<PlanDoc | null> {
  const match = selectBest(await listPlanBank(db), profile, userId);
  if (!match) return null;
  const bankPlan = match.entry.plan[lang === "en" ? "en" : "uk"];
  const replacements = await resolveDislikedSwaps(db, lang, bankPlan.split, profile).catch(() => new Map());
  const plan = adaptPlan(bankPlan, profile, userId, { replacements, authoredBy, finishFor: lang === "en" ? "en" : "uk" });
  await recordPlanSource(db, userId, "workout", "bank").catch(() => {});
  return plan;
}

// `preferBank` (used by the every-minute plan_pending recovery sweep) builds the zero-AI bank
// plan FIRST so a slow/degraded AI chain can't block the cron for tens of seconds per stuck
// user — which starves the reminder/check-in section that runs after the sweep. The interview
// done-branch leaves it false so a fresh interview still gets a tailored AI plan (bank fallback).
const withMarkup = (m: unknown) => (m ? { reply_markup: m } : {});

export async function finalizeOnboardingPlan(
  env: Env, db: D1Database, user: UserDoc, opts: { preferBank?: boolean } = {},
): Promise<boolean> {
  const lang = user.lang;
  const isTrainerClient = user.role === "client" && !!user.trainerId;
  const wasOnboarded = user.onboarded; // captured before any mutation below -- see docs/slos.md
  try {
    const authoredBy = isTrainerClient ? user.trainerId ?? undefined : undefined;
    let plan: PlanDoc | null = null;
    let planSource: "ai" | "bank" = "ai";
    if (opts.preferBank) {
      plan = await bankFallbackPlan(db, lang, user.profile, user._id, authoredBy).catch(() => null);
      if (plan) planSource = "bank";
    }
    if (!plan) {
      try {
        plan = await buildPlanDocRaw(env, db, lang, user.profile, user._id, isTrainerClient ? { authoredBy } : {});
        planSource = "ai";
      } catch (aiErr) {
        // AI chain down — serve the best bank archetype rather than stranding a finished interview.
        const fb = await bankFallbackPlan(db, lang, user.profile, user._id, authoredBy);
        if (!fb) throw aiErr; // no archetype → let the outer catch park for a later retry
        console.error("finalizeOnboardingPlan AI failed — served bank archetype", user._id, aiErr);
        plan = fb;
        planSource = "bank";
      }
    }
    if (!wasOnboarded) {
      logInfo("onboarding_completed", { role: user.role });
      await stampOnboardedAt(db, user._id).catch(() => {});
    }
    if (isTrainerClient) {
      // Save as a draft for the trainer to review, not an active plan -- docs/slos.md's
      // first_plan_ready is defined as the first setActivePlan, which this branch never calls.
      await saveDraftPlan(db, plan);
      await updateUser(db, user._id, { onboarded: true, nutrition: plan.nutrition, session: { mode: "idle" } });
      await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: user.chatId, text: t(lang, "client_plan_pending"), parse_mode: "HTML", ...withMarkup(appMarkup(env, t(lang, "launch_open_btn"), "today")) }),
      });
      // Notify the trainer.
      const trainer = user.trainerId ? await getUser(db, user.trainerId) : null;
      if (trainer) {
        const who = escapeHtml(user.profile.name ?? `id ${user._id}`);
        // Inline actions so the trainer can review/assign right from the notification (no /clients hunt).
        // Review and assign on the client's card in the app (chat callbacks without the app).
        const reply_markup = appMarkup(env, t(trainer.lang, "nb_open_client"), "role", { client: user._id }) ?? {
          inline_keyboard: [[
            { text: t(trainer.lang, "cc_plan"), callback_data: `cl:${user._id}:plan` },
            { text: t(trainer.lang, "cc_assign"), callback_data: `cl:${user._id}:assign` },
          ]],
        };
        await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: trainer.chatId, text: t(trainer.lang, "trainer_client_draft_ready", { name: who }), parse_mode: "HTML", reply_markup }),
        }).catch(() => {});
      }
    } else {
      await setActivePlan(db, plan);
      if (!wasOnboarded) logInfo("first_plan_ready", { source: planSource });
      await updateUser(db, user._id, { onboarded: true, nutrition: plan.nutrition, session: { mode: "idle" } });
      // Getting the plan is the high point of onboarding — the one moment the user is committed
      // but not yet training alone. An accountability buddy is a two-person feature, so offering
      // it here turns one signup into an invitation; buried in settings it never gets found.
      const buddy = botDeepLink(env, `buddy_${user._id}`);
      // First the plan itself (today's session in the app), then the buddy invite.
      const todayUrl = appLink(env, "today");
      const rows = [
        ...(todayUrl ? [[{ text: t(lang, "nb_open_today"), web_app: { url: todayUrl } }]] : []),
        ...(buddy ? [[{ text: t(lang, "buddy_offer_btn"), url: shareUrl(buddy, t(lang, "buddy_offer_share")) }]] : []),
      ];
      const reply_markup = rows.length ? { inline_keyboard: rows } : undefined;
      await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: user.chatId, text: t(lang, "plan_ready"), parse_mode: "HTML", ...(reply_markup ? { reply_markup } : {}) }),
      });
    }
    return true;
  } catch (e) {
    console.error("finalizeOnboardingPlan failed", user._id, e);
    // Persisted, not just logged: this is a user who finished the interview and is stuck
    // without a plan, which is exactly what /ownerreport → Errors exists to surface.
    await recordError(db, { userId: user._id, kind: "plan_finalize", errorType: "exception", message: String(e).slice(0, 200) }).catch(() => {});
    // Park for the plan-pending sweep to retry (don't leave them stuck).
    await updateUser(db, user._id, { session: { mode: "plan_pending" } }).catch(() => {});
    return false;
  }
}

/** A rebuild still counts as running this long after it started (a crashed one frees up after). */
export const REPLAN_RUNNING_MS = 5 * 60_000;

/** True while a plan rebuild the user started from the app is still building. */
export function replanRunning(user: UserDoc, now = Date.now()): boolean {
  const at = user.session.replanAt ? Date.parse(user.session.replanAt) : Number.NaN;
  return Number.isFinite(at) && now - at < REPLAN_RUNNING_MS;
}

/**
 * Rebuild an athlete's own plan from their current profile and records (the app's "Rebuild plan";
 * the chat's /replan). AI first with the strength records as anchors, the closest bank archetype
 * if the AI chain is down. Activates it, refreshes nutrition targets and pings the user with a
 * button to the new plan. Trainer clients never get here (their trainer owns the plan).
 */
export async function rebuildPlan(env: Env, db: D1Database, user: UserDoc): Promise<boolean> {
  const lang = user.lang;
  try {
    const records = await listStrength(db, user._id, 8).catch(() => []);
    const prs = records.length ? records.map((r) => `${r.exercise}: ${formatRecordBest(r)}`).join("\n") : undefined;
    let plan: PlanDoc | null = null;
    let source: "ai" | "bank" = "ai";
    try {
      plan = await buildPlanDocRaw(env, db, lang, user.profile, user._id, { prs });
      await recordPlanSource(db, user._id, "workout", "ai").catch(() => {});
    } catch (aiErr) {
      plan = await bankFallbackPlan(db, lang, user.profile, user._id);
      source = "bank";
      if (!plan) throw aiErr;
    }
    await setActivePlan(db, plan);
    const fresh = await getUser(db, user._id);
    await updateUser(db, user._id, { nutrition: plan.nutrition, session: { ...(fresh?.session ?? user.session), replanAt: undefined } });
    logInfo("plan_rebuilt", { source });
    const markup = appMarkup(env, t(lang, "nb_open_plan"), "plan");
    await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: user.chatId, text: t(lang, "plan_rebuilt"), parse_mode: "HTML", ...withMarkup(markup) }),
    }).catch(() => {});
    return true;
  } catch (e) {
    console.error("rebuildPlan failed", user._id, e);
    await recordError(db, { userId: user._id, kind: "plan_rebuild", errorType: "exception", message: String(e).slice(0, 200) }).catch(() => {});
    const fresh = await getUser(db, user._id).catch(() => null);
    await updateUser(db, user._id, { session: { ...(fresh?.session ?? user.session), replanAt: undefined, replanFailed: new Date().toISOString() } }).catch(() => {});
    return false;
  }
}

// Client finished onboarding under a trainer: build an AI DRAFT for the trainer to review
// (not activated), mark the client onboarded, and notify the trainer.
export async function generateClientDraft(ctx: MyContext, profile: UserDoc["profile"]) {
  const lang = ctx.user.lang;
  const wasOnboarded = ctx.user.onboarded; // captured before any mutation below -- see docs/slos.md
  await reply(ctx, t(lang, "client_plan_generating"));
  await ctx.replyWithChatAction("typing").catch(() => {});
  try {
    // Bias the AI draft toward the supervising trainer's stated style (specialization/approach).
    const trainerDoc = ctx.user.trainerId ? await getTrainer(ctx.db, ctx.user.trainerId) : null;
    const trainerStyle = trainerDoc ? trainerStyleBlock(trainerDoc) : undefined;
    let plan: PlanDoc;
    try {
      plan = await buildPlanDoc(ctx, lang, profile, ctx.user._id, {
        authoredBy: ctx.user.trainerId,
        trainerStyle,
      });
    } catch (aiErr) {
      // AI chain down/rate-limited — serve the best bank archetype as the draft rather than
      // stranding a finished client interview in plan_pending. Trainer can still edit before assigning.
      const fb = await bankFallbackPlan(ctx.db, lang, profile, ctx.user._id, ctx.user.trainerId ?? undefined);
      if (!fb) throw aiErr; // no archetype → let the outer catch park for a later retry
      console.error("generateClientDraft AI failed — served bank archetype", ctx.user._id, aiErr);
      plan = fb;
    }
    await saveDraftPlan(ctx.db, plan);
    // Draft only, not activated -- first_plan_ready (docs/slos.md) is defined as the first
    // setActivePlan, which never happens on this trainer-review path.
    if (!wasOnboarded) {
      logInfo("onboarding_completed", { role: ctx.user.role });
      await stampOnboardedAt(ctx.db, ctx.user._id).catch(() => {});
    }
    await updateUser(ctx.db, ctx.user._id, {
      onboarded: true,
      nutrition: plan.nutrition,
      profile: {
        ...profile,
        trainingWeekdays:
          profile.trainingWeekdays?.length ? profile.trainingWeekdays : (plan.split.map((d) => d.weekday) as Weekday[]),
      },
      session: { mode: "idle" },
    });
    await saveBaselineBody(ctx, profile);
    await reply(ctx, t(lang, "client_plan_pending"), menuBtn(lang));
    // Notify the trainer. If the client already trains on a plan (e.g. one the trainer made
    // from the mini-interview), frame the fresh draft as a REVISION proposal based on the
    // now-complete interview answers rather than a first draft.
    const trainer = ctx.user.trainerId ? await getUser(ctx.db, ctx.user.trainerId) : null;
    if (trainer) {
      const hadPlan = !!(await getActivePlan(ctx.db, ctx.user._id).catch(() => null));
      const who = escapeHtml(profile.name ?? `id ${ctx.user._id}`);
      const kb = new InlineKeyboard()
        .text(t(trainer.lang, "cc_plan"), `cl:${ctx.user._id}:plan`)
        .text(t(trainer.lang, "cc_assign"), `cl:${ctx.user._id}:assign`);
      const key = hadPlan ? "trainer_client_interview_revised" : "trainer_client_draft_ready";
      await ctx.api
        .sendMessage(trainer.chatId, t(trainer.lang, key, { name: who }), { ...HTML, reply_markup: kb })
        .catch(() => {});
    }
  } catch (err) {
    if (err instanceof RateLimitError) {
      await updateUser(ctx.db, ctx.user._id, { profile, session: { mode: "plan_pending" } });
      await reply(ctx, t(lang, "limit_hit"));
      return;
    }
    console.error("client draft failed", err);
    // Interview is genuinely done even though plan generation failed entirely (the plan-pending
    // recovery sweep will retry) -- onboarded flips true here too, so the event fires here too.
    if (!wasOnboarded) {
      logInfo("onboarding_completed", { role: ctx.user.role });
      await stampOnboardedAt(ctx.db, ctx.user._id).catch(() => {});
    }
    await updateUser(ctx.db, ctx.user._id, {
      onboarded: true,
      profile,
      session: { mode: "plan_pending" },
    });
    await reply(ctx, t(lang, "client_plan_pending"));
  }
}

// Build a plan for a user: prefer a pre-generated bank archetype (zero AI) when one matches
// well; otherwise fall back to full Gemini generation. `forceAi` skips the bank (the user
// asked for an AI plan via the button).
export async function buildPlanForUser(
  ctx: MyContext,
  lang: Lang,
  profile: UserDoc["profile"],
  forUserId: number,
  opts: { prs?: string; authoredBy?: number; forceAi?: boolean } = {},
): Promise<{ plan: PlanDoc; source: "bank" | "ai" }> {
  // Score the closest bank archetype once — used both for the zero-AI primary path (a strong
  // match) and as the emergency fallback (any match) when AI generation fails/times out.
  let match: ReturnType<typeof selectBest> = null;
  try {
    match = selectBest(await listPlanBank(ctx.db), profile, forUserId);
  } catch (err) {
    console.error("bank plan selection failed", err);
  }
  const fromBank = async (): Promise<{ plan: PlanDoc; source: "bank" }> => {
    const bankPlan = match!.entry.plan[lang === "en" ? "en" : "uk"];
    const replacements = await resolveDislikedSwaps(ctx.db, lang, bankPlan.split, profile).catch(() => new Map());
    const plan = adaptPlan(bankPlan, profile, forUserId, { prs: opts.prs, replacements, authoredBy: opts.authoredBy, finishFor: lang === "en" ? "en" : "uk" });
    await localizePlanNames(ctx, plan, lang);
    await recordPlanSource(ctx.db, forUserId, "workout", "bank").catch(() => {});
    return { plan, source: "bank" };
  };
  if (!opts.forceAi && match && match.score >= MATCH_THRESHOLD) {
    try { return await fromBank(); } catch (err) { console.error("bank adapt failed, falling back to AI", err); }
  }
  try {
    const plan = await buildPlanDoc(ctx, lang, profile, forUserId, { prs: opts.prs, authoredBy: opts.authoredBy });
    await recordPlanSource(ctx.db, forUserId, "workout", "ai").catch(() => {});
    return { plan, source: "ai" };
  } catch (err) {
    // AI down (e.g. every provider timed out). Rather than strand the user in plan_pending,
    // serve the best available bank archetype regardless of match score.
    if (match) {
      console.error("AI plan gen failed — serving best-effort bank archetype", err);
      return await fromBank();
    }
    throw err; // no bank to fall back on — let the caller retry later
  }
}

// Lazy self-heal: if an AI-coached plan is degenerate (a training day with fewer than
// the exercise minimum for this client's session budget), silently rebuild it with the
// now-validated generator and notify once. Trainer-managed client plans are left untouched.
// On any AI failure the original plan is kept (no data loss). Returns the plan to show.
export async function healPlanIfDegenerate(ctx: MyContext, plan: PlanDoc): Promise<PlanDoc> {
  if (ctx.user.role === "client") return plan;
  const limits = exerciseCountLimits(ctx.user.profile);
  const degenerate = plan.split.some((d) => (d.exercises?.length ?? 0) < limits.min);
  if (!degenerate) return plan;
  try {
    const records = await listStrength(ctx.db, ctx.user._id, 8);
    const prs = records.length
      ? records.map((r) => `${r.exercise}: ${formatRecordBest(r)}`).join("\n")
      : undefined;
    const fresh = await buildPlanDoc(ctx, ctx.user.lang, ctx.user.profile, ctx.user._id, {
      prs,
      authoredBy: plan.authoredBy,
    });
    await setActivePlan(ctx.db, fresh);
    await updateUser(ctx.db, ctx.user._id, { nutrition: fresh.nutrition });
    ctx.user.nutrition = fresh.nutrition;
    await reply(ctx, t(ctx.user.lang, "plan_healed"));
    return fresh;
  } catch (err) {
    console.error("healPlanIfDegenerate failed", ctx.user._id, err);
    return plan;
  }
}

// Free-tier async: ack instantly, park the user as plan_pending (so the every-minute cron
// heals it if the background task is evicted), then run the heavy AI in waitUntil. The
// webhook returns immediately instead of blocking ~1-10s on generation.
export async function generatePlan(ctx: MyContext, profile: UserDoc["profile"], prs?: string) {
  const lang = ctx.user.lang;
  await reply(ctx, t(lang, "plan_generating"));
  await updateUser(ctx.db, ctx.user._id, { profile, session: { mode: "plan_pending" } });
  ctx.user.session = { ...ctx.user.session, mode: "plan_pending" };
  ctx.waitUntil(deliverPlan(ctx, profile, prs));
}

// Heavy plan build + activation + delivery. Runs in the background (waitUntil) or, if that
// dies, is re-run by the cron plan-pending sweep (finalizeOnboardingPlan). On success it
// flips mode→idle so the sweep won't double-process.
export async function deliverPlan(ctx: MyContext, profile: UserDoc["profile"], prs?: string) {
  const lang = ctx.user.lang;
  const wasOnboarded = ctx.user.onboarded; // captured before any mutation below -- see docs/slos.md
  try {
    await ctx.replyWithChatAction("typing").catch(() => {});
    const { plan, source } = await buildPlanForUser(ctx, lang, profile, ctx.user._id, { prs });
    const split = plan.split;
    await setActivePlan(ctx.db, plan);
    if (!wasOnboarded) {
      logInfo("onboarding_completed", { role: ctx.user.role });
      logInfo("first_plan_ready", { source });
      await stampOnboardedAt(ctx.db, ctx.user._id).catch(() => {});
    }
    await updateUser(ctx.db, ctx.user._id, {
      onboarded: true,
      nutrition: plan.nutrition,
      profile: {
        ...profile,
        trainingWeekdays:
          profile.trainingWeekdays && profile.trainingWeekdays.length
            ? profile.trainingWeekdays
            : (split.map((d) => d.weekday) as Weekday[]),
      },
      session: { mode: "idle" },
    });
    await saveBaselineBody(ctx, profile);
    await reply(ctx, t(lang, "plan_ready"), mainMenu(lang));
    // A bank plan is instant; offer a one-tap AI regeneration. An AI plan already used Gemini.
    const kb = source === "bank" ? planActionsKb(lang) : menuBtn(lang);
    await reply(ctx, renderPlan(lang, plan, await videosForDays(ctx, plan.split)), kb);
  } catch (err) {
    // Leave mode=plan_pending — the cron plan-pending sweep retries silently (no error spam).
    console.error("deliverPlan failed", ctx.user._id, err);
  }
}

// "Generate with AI" button under a bank plan → rebuild via Gemini and replace the active plan.
export async function onPlanRegenAi(ctx: MyContext) {
  const lang = ctx.user.lang;
  await ctx.answerCallbackQuery().catch(() => {});
  if (ctx.user.role === "client") return; // clients follow their trainer's plan
  await reply(ctx, t(lang, "plan_generating"));
  ctx.waitUntil(regenPlanAi(ctx));
}

export async function regenPlanAi(ctx: MyContext) {
  const lang = ctx.user.lang;
  try {
    await ctx.replyWithChatAction("typing").catch(() => {});
    const records = await listStrength(ctx.db, ctx.user._id, 8);
    const prs = records.length
      ? records.map((r) => `${r.exercise}: ${formatRecordBest(r)}`).join("\n")
      : undefined;
    const plan = await buildPlanDoc(ctx, lang, ctx.user.profile, ctx.user._id, { prs });
    await setActivePlan(ctx.db, plan);
    await updateUser(ctx.db, ctx.user._id, { nutrition: plan.nutrition });
    ctx.user.nutrition = plan.nutrition;
    await reply(ctx, t(lang, "plan_ready"), mainMenu(lang));
    await reply(ctx, renderPlan(lang, plan, await videosForDays(ctx, plan.split)), menuBtn(lang));
  } catch (err) {
    console.error("regenPlanAi failed", ctx.user._id, err);
    await reply(ctx, t(lang, "error_generic"), menuBtn(lang)).catch(() => {});
  }
}

// Rebuild the active plan from the bank for an updated profile (level-up / goal switch) and
// deliver it. Shared by the level-up and goal-reached transitions.
export async function regenBankPlan(ctx: MyContext, profile: UserDoc["profile"], doneKey: string) {
  const lang = ctx.user.lang;
  try {
    await ctx.replyWithChatAction("typing").catch(() => {});
    const records = await listStrength(ctx.db, ctx.user._id, 8);
    const prs = records.length
      ? records.map((r) => `${r.exercise}: ${formatRecordBest(r)}`).join("\n")
      : undefined;
    const { plan } = await buildPlanForUser(ctx, lang, profile, ctx.user._id, { prs });
    await setActivePlan(ctx.db, plan);
    await updateUser(ctx.db, ctx.user._id, { nutrition: plan.nutrition });
    ctx.user.nutrition = plan.nutrition;
    await reply(ctx, t(lang, doneKey as Parameters<typeof t>[1]), mainMenu(lang));
    await reply(ctx, renderPlan(lang, plan, await videosForDays(ctx, plan.split)), planActionsKb(lang));
  } catch (err) {
    console.error("regenBankPlan failed", ctx.user._id, err);
    await reply(ctx, t(lang, "error_generic"), menuBtn(lang)).catch(() => {});
  }
}

// "What changed in my plan, and why" — the bi-weekly adaptive check-in (router.ts's
// handleAdaptiveCheckin) has always RECORDED every micro-adjustment it makes, reason field and
// all, but recentAdjustments() had zero callers: the automation was invisible to the person it
// was adapting for. docs/feature-audit.md flags exactly this silent-automation problem as a
// likely churn cause, so this surfaces the trail the bot was already keeping.
export async function cmdPlanChanges(ctx: MyContext) {
  const lang = ctx.user.lang;
  const rows = await recentAdjustments(ctx.db, ctx.user._id, 10).catch(() => []);
  if (!rows.length) {
    await reply(ctx, t(lang, "plan_changes_none"), menuBtn(lang));
    return;
  }
  const lines: string[] = [t(lang, "plan_changes_title")];
  for (const row of rows) {
    // Stored as the raw AdaptiveResult["adjustments"] array. A row written by an older/odd
    // shape must not break the whole history — skip what doesn't parse into entries.
    let adjustments: { weekday?: number; index?: number; sets?: string; startWeight?: string; reason?: string }[] = [];
    try {
      const parsed = JSON.parse(row.changes) as unknown;
      if (Array.isArray(parsed)) adjustments = parsed;
    } catch {
      continue;
    }
    if (!adjustments.length) continue;
    const date = row.ts.toISOString().slice(0, 10);
    lines.push("", `<b>${date}</b> · ${t(lang, "plan_changes_week", { n: row.week })}`);
    for (const a of adjustments.slice(0, 6)) {
      const what = [a.sets, a.startWeight].filter(Boolean).join(" · ");
      const why = a.reason ? ` — <i>${escapeHtml(cleanAi(a.reason))}</i>` : "";
      if (what) lines.push(`• ${escapeHtml(cleanAi(what))}${why}`);
      else if (a.reason) lines.push(`• ${escapeHtml(cleanAi(a.reason))}`);
    }
  }
  // Every row was unparseable/empty → same as having no history at all.
  if (lines.length === 1) {
    await reply(ctx, t(lang, "plan_changes_none"), menuBtn(lang));
    return;
  }
  await reply(ctx, lines.join("\n"), menuBtn(lang));
}
