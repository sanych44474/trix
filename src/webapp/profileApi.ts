// Profile / settings editing for the Mini App (roadmap P3). GET returns the editable profile
// fields plus localized option lists; POST validates a patch against the allowed enum values and
// merges it into the profile. AI replan is NOT triggered here — the plan refreshes weekly, or the
// user rebuilds it in the bot (/replan); this screen just keeps the profile in sync.
import { safeJsonParse } from "../adapters/d1/shared";
import { deleteOnboardingDraft, getOnboardingDraft, saveOnboardingDraft } from "../adapters/d1/v2OnboardingDraft";
import { CALORIE_FIELDS } from "../domain/profileGaps";
import { computeTargets, restDayTargets } from "../domain/mealplan";
import { updateActivePlanNutrition } from "../adapters/d1/v2Plans";
import { listProgressPhotos } from "../adapters/d1/v2Tracking";
import { updateUser } from "../adapters/d1/v2Users";
import { FUNNEL_FINISHED, FUNNEL_STARTED, bumpEvent } from "../adapters/d1/v2Analytics";
import { localParts } from "../domain/localTime";
import { countReferrals } from "../adapters/d1/v2Gamification";
import { botDeepLink } from "../notify/links";
import { t } from "../locales/i18n";
import { miniAppUser } from "./auth";
import { readJsonBody } from "./validate";
import type { Env, Lang, UserProfile } from "../types";
import type { TKey } from "../adapters/telegram/context";
import { finalizeOnboardingPlan } from "../features/plan/planService";
import { OB_OPTION_LABELS } from "../features/onboarding/questions";
import { DIETS, EQUIPMENT, GOALS, LEVELS, QUESTIONS } from "../domain/onboardingQuestions";
import { missingCoreFields, validateAnswers } from "../domain/onboardingAnswers";
import { typedFailure } from "./failure";

const WD_KEYS = ["", "wd_mon", "wd_tue", "wd_wed", "wd_thu", "wd_fri", "wd_sat", "wd_sun"];

const opts = <V extends string>(lang: Lang, values: readonly V[], labels: Record<V, TKey>) => values.map((value) => ({ value, label: t(lang, labels[value]) }));

