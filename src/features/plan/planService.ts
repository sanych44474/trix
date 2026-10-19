// Plan use cases that run without a chat: the interview retry the scheduler fires, building and
// activating the plan once onboarding is done (questionnaire, ready program, recovery sweep), and
// the "rebuild my plan" the Mini App starts. Shared by the bot, the Mini App API and the cron, so
// it lives here rather than in bot/ (docs/adr/0010-layering.md). Moved from bot/plan.ts unchanged.
import { pingOther } from "../../notify";
import { sendBestEffort } from "../../adapters/telegram/rawApi";
import { appLink, appMarkup } from "../../notify/appKeyboard";
import type { Env, Lang, PlanDoc, UserDoc } from "../../types";
import { botDeepLink, shareUrl } from "../../notify/links";
import { logInfo } from "../../log";
import { recordError } from "../../adapters/d1/v2AiTelemetry";
import { recordPlanSource } from "../../adapters/d1/v2Analytics";
import { listStrength } from "../../adapters/d1/v2Workouts";
import { listPlanBank, saveDraftPlan, setActivePlan } from "../../adapters/d1/v2Plans";
import { getUser, stampOnboardedAt, updateUser } from "../../adapters/d1/v2Users";
import { sanitizeBodyMetrics } from "../../domain/workoutText";
import { adaptPlan } from "../../domain/planAdapt";
import { selectBest } from "../../domain/planBank";
import { formatRecordBest } from "../../domain/setFormat";
import { escapeHtml, t } from "../../locales/i18n";
import { aiJSON } from "../../ai/index";
import * as P from "../../ai/prompts";
import { buildPlanDocRaw, resolveDislikedSwaps } from "./planBuild";

// Standalone interview retry — called by the scheduler when session.retryAfter fires.
// No grammY ctx needed: uses direct Telegram API + env.
export async function retryInterviewStep(env: Env, db: D1Database, user: UserDoc): Promise<void> {
  const transcript = user.session.transcript ?? [];
  const lang = user.lang;

  // If the last transcript entry is already from the assistant, the AI question was generated
  // but the Telegram message may have been lost. Re-send it silently — no AI call needed.
  const lastTurn = transcript[transcript.length - 1];
  if (lastTurn?.role === "assistant") {
    await sendBestEffort(env, user.chatId, escapeHtml(lastTurn.text));
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
    await sendBestEffort(env, user.chatId, escapeHtml(result.message));
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
export async function bankFallbackPlan(
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
      await sendBestEffort(env, user.chatId, t(lang, "client_plan_pending"), appMarkup(env, t(lang, "launch_open_btn"), "today"));
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
        await pingOther(env, trainer.chatId, t(trainer.lang, "trainer_client_draft_ready", { name: who }), reply_markup);
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
      await sendBestEffort(env, user.chatId, t(lang, "plan_ready"), reply_markup);
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
    await sendBestEffort(env, user.chatId, t(lang, "plan_rebuilt"), markup);
    return true;
  } catch (e) {
    console.error("rebuildPlan failed", user._id, e);
    await recordError(db, { userId: user._id, kind: "plan_rebuild", errorType: "exception", message: String(e).slice(0, 200) }).catch(() => {});
    const fresh = await getUser(db, user._id).catch(() => null);
    await updateUser(db, user._id, { session: { ...(fresh?.session ?? user.session), replanAt: undefined, replanFailed: new Date().toISOString() } }).catch(() => {});
    return false;
  }
}
