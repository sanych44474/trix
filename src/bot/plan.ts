// Plan authoring — the app's deepest module: AI interview retry, bank fallback, plan build /
// heal / translate, dynamic progression regeneration. Extracted from bot.ts (god-file split);
// behavior unchanged. Values imported from "../bot" are referenced only inside function bodies,
// so the value-cycle with bot.ts is load-safe.
import { InlineKeyboard } from "grammy";
import type { CatalogExercise, Env, Lang, PlanDay, PlanExercise, PlanDoc, UserDoc, Weekday } from "../types";
import type { AiPlan, MyContext } from "../bot";
import { HTML, MIN_EXERCISES_PER_DAY, localizePlanNames, reply, saveBaselineBody, videosForDays } from "../bot";
import { mainMenu, menuBtn, planActionsKb } from "./keyboards";
import { botDeepLink, shareUrl } from "./links";
import { countExercises, getActivePlan, getCatalogExercise, getExerciseTranslation, getTrainer, getUser, listCandidatesByMuscles, listPlanBank, listStrength, recordError, recordPlanSource, saveDraftPlan, setActivePlan, updateUser } from "../db/repos";
import { sanitizeBodyMetrics } from "./onboarding";
import { trainerStyleBlock } from "./trainer";
import { adaptPlan } from "../domain/planAdapt";
import { MATCH_THRESHOLD, selectBest } from "../domain/planBank";
import { API_MUSCLES, formatRecordBest, reconcileGrounding } from "../domain/progression";
import { cleanAi, escapeHtml, t } from "../locales/i18n";
import { renderPlan } from "../render";
import { RateLimitError, aiJSON } from "../ai/index";
import * as P from "../ai/prompts";

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
  const plan = adaptPlan(bankPlan, profile, userId, { replacements, authoredBy });
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
  try {
    const authoredBy = isTrainerClient ? user.trainerId ?? undefined : undefined;
    let plan: PlanDoc | null = null;
    if (opts.preferBank) {
      plan = await bankFallbackPlan(db, lang, user.profile, user._id, authoredBy).catch(() => null);
    }
    if (!plan) {
      try {
        plan = await buildPlanDocRaw(env, db, lang, user.profile, user._id, isTrainerClient ? { authoredBy } : {});
      } catch (aiErr) {
        // AI chain down — serve the best bank archetype rather than stranding a finished interview.
        const fb = await bankFallbackPlan(db, lang, user.profile, user._id, authoredBy);
        if (!fb) throw aiErr; // no archetype → let the outer catch park for a later retry
        console.error("finalizeOnboardingPlan AI failed — served bank archetype", user._id, aiErr);
        plan = fb;
      }
    }
    if (isTrainerClient) {
      // Save as a draft for the trainer to review, not an active plan.
      await saveDraftPlan(db, plan);
      await updateUser(db, user._id, { onboarded: true, nutrition: plan.nutrition, session: { mode: "idle" } });
      await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: user.chatId, text: t(lang, "client_plan_pending"), parse_mode: "HTML" }),
      });
      // Notify the trainer.
      const trainer = user.trainerId ? await getUser(db, user.trainerId) : null;
      if (trainer) {
        const who = escapeHtml(user.profile.name ?? `id ${user._id}`);
        // Inline actions so the trainer can review/assign right from the notification (no /clients hunt).
        const reply_markup = {
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
      await updateUser(db, user._id, { onboarded: true, nutrition: plan.nutrition, session: { mode: "idle" } });
      // Getting the plan is the high point of onboarding — the one moment the user is committed
      // but not yet training alone. An accountability buddy is a two-person feature, so offering
      // it here turns one signup into an invitation; buried in settings it never gets found.
      const buddy = botDeepLink(env, `buddy_${user._id}`);
      const reply_markup = buddy
        ? { inline_keyboard: [[{ text: t(lang, "buddy_offer_btn"), url: shareUrl(buddy, t(lang, "buddy_offer_share")) }]] }
        : undefined;
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

// Client finished onboarding under a trainer: build an AI DRAFT for the trainer to review
// (not activated), mark the client onboarded, and notify the trainer.
export async function generateClientDraft(ctx: MyContext, profile: UserDoc["profile"]) {
  const lang = ctx.user.lang;
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
    await updateUser(ctx.db, ctx.user._id, {
      onboarded: true,
      profile,
      session: { mode: "plan_pending" },
    });
    await reply(ctx, t(lang, "client_plan_pending"));
  }
}

// AI-build a PlanDoc for `forUserId` from a profile (not saved). Reused by solo plans,
// client onboarding drafts, and trainer-generated drafts.
// Guard: reject technique strings that look like truncated/broken output (e.g. "1.", "1. ").
export function isValidTechnique(s?: string): boolean {
  if (!s) return false;
  const t = s.trim();
  return t.length > 15 && !/^\d+\.?\s*$/.test(t);
}

// Translate exercise-level fields (name, technique, muscles, muscleGroup) from English
// to the user's language via a dedicated translator prompt. Called after plan generation
// for non-English users so the AI picks exercises from the catalog in English first
// (best for ID matching) and then the translation runs as a fast, cheap second step.
export async function translatePlanExercises(
  env: Env,
  lang: Lang,
  split: PlanDay[],
  db: D1Database,
  userId: number,
): Promise<PlanDay[]> {
  if (lang === "en") return split;
  const inputDays = split.map((d) => ({
    muscleGroup: d.muscleGroup,
    ...(d.warmUp?.length ? { warmUp: d.warmUp } : {}),
    ...(d.coolDown?.length ? { coolDown: d.coolDown } : {}),
    exercises: d.exercises.map((e) => ({
      ...(e.canonicalName ? { canonicalName: e.canonicalName } : {}),
      name: e.name,
      technique: e.technique,
      muscles: e.muscles ?? "",
      ...(e.warmupScheme ? { warmupScheme: e.warmupScheme } : {}),
    })),
  }));
  try {
    const result = await aiJSON<P.TranslateExercisesResult>(env, {
      system: P.translateExercisesSystem(lang),
      user: P.translateExercisesUser(inputDays),
      schema: P.TRANSLATE_EXERCISES_SCHEMA,
      temperature: 0.2,
      kind: "translate",
      db,
      userId,
    });
    return split.map((day, i) => {
      const td = result.days?.[i];
      if (!td) return day;
      return {
        ...day,
        muscleGroup: cleanAi(td.muscleGroup) || day.muscleGroup,
        warmUp: td.warmUp?.length ? td.warmUp.map(cleanAi) : day.warmUp,
        coolDown: td.coolDown?.length ? td.coolDown.map(cleanAi) : day.coolDown,
        exercises: day.exercises.map((e, j) => {
          const te = td.exercises?.[j];
          if (!te) return e;
          // Translate "Bodyweight" placeholder; append "kg" if unit was dropped by AI.
          const rawWeight = e.startWeight;
          const startWeight =
            rawWeight === "Bodyweight"
              ? "Власна вага"
              : /^\d+(\.\d+)?$/.test(rawWeight.trim())
                ? `${rawWeight.trim()} kg`
                : rawWeight;
          return {
            ...e,
            name: cleanAi(te.name) || e.name,
            technique: isValidTechnique(te.technique) ? cleanAi(te.technique) : e.technique,
            muscles: cleanAi(te.muscles) || e.muscles,
            startWeight,
            warmupScheme: te.warmupScheme ? cleanAi(te.warmupScheme) : e.warmupScheme,
          };
        }),
      };
    });
  } catch {
    // Translation is best-effort — fall back to English if it fails.
    return split;
  }
}

// Translate methodology + nutrition.notes from English to the user's language.
// Best-effort: falls back to the original English strings on any AI/parse error.
async function translatePlanMeta(
  env: Env,
  lang: Lang,
  methodology: string,
  nutritionNotes: string | undefined,
  db: D1Database,
  userId: number,
): Promise<{ methodology: string; nutritionNotes: string | undefined }> {
  if (lang === "en" || (!methodology && !nutritionNotes)) return { methodology, nutritionNotes };
  try {
    const result = await aiJSON<P.TranslateMetaResult>(env, {
      system: P.translateMetaSystem(lang),
      user: P.translateMetaUser(methodology, nutritionNotes ?? ""),
      schema: P.TRANSLATE_META_SCHEMA,
      temperature: 0.2,
      kind: "translate",
      db,
      userId,
    });
    return {
      methodology: cleanAi(result.methodology) || methodology,
      nutritionNotes: nutritionNotes !== undefined ? (cleanAi(result.nutritionNotes) || nutritionNotes) : undefined,
    };
  } catch {
    return { methodology, nutritionNotes };
  }
}

export async function buildPlanDoc(
  ctx: MyContext,
  lang: Lang,
  profile: UserDoc["profile"],
  forUserId: number,
  opts: { prs?: string; authoredBy?: number; trainerStyle?: string } = {},
): Promise<PlanDoc> {
  return buildPlanDocRaw(ctx.env, ctx.db, lang, profile, forUserId, opts);
}

// Transform a validated AI plan's split into clean PlanDays: sanitize every text field, clamp
// weekdays, and re-anchor each exercise to a real catalog id (dropping hallucinated ids and
// fixing name/id mismatches via reconcileGrounding). Pure — no I/O.
export function aiSplitToPlanDays(
  aiSplit: AiPlan["split"],
  candidates: CatalogExercise[],
  candidateIds: Set<string>,
): PlanDay[] {
  const clean = (v?: string) => (v ? cleanAi(v) : undefined);
  const cleanList = (arr?: string[]) =>
    (arr ?? []).map((s) => cleanAi(s)).filter((s) => s.trim().length > 0);
  return aiSplit.map((d) => {
    const warmUp = cleanList(d.warmUp);
    const coolDown = cleanList(d.coolDown);
    return {
    weekday: Math.min(7, Math.max(1, Math.round(d.weekday))) as Weekday,
    muscleGroup: d.muscleGroup,
    ...(d.sessionType ? { sessionType: cleanAi(d.sessionType) } : {}),
    ...(typeof d.durationMin === "number" ? { durationMin: d.durationMin } : {}),
    ...(warmUp.length ? { warmUp } : {}),
    ...(coolDown.length ? { coolDown } : {}),
    exercises: (d.exercises ?? []).map((e) => {
      // Keep the catalog link only if the AI copied a real id (drop hallucinated ids), then
      // re-anchor by name: the model sometimes links a well-described movement to an
      // unrelated-but-valid id (e.g. a lateral raise grounded to a shrug). reconcileGrounding
      // switches to the best name match or drops the grounding so no wrong video/info attaches.
      const validId = e.exerciseId && candidateIds.has(e.exerciseId) ? e.exerciseId : undefined;
      const link = reconcileGrounding(cleanAi(e.name), validId, candidates);
      const ss = clean(e.supersetGroup);
      const role = clean(e.role);
      return {
        name: cleanAi(e.name),
        sets: cleanAi(e.sets),
        startWeight: cleanAi(e.startWeight),
        technique: cleanAi(e.technique),
        muscles: cleanAi(e.muscles),
        isKeyLift: !!e.isKeyLift,
        ...(e.metric === "time" || e.metric === "distance" ? { metric: e.metric } : {}),
        ...(clean(e.rpe) ? { rpe: clean(e.rpe) } : {}),
        ...(clean(e.rir) ? { rir: clean(e.rir) } : {}),
        ...(clean(e.rest) ? { rest: clean(e.rest) } : {}),
        ...(clean(e.tempo) ? { tempo: clean(e.tempo) } : {}),
        ...(clean(e.heartRateZone) ? { heartRateZone: clean(e.heartRateZone) } : {}),
        ...(clean(e.movementPattern) ? { movementPattern: clean(e.movementPattern) } : {}),
        ...(role === "primary" || role === "accessory" ? { role } : {}),
        ...(clean(e.warmupScheme) ? { warmupScheme: clean(e.warmupScheme) } : {}),
        ...(ss ? { supersetGroup: ss.slice(0, 1).toUpperCase() } : {}),
        ...(link ? { exerciseId: link.id, canonicalName: link.name } : {}),
      };
    }),
    };
  });
}

export async function buildPlanDocRaw(
  env: Env,
  db: D1Database,
  lang: Lang,
  profile: UserDoc["profile"],
  forUserId: number,
  opts: { prs?: string; authoredBy?: number; trainerStyle?: string } = {},
): Promise<PlanDoc> {
  // Ground the plan in real catalog exercises when the catalog is seeded; otherwise the
  // candidate list is empty and the prompt is identical to the legacy AI-invent behavior.
  const candidates = (await countExercises(db))
    ? await listCandidatesByMuscles(db, [...API_MUSCLES], { level: profile.level, perMuscle: 20, total: 320 })
    : [];
  const candidateIds = new Set(candidates.map((c) => c.id));
  const ai = await aiJSON<AiPlan>(env, {
    system: P.planSystem(lang),
    user: P.planUser(profile, opts.prs, candidates, opts.trainerStyle),
    schema: P.PLAN_SCHEMA,
    temperature: 0.7,
    kind: "plan",
    db,
    userId: forUserId,
    attemptsPerKey: 2, // give each key 2 generations before rotating
    // Reject degenerate plans (the bug where a model returns 1 exercise/day): every
    // training day must carry a full session. A rejected result is retried/rotated.
    validate: (parsed) => {
      const p = parsed as AiPlan;
      if (!Array.isArray(p.split) || p.split.length === 0) throw new Error("plan: empty split");
      // Expected training days = the user's chosen weekdays (or daysPerWeek). Reject a plan with
      // fewer days than requested (the "one-day draft" bug where the model collapses the split).
      const expectedDays = Math.min(7, Math.max(1, profile.trainingWeekdays?.length || profile.daysPerWeek || 3));
      if (p.split.length < expectedDays) {
        throw new Error(`plan: ${p.split.length} day(s) < expected ${expectedDays}`);
      }
      for (const d of p.split) {
        const n = Array.isArray(d.exercises) ? d.exercises.length : 0;
        if (n < MIN_EXERCISES_PER_DAY) {
          throw new Error(`plan: weekday ${d.weekday} has ${n} exercises (< ${MIN_EXERCISES_PER_DAY})`);
        }
      }
    },
  });
  // Guard against a parseable-but-wrong-shape AI response (e.g. a weak fallback model):
  // fail clearly here so the caller shows a retry instead of crashing on undefined.
  if (!Array.isArray(ai.split) || ai.split.length === 0) {
    throw new Error("AI plan missing split");
  }
  const split = aiSplitToPlanDays(ai.split, candidates, candidateIds);
  // Translate exercise fields (name/technique/muscles/muscleGroup) from English to the
  // user's language. The plan prompt always outputs these in English for best catalog
  // ID matching; translation runs as a fast second step.
  const translatedSplit = await translatePlanExercises(env, lang, split, db, forUserId);
  // Translate plan-level text fields (methodology and nutrition notes) — they come from the AI
  // in English and are not covered by the exercise-translation pass.
  const { methodology: translatedMethodology, nutritionNotes: translatedNutNotes } =
    await translatePlanMeta(env, lang, ai.methodology, ai.nutrition.notes, db, forUserId);
  // NOTE: the technique-video cache is intentionally NOT warmed here. Plan generation already
  // spends a heavy subrequest budget (catalog read + plan AI with fallbacks + translation AI +
  // exercise-translation caching); adding a per-exercise YouTube lookup loop pushed the whole
  // invocation past the Workers subrequest cap ("Too many subrequests" on plan/ai). Videos are
  // populated lazily instead: videosForDays() backfills any cache miss in a waitUntil() when the
  // user first opens the plan/today, and the owner /refreshvideos + backfill cover the rest.
  return {
    userId: forUserId,
    active: false,
    status: "active",
    authoredBy: opts.authoredBy,
    split: translatedSplit,
    nutrition: { ...ai.nutrition, ...(translatedNutNotes !== undefined ? { notes: translatedNutNotes } : {}) },
    ...(ai.restDayNutrition && typeof ai.restDayNutrition.calories === "number"
      ? { restDayNutrition: ai.restDayNutrition }
      : {}),
    supplements: [],
    methodology: translatedMethodology,
    ...(ai.movementAudit ? { movementAudit: cleanAi(ai.movementAudit) } : {}),
    generatedAt: new Date(),
    ...(typeof ai.stepsTarget === "number" ? { stepsTarget: ai.stepsTarget } : {}),
  };
}

// Resolve disliked / contraindicated exercises in a bank plan to same-muscle catalog
// alternatives (EN+UK attached). Best-effort: any lookup failure just leaves the original.
// Returns a map keyed by the original exercise name AND canonicalName → movement-only override.
export async function resolveDislikedSwaps(
  db: D1Database,
  lang: Lang,
  split: PlanDay[],
  profile: UserDoc["profile"],
): Promise<Map<string, Partial<PlanExercise>>> {
  const out = new Map<string, Partial<PlanExercise>>();
  const raw = `${profile.dislikedExercises ?? ""} ${profile.limitations ?? ""}`.toLowerCase();
  const tokens = raw
    .split(/[,;]+|\band\b|\bor\b/)
    .map((s) => s.replace(/[^a-z\s-]/g, " ").trim())
    .filter((w) => w.length >= 4 && w !== "none");
  if (!tokens.length) return out;
  const usedIds = new Set(split.flatMap((d) => d.exercises.map((e) => e.exerciseId).filter(Boolean) as string[]));
  // The exercises that actually need a swap (disliked/contraindicated and present in the catalog).
  const matched = split
    .flatMap((d) => d.exercises)
    .filter((ex) => ex.exerciseId && tokens.some((tok) => `${ex.name} ${ex.canonicalName ?? ""}`.toLowerCase().includes(tok)));
  if (!matched.length) return out;
  try {
    // Prefetch the independent reads in parallel: catalog rows by id, then candidate pools by muscle.
    const catIds = [...new Set(matched.map((ex) => ex.exerciseId as string))];
    const cats = new Map<string, Awaited<ReturnType<typeof getCatalogExercise>>>(
      await Promise.all(catIds.map(async (id) => [id, await getCatalogExercise(db, id)] as const)),
    );
    const muscles = [...new Set([...cats.values()].filter(Boolean).map((c) => c!.muscle))];
    const candsByMuscle = new Map<string, CatalogExercise[]>(
      await Promise.all(
        muscles.map(
          async (m) => [m, await listCandidatesByMuscles(db, [m], { level: profile.level, perMuscle: 20, total: 20 })] as const,
        ),
      ),
    );
    // Pick sequentially so usedIds dedups picks across exercises (order-dependent — keep in-memory).
    const picks: { ex: PlanExercise; pick: CatalogExercise }[] = [];
    for (const ex of matched) {
      const cat = cats.get(ex.exerciseId as string);
      if (!cat) continue;
      const cands = candsByMuscle.get(cat.muscle) ?? [];
      const pick = cands.find((c) => !usedIds.has(c.id) && !tokens.some((tok) => c.name.toLowerCase().includes(tok)));
      if (!pick) continue;
      usedIds.add(pick.id);
      picks.push({ ex, pick });
    }
    // Batch the UK translations for the chosen replacements.
    const trById =
      lang !== "en"
        ? new Map(
            await Promise.all(
              [...new Set(picks.map((p) => p.pick.id))].map(
                async (id) => [id, await getExerciseTranslation(db, id, "uk")] as const,
              ),
            ),
          )
        : new Map();
    for (const { ex, pick } of picks) {
      let name = pick.name;
      let technique = cleanAi(pick.instructions || "");
      const tr = trById.get(pick.id);
      if (tr) { name = tr.name; technique = cleanAi(tr.instructions); }
      const repl: Partial<PlanExercise> = { name, technique, exerciseId: pick.id, canonicalName: pick.name };
      out.set((ex.canonicalName ?? ex.name).toLowerCase(), repl);
      out.set(ex.name.toLowerCase(), repl);
    }
  } catch {
    /* best-effort — keep originals */
  }
  return out;
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
    const plan = adaptPlan(bankPlan, profile, forUserId, { prs: opts.prs, replacements, authoredBy: opts.authoredBy });
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
// MIN_EXERCISES_PER_DAY — the old "1 exercise/day" bug), silently rebuild it with the
// now-validated generator and notify once. Trainer-managed client plans are left untouched.
// On any AI failure the original plan is kept (no data loss). Returns the plan to show.
export async function healPlanIfDegenerate(ctx: MyContext, plan: PlanDoc): Promise<PlanDoc> {
  if (ctx.user.role === "client") return plan;
  const degenerate = plan.split.some((d) => (d.exercises?.length ?? 0) < MIN_EXERCISES_PER_DAY);
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
  try {
    await ctx.replyWithChatAction("typing").catch(() => {});
    const { plan, source } = await buildPlanForUser(ctx, lang, profile, ctx.user._id, { prs });
    const split = plan.split;
    await setActivePlan(ctx.db, plan);
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