export async function handleProfileApi(req: Request, url: URL, env: Env): Promise<Response> {
  const user = await miniAppUser(req, url, env);
  if (!user) return typedFailure(401, "unauthorized", "unauthorized");
  const lang = user.lang;
  const p = user.profile;

  if (req.method === "GET") {
    const [photos, referredCount] = await Promise.all([
      listProgressPhotos(env.DB, user._id, 12).catch(() => []),
      countReferrals(env.DB, user._id).catch(() => 0),
    ]);
    return Response.json(
      {
        photos: photos.map((ph) => ({ id: ph.id, takenAt: ph.takenAt.slice(0, 10) })),
        // Self-scoped by construction (no clientId delegation on this route, unlike /api/v2/
        // weekcard) -- a referral link is specific to the caller, never to a "viewed" target.
        referralLink: botDeepLink(env, `ref_${user._id}`),
        referredCount,
        profile: {
          name: p.name ?? "",
          goal: p.goal ?? "",
          level: p.level ?? "",
          equipment: p.equipment ?? "",
          dietPrefs: p.dietPrefs ?? "",
          limitations: p.limitations ?? "",
          goalWeight: p.goalWeight ?? null,
          waterGoalMl: p.waterGoalMl ?? null,
          waterEvery: p.waterEvery ?? 0,
          stepsGoal: p.stepsGoal ?? null,
          quietFrom: p.quietFrom ?? null,
          quietTo: p.quietTo ?? null,
          reminderHour: p.reminderHour ?? 9,
          trainingWeekdays: p.trainingWeekdays ?? [],
          share: user.role === "client" ? { body: !!p.shareWithTrainer?.body, health: !!p.shareWithTrainer?.health } : null,
        },
        options: { goal: opts(lang, GOALS, OB_OPTION_LABELS.goal), level: opts(lang, LEVELS, OB_OPTION_LABELS.level), equipment: opts(lang, EQUIPMENT, OB_OPTION_LABELS.equipment), diet: opts(lang, DIETS, OB_OPTION_LABELS.dietPrefs) },
        weekdays: [1, 2, 3, 4, 5, 6, 7].map((w) => ({ value: w, label: t(lang, WD_KEYS[w] as Parameters<typeof t>[1]) })),
      },
      { headers: { "cache-control": "no-store" } },
    );
  }
  if (req.method !== "POST") return typedFailure(405, "validation_error", "method not allowed");

  // This is a partial-update PATCH -- each field is independently optional and an
  // invalid/out-of-range value is silently dropped (kept at its previous value) rather than
  // rejecting the whole request, so a client sending one bad field doesn't lose every other field
  // in the same save. That's intentional and stays as hand-rolled per-field checks; readJsonBody
  // only adds the size cap this endpoint was missing.
  const parsedProfile = await readJsonBody(req);
  if (!parsedProfile.ok) return parsedProfile.response;
  const body = parsedProfile.body as Record<string, unknown>;

  // The answer fields are shared with the onboarding submit (domain/onboardingAnswers.ts). This is a
  // partial update: an invalid value is dropped and keeps its previous value, so the per-field errors
  // are not returned here.
  const { patch: answers } = validateAnswers(body, { mode: "patch", isClient: user.role === "client" });
  const patch: Partial<UserProfile> = { ...answers };
  if (typeof body.name === "string") patch.name = body.name.trim().slice(0, 60) || undefined;
  if (body.goalWeight === null || body.goalWeight === "") patch.goalWeight = undefined;
  else if (typeof body.goalWeight === "number" && body.goalWeight >= 30 && body.goalWeight <= 300) patch.goalWeight = Math.round(body.goalWeight * 10) / 10;
  if (typeof body.reminderHour === "number" && Number.isInteger(body.reminderHour) && body.reminderHour >= 0 && body.reminderHour <= 23) patch.reminderHour = body.reminderHour;
  // Personal daily goals for the activity rings; empty clears back to formula/default.
  if (body.waterGoalMl === null || body.waterGoalMl === "") patch.waterGoalMl = undefined;
  else if (typeof body.waterGoalMl === "number" && body.waterGoalMl >= 500 && body.waterGoalMl <= 8000) patch.waterGoalMl = Math.round(body.waterGoalMl / 50) * 50;
  if (body.waterEvery === 0 || body.waterEvery === null) patch.waterEvery = undefined;
  else if (body.waterEvery === 2 || body.waterEvery === 3 || body.waterEvery === 4) patch.waterEvery = body.waterEvery;
  if (body.stepsGoal === null || body.stepsGoal === "") patch.stepsGoal = undefined;
  else if (typeof body.stepsGoal === "number" && body.stepsGoal >= 1000 && body.stepsGoal <= 50000) patch.stepsGoal = Math.round(body.stepsGoal / 500) * 500;
  // Quiet hours: both bounds together or both cleared (0..23; equal = off).
  const qHour = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 23 ? v : null);
  if (body.quietFrom === null || body.quietTo === null || body.quietFrom === "" || body.quietTo === "") {
    patch.quietFrom = undefined;
    patch.quietTo = undefined;
  } else if (qHour(body.quietFrom) !== null && qHour(body.quietTo) !== null) {
    patch.quietFrom = qHour(body.quietFrom) as number;
    patch.quietTo = qHour(body.quietTo) as number;
  }
  const profile = { ...user.profile, ...patch };
  // A calorie input that was missing (defaults were in use) and is now known: recompute the
  // targets from the real numbers. Changing a value that was already set leaves the targets alone
  // -- they may carry adaptive-calorie corrections (domain/adaptiveCalories.ts) a recompute would lose.
  const filledGap = CALORIE_FIELDS.some((k) => user.profile[k] === undefined && profile[k] !== undefined);
  if (filledGap && user.onboarded) {
    const nutrition = computeTargets(profile);
    await updateUser(env.DB, user._id, { profile, nutrition });
    await updateActivePlanNutrition(env.DB, user._id, nutrition, restDayTargets(nutrition)).catch(() => {});
  } else {
    await updateUser(env.DB, user._id, { profile });
  }
  return Response.json({ ok: true });
}

// Initial onboarding as a web form (P3 optional part). Saves the same profile fields the bot's
// button wizard collects and parks the session in plan_pending — the every-minute scheduler's
// recovery sweep then generates the plan (bank-first, AI when available) and pushes "plan ready"
// to the chat, exactly like a wizard finish that hit a Worker timeout. No new AI plumbing.
const funnelEvent = (env: Env, userId: number, event: string, timezone?: string) =>
  bumpEvent(env.DB, userId, event, localParts(timezone).date).catch(() => {});

export async function handleOnboardingApi(req: Request, url: URL, env: Env, ctx?: ExecutionContext): Promise<Response> {
  const user = await miniAppUser(req, url, env);
  if (!user) return typedFailure(401, "unauthorized", "unauthorized");

  // The question set both apps render (domain/onboardingQuestions.ts); they evaluate showWhen themselves.
  if (url.pathname.endsWith("/onboarding/questions")) {
    if (req.method !== "GET") return typedFailure(405, "validation_error", "method not allowed");
    return Response.json({ questions: QUESTIONS }, { headers: { "cache-control": "no-store" } });
  }

  // The questionnaire's draft: saved while the person answers, read back on another device.
  if (url.pathname.endsWith("/onboarding/draft")) {
    if (req.method === "GET") {
      const draft = user.onboarded ? null : await getOnboardingDraft(env.DB, user._id).catch(() => null);
      return Response.json({ answers: draft ? safeJsonParse<Record<string, unknown>>(draft.answers, {}) : null }, { headers: { "cache-control": "no-store" } });
    }
    if (req.method !== "POST") return typedFailure(405, "validation_error", "method not allowed");
    if (user.onboarded) return Response.json({ ok: true });
    const parsedDraft = await readJsonBody(req);
    if (!parsedDraft.ok) return parsedDraft.response;
    const d = parsedDraft.body as { answers?: unknown; answered?: unknown; total?: unknown };
    const answers = d.answers && typeof d.answers === "object" && !Array.isArray(d.answers) ? JSON.stringify(d.answers) : "";
    const total = Number(d.total);
    const answered = Number(d.answered);
    if (!answers || answers.length > 4096 || !Number.isInteger(total) || total < 1 || total > 30 || !Number.isInteger(answered) || answered < 0 || answered > total) {
      return typedFailure(400, "validation_error", "bad request");
    }
    // The first saved answer is the form's funnel "started" (the bot wizard counts its own); later
    // saves of the same draft are not.
    const prior = answered > 0 ? await getOnboardingDraft(env.DB, user._id).catch(() => null) : null;
    await saveOnboardingDraft(env.DB, user._id, answers, answered, total);
    if (answered > 0 && !(prior && prior.answered > 0)) await funnelEvent(env, user._id, FUNNEL_STARTED, user.profile.timezone);
    return Response.json({ ok: true });
  }

  if (req.method !== "POST") return typedFailure(405, "validation_error", "method not allowed");
  if (user.onboarded) return typedFailure(400, "validation_error", "already onboarded");

  const parsedOb = await readJsonBody(req);
  if (!parsedOb.ok) return parsedOb.response;
  const body = parsedOb.body as Record<string, unknown>;

  // The same answer fields the Mini App's PATCH takes, plus the onboarding-only ones (domain/onboardingAnswers.ts).
  // An invalid optional answer is dropped, as before; `fields` names the answers that were not accepted.
  const { patch, errors } = validateAnswers(body, { mode: "onboarding", isClient: user.role === "client", currentTimezone: user.profile.timezone });
  // The wizard's required core: without these the plan generator can't do a decent job.
  const merged = { ...user.profile, ...patch };
  if (missingCoreFields(merged).length) return typedFailure(400, "validation_error", "incomplete", { fields: errors });
  if (merged.limitations === undefined) merged.limitations = "none";
  await updateUser(env.DB, user._id, { profile: merged, session: { mode: "plan_pending" } });
  await deleteOnboardingDraft(env.DB, user._id).catch(() => {});
  await funnelEvent(env, user._id, FUNNEL_FINISHED, merged.timezone);
  // Build the plan now (AI first, bank fallback) instead of waiting for the recovery sweep, which
  // only picks users pending for 90s+ and builds the bank plan. A failure leaves plan_pending, so
  // the sweep still converges.
  ctx?.waitUntil(finalizeOnboardingPlan(env, env.DB, { ...user, profile: merged, session: { mode: "plan_pending" } }).catch(() => false));
  return Response.json({ ok: true, pending: true });
}
