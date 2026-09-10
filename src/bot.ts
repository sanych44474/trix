import { InlineKeyboard, InputFile, Keyboard, type Context } from "grammy";
import type { CatalogExercise, Env, ExerciseMetric, ExerciseVideo, Lang, NutritionTargets, PlanDay, PlanDoc, PlanExercise, Supplement, UserDoc, Weekday } from "./types";
import { appendMeals, getDayMeals, setDayMeals, getRecentFoods, deleteMealItem, bodyLogsByUser, countCompletedWorkouts, recordError, getCatalogExercise, getExerciseTranslation, upsertExerciseTranslation, getExerciseVideos, getUserVideos, listAchievements, searchExercisesByName, dailyCheckinsSince, getDailyCheckin, getActivePlan, getTrainer, getUser, listStrength, pendingRequestForClient, updateActivePlanSplit, nutritionLogsSince, saveDraftPlan, getStepLog, addWater, setWater, getWater, userStatCounts, upsertExercise, upsertBodyLog, upsertStepLog, updateUser, workoutLogsSince } from "./db/repos";
import { cleanAi, escapeHtml, LANG_NAME, t } from "./locales/i18n";
import { aiJSON, aiText } from "./ai";
import { computeTargets } from "./domain/mealplan";
import * as P from "./ai/prompts";
import { buildActivityCells, deloadDue, deloadSets, mesocyclePhase, getPlanDay, localParts, parseMeasurements, parseHeightWeight, parseSteps, parseWorkoutText, readinessAdvice, shouldDeload, weeksSincePlan, exerciseMetric, formatRecordBest } from "./domain/progression";
import { e1rm, weekStartStr, weekStreak } from "./domain/records";
import { conditioningLoadLabel, exerciseVideoKey, renderActivityGrid, renderBoard, renderPlan, renderSchedule, renderStrength, exerciseChart, wellbeingChart, renderToday, upcomingSessions, weekdayName } from "./render";
import { strengthStandard, type StrengthLevel } from "./domain/standards";
import { cmdReport, localCutoff } from "./bot/report";
import { cmdReplan, prDate } from "./bot/exportData";
import { resumePendingPlan } from "./bot/planGen";
import { num, verifyItems } from "./bot/nutritionLog";
import { renderDayInline } from "./bot/workoutSave";
import { isOwner } from "./bot/owner";
import { joinByCode, joinByProspectCode, showSharedProgram, showPlanEditDay, trainerMenu } from "./bot/trainer";
export { buildOwnerReport, buildErrorReport } from "./bot/owner";
// Extracted modules — imported for internal use AND re-exported so every existing consumer
// (scheduler, webapp, tests) keeps importing from "./bot" unchanged.
import { computeBoards, isoDateMinus, recordsTabs, renderBadges } from "./bot/boards";
import { buildWeekCard } from "./bot/weekCard";
import { showEveningSurvey } from "./bot/survey";
import { onboardingStep, renderObStep } from "./bot/onboarding";
export * from "./bot/boards";
export * from "./bot/weekCard";
export * from "./bot/survey";
export * from "./bot/onboarding";
import { mainMenu, moreMenu, progressHubMenu, trainerHubMenu, trainerClientsMenu, appendOwnerRow, menuBtn, planViewKb, langMenu, hourMenu, tzMenu, settingsMenu, difficultyKeyboard, todayWorkoutKeyboard } from "./bot/keyboards";
export * from "./bot/keyboards";
import { botDeepLink } from "./bot/links";
import { healPlanIfDegenerate } from "./bot/plan";
export * from "./bot/plan";
import { deferAi, onError } from "./bot/router";
export * from "./bot/router";
export * from "./bot/challenges";
export * from "./bot/vacation";
export * from "./bot/injury";
export * from "./bot/cleanup";
export * from "./bot/cycle";
export * from "./bot/shareConsent";
export * from "./bot/calendar";
export * from "./bot/planDays";
export * from "./bot/report";
export * from "./bot/exportData";
export * from "./bot/planGen";
export * from "./bot/nutritionLog";
export * from "./bot/coach";
export * from "./bot/workoutSave";
export * from "./bot/feedbackIntake";
export * from "./bot/logSelfEdit";
export * from "./bot/warmup";
export * from "./bot/planExerciseEdit";
export * from "./bot/guidedLog";
import { endSelfEdit, swapExerciseByName } from "./bot/planExerciseEdit";
import { cmdLog } from "./bot/guidedLog";

import { computeXp, levelFromXp } from "./domain/gamification";
import { switchMode } from "./domain/session";
import { weeklyVolume, projectWeight, stalledLifts, type MuscleVolume } from "./domain/analysis";
import { conditioningWeek, readinessWithConditioning, recentConditioningStrain } from "./domain/conditioning";
import { platePlan, warmupRamp } from "./domain/calc";
import { showInjuryMenu } from "./bot/injury";
import { progressBar, resolveWaterGoal } from "./domain/challenges";
import { lookupExerciseVideoCached } from "./youtube";
import { APP_VERSION } from "./webapp/appVersion";

export const COMMON_TZ = [
  "Europe/Kyiv",
  "Europe/Warsaw",
  "Europe/London",
  "Europe/Berlin",
  "America/New_York",
  "UTC",
];

export type MyContext = Context & {
  env: Env;
  db: D1Database;
  user: UserDoc;
  // Defer heavy background work past the webhook response (Cloudflare ExecutionContext.waitUntil).
  // Falls back to fire-and-forget if no ExecutionContext was provided (e.g. tests).
  waitUntil: (p: Promise<unknown>) => void;
};

export const HTML = { parse_mode: "HTML" as const, link_preview_options: { is_disabled: true } };
export const REPORT_DAYS = 14;

// A valid training day must carry a full session — used to reject degenerate AI plans.
export const MIN_EXERCISES_PER_DAY = 5;

export interface AiPlan {
  split: {
    weekday: number;
    muscleGroup: string;
    sessionType?: string;
    durationMin?: number;
    warmUp?: string[];
    coolDown?: string[];
    exercises: {
      name: string;
      sets: string;
      startWeight: string;
      technique: string;
      muscles?: string;
      isKeyLift?: boolean;
      metric?: string;
      exerciseId?: string;
      canonicalName?: string;
      rpe?: string;
      rir?: string;
      rest?: string;
      tempo?: string;
      heartRateZone?: string;
      movementPattern?: string;
      role?: string;
      warmupScheme?: string;
      supersetGroup?: string;
    }[];
  }[];
  nutrition: NutritionTargets;
  restDayNutrition?: NutritionTargets;
  supplements: Supplement[];
  methodology: string;
  movementAudit?: string;
  stepsTarget?: number;
}

export function defaultLang(code?: string): Lang {
  return code?.toLowerCase().startsWith("uk") ? "uk" : "en";
}

// Reduce a callback_data string to a stable analytics key: drop numeric ids and dates, keep the
// first two meaningful segments. "cl:123:plan"→"cl:plan", "vid:pick:0"→"vid:pick", "menu:plan" stays.
export function normalizeEvent(data: string): string {
  const parts = data.split(":").filter((p) => p && !/^\d+$/.test(p) && !/^\d{4}-\d{2}-\d{2}$/.test(p));
  return parts.slice(0, 2).join(":") || "other";
}

// Mini App base URL, captured once in createBot so pure keyboard builders can use it without
// threading env through every call site. Undefined (e.g. local dev) hides the dashboard buttons.
export let APP_URL: string | undefined;
// Setter so the extracted router module can populate this module-owned binding at bot startup
// (an imported binding can't be assigned to across modules).
export function setAppUrl(v: string | undefined): void { APP_URL = v; }

export function dashboardUrl(): string | undefined {
  return APP_URL ? `${APP_URL}/app?v=${APP_VERSION}` : undefined;
}



export async function showMoreMenu(ctx: MyContext) {
  await reply(ctx, t(ctx.user.lang, "more_title"), moreMenu(ctx.user.lang, ctx.user.role === "solo"));
}


export async function showProgressHub(ctx: MyContext) {
  await reply(ctx, t(ctx.user.lang, "proghub_title"), progressHubMenu(ctx.user.lang));
}

// ================= Solo self-correct: user rewrites a past workout / nutrition day =================
// Mirrors the trainer's clog* flow but scoped to ctx.user._id so a solo athlete who logged the
// wrong weight (or wrong meal) yesterday doesn't have to wait for a coach. Both surfaces list the
// same 30-day window; picking a day shows a summary + a "Rewrite" button that re-parses the whole
// day in one message.

// Moved to bot/logSelfEdit.ts (god-file split); re-exported below so existing from "./bot"
// imports (router.ts) keep working.

// startMealMacroEdit/handleMealMacroEdit moved to bot/logSelfEdit.ts (they end by calling
// showMyLogNutritionDay, defined there) — re-exported via the barrel below.

// cmdTrainerReport/cmdTrainerBroadcast/handleTrainerBroadcast moved to bot/trainer.ts;
// showOwnerHub moved to bot/owner.ts; difficultyKeyboard/todayWorkoutKeyboard/difficultyLabel
// moved to bot/keyboards.ts — each belongs to that file's existing concept, not this one.
// Re-exported via the barrel below.

// Persistent bottom button menu (reply keyboard) — always visible after onboarding.
// Map a tapped reply-keyboard label (in the user's language) to its command.
// Kept so a lingering legacy bottom keyboard (pre-update users) still routes correctly
// until ReplyKeyboardRemove clears it on their next plain reply.
export function menuActionFor(lang: Lang, text: string): ((c: MyContext) => Promise<void>) | undefined {
  const map: Record<string, (c: MyContext) => Promise<void>> = {
    [t(lang, "menu_today")]: cmdToday,
    [t(lang, "menu_plan")]: cmdPlan,
    [t(lang, "menu_log")]: cmdLog,
    [t(lang, "menu_progress")]: cmdProgress,
    [t(lang, "menu_nutrition")]: cmdNutrition,
    [t(lang, "menu_measure")]: cmdMeasure,
    [t(lang, "menu_steps")]: cmdSteps,
    [t(lang, "menu_report")]: cmdReport,
    [t(lang, "menu_coach")]: cmdCoach,
    [t(lang, "menu_feedback")]: cmdFeedback,
    [t(lang, "menu_help")]: cmdHelp,
    [t(lang, "menu_settings")]: cmdSettings,
    [t(lang, "menu_hide")]: cmdHideKeyboard,
  };
  return map[text];
}

// Open the menu — a single inline keyboard composed as common base + role extras.
// Everyone gets the full athlete menu; trainers/owner get extra rows appended (a user can
// be both a trainer AND the owner, so the rows are additive, not exclusive).
export async function cmdMenu(ctx: MyContext) {
  await clearEditOwner(ctx);
  const lang = ctx.user.lang;
  const owner = await isOwner(ctx);
  // Trainers get a compact hub (own training vs clients vs profile); everyone else the full
  // athlete menu. The owner row is additive in both cases.
  if (ctx.user.role === "trainer") {
    const kb = trainerHubMenu(lang);
    // Instructors (owner-granted) + owner get the "share a program" entry.
    const tr = await getTrainer(ctx.db, ctx.user._id).catch(() => null);
    if (owner || tr?.isInstructor) kb.row().text(t(lang, "menu_share_program"), "menu:share");
    if (owner) appendOwnerRow(kb, lang);
    await ctx.reply(t(lang, "trainer_hub_title"), { ...HTML, reply_markup: kb });
    return;
  }
  const kb = mainMenu(lang);
  // Find-a-trainer / become-a-trainer moved into the "More" screen (moreMenu) to keep the
  // top level light; the owner entry stays here as a single hub button.
  if (owner) appendOwnerRow(kb, lang);
  await ctx.reply(t(lang, "menu_title"), { ...HTML, reply_markup: kb });
}

// Trainer hub → "My training": the trainer's OWN athlete side (separate entity from their coach
// profile). If they never did the athlete interview, offer to start it; otherwise the full menu.
export async function showAthleteMenu(ctx: MyContext) {
  const lang = ctx.user.lang;
  if (!ctx.user.onboarded) {
    const kb = new InlineKeyboard()
      .text(t(lang, "tr_start_athlete"), "role:ai")
      .row()
      .text(t(lang, "tr_back_hub"), "menu:open");
    await ctx.reply(t(lang, "tr_athlete_intro"), { ...HTML, reply_markup: kb });
    return;
  }
  const kb = mainMenu(lang).row().text(t(lang, "tr_back_hub"), "menu:open");
  await ctx.reply(t(lang, "menu_title"), { ...HTML, reply_markup: kb });
}

// Trainer hub → "Clients": client list + incoming requests.
export async function showTrainerClientsMenu(ctx: MyContext) {
  const lang = ctx.user.lang;
  await ctx.reply(t(lang, "tr_clients_title"), { ...HTML, reply_markup: trainerClientsMenu(lang) });
}

// Hide the button menu (remove the reply keyboard).
export async function cmdHideKeyboard(ctx: MyContext) {
  await ctx.reply(t(ctx.user.lang, "kbd_hidden"), { ...HTML, reply_markup: { remove_keyboard: true } });
}

export async function reply(ctx: MyContext, text: string, kb?: InlineKeyboard | Keyboard) {
  await sendLong(ctx, text, kb);
}

// Telegram caps messages at 4096 chars; split on newlines if needed.
// When a reply carries no inline keyboard we send ReplyKeyboardRemove so the
// legacy persistent bottom keyboard is cleared (the menu is the inline button now).
export async function sendLong(ctx: MyContext, text: string, kb?: InlineKeyboard | Keyboard) {
  const LIMIT = 3800;
  const tail = kb ? { reply_markup: kb } : { reply_markup: { remove_keyboard: true } as const };
  if (text.length <= LIMIT) {
    await ctx.reply(text, { ...HTML, ...tail });
    return;
  }
  const chunks: string[] = [];
  let buf = "";
  for (const block of text.split("\n")) {
    if ((buf + "\n" + block).length > LIMIT) {
      chunks.push(buf);
      buf = block;
    } else {
      buf = buf ? buf + "\n" + block : block;
    }
  }
  if (buf) chunks.push(buf);
  for (let i = 0; i < chunks.length; i++) {
    const last = i === chunks.length - 1;
    await ctx.reply(chunks[i], { ...HTML, ...(last ? tail : {}) });
  }
}

export async function setMode(ctx: MyContext, mode: UserDoc["session"]["mode"]) {
  // switchMode carries the context fields (editPlanOwner/editPlanPrefix/photoReviewFor) and
  // drops all transient flow state — see domain/session.ts for why this lives in one place.
  const session = switchMode(ctx.user.session, mode);
  await updateUser(ctx.db, ctx.user._id, { session });
  ctx.user.session = session;
}

// Whose plan the current plan-EDIT operation targets: a managed client (trainer/owner) or self.
export function planOwnerId(ctx: MyContext): number {
  return ctx.user.session.editPlanOwner ?? ctx.user._id;
}

// Fetch the active plan for the current edit target (managed client or self); if there is none,
// send the standard "no plan" reply and return undefined — the caller should then `return`.
export async function getActivePlanOrReply(
  ctx: MyContext,
  ownerId = planOwnerId(ctx),
): Promise<Awaited<ReturnType<typeof getActivePlan>>> {
  const plan = await getActivePlan(ctx.db, ownerId);
  if (!plan) await reply(ctx, t(ctx.user.lang, "no_plan"), menuBtn(ctx.user.lang));
  return plan;
}

// A weekday + exercise index packed into a single numeric session.targetId (weekday*1000 + idx).
export function encodePlanRef(weekday: number, index: number): number {
  return weekday * 1000 + index;
}
export function decodePlanRef(ref: number): { weekday: number; index: number } {
  return { weekday: Math.floor(ref / 1000), index: ref % 1000 };
}

// The LANGUAGE of the plan owner — so a trainer/owner editing a client's plan persists the
// client's exercise names in the CLIENT's language, not the editor's.
export async function planOwnerLang(ctx: MyContext): Promise<Lang> {
  const owner = ctx.user.session.editPlanOwner;
  if (owner === undefined || owner === ctx.user._id) return ctx.user.lang;
  const u = await getUser(ctx.db, owner);
  return u?.lang ?? ctx.user.lang;
}

// Begin editing another user's plan (trainer→client / owner→anyone). Sets the edit context.
// `prefix` records which card owns the edit ("cl"/"ou") so post-action re-renders can rebuild
// the edit-day keyboard instead of the self logging view.
export async function setEditOwner(ctx: MyContext, ownerId: number | undefined, prefix?: "cl" | "ou") {
  const session = { ...ctx.user.session, editPlanOwner: ownerId, editPlanPrefix: prefix };
  if (ownerId === undefined) { delete session.editPlanOwner; delete session.editPlanPrefix; }
  await updateUser(ctx.db, ctx.user._id, { session });
  ctx.user.session = session;
}

// True when the current edit targets someone else's plan (trainer→client / owner→user), so
// the shared edit handlers must render the edit-day view, never the self "log workout" view.
export function isEditingOther(ctx: MyContext): boolean {
  return ctx.user.session.editPlanOwner !== undefined && ctx.user.session.editPlanOwner !== ctx.user._id;
}

// Re-show the managed user's edit-day view after a shared edit action (delete/swap/…), so the
// trainer/owner stays in the client's plan instead of being dropped into their OWN today view.
export async function reRenderEditDay(ctx: MyContext, weekday: Weekday) {
  const owner = ctx.user.session.editPlanOwner;
  const prefix = ctx.user.session.editPlanPrefix ?? "cl";
  if (owner === undefined) return;
  await showPlanEditDay(ctx, owner, prefix, weekday);
}

// Clear any "editing someone else's plan" context (called when the user navigates to their
// own home / today / menu so self-edits never leak onto a managed client).
export async function clearEditOwner(ctx: MyContext) {
  if (ctx.user.session.editPlanOwner === undefined) return;
  await setEditOwner(ctx, undefined);
}

// ---------------- command implementations ----------------


// Start (or restart) the deterministic button-based intake wizard (no per-turn AI).
export async function startInterview(ctx: MyContext) {
  await updateUser(ctx.db, ctx.user._id, { session: { mode: "onboarding", step: 0 } });
  ctx.user.session = { mode: "onboarding", step: 0 };
  await renderObStep(ctx, 0);
}

// Menu: continue an in-progress interview, or restart the intake to rebuild the plan.
export async function cmdInterview(ctx: MyContext) {
  const lang = ctx.user.lang;
  if (ctx.user.session.mode === "onboarding") {
    await onboardingStep(ctx); // resume where they left off
    return;
  }
  await reply(ctx, t(lang, "interview_restart"));
  await startInterview(ctx);
}

export async function cmdStart(ctx: MyContext, payload?: string) {
  await clearEditOwner(ctx);
  const u = ctx.user;
  const lang = u.lang;
  const hi = u.profile.name ? `${escapeHtml(u.profile.name)}! ` : "";

  // Deep link to a shared program → preview + "take it".
  if (payload?.startsWith("prog_")) {
    await showSharedProgram(ctx, payload.slice(5));
    return;
  }
  // Deep link from a trainer's invite → auto-pair.
  if (payload?.startsWith("tr_")) {
    await joinByCode(ctx, payload.slice(3));
    return;
  }
  // Personal invite for one named prospect ("add a client" — see trainer.ts joinByProspectCode).
  if (payload?.startsWith("trp_")) {
    await joinByProspectCode(ctx, payload.slice(4));
    return;
  }
  // Referral link: remember who invited (once, and only before onboarding — no retro-claims).
  // Falls through to the normal start flow; the inviter's reward fires when this user onboards.
  if (payload?.startsWith("ref_")) {
    const inviter = Number(payload.slice(4));
    if (Number.isFinite(inviter) && inviter > 0 && inviter !== u._id && !u.onboarded && !u.profile.referredBy) {
      u.profile = { ...u.profile, referredBy: inviter };
      await updateUser(ctx.db, u._id, { profile: u.profile }).catch(() => {});
    }
  }
  // Accountability buddy link: pair two users mutually so each sees the other's weekly activity.
  if (payload?.startsWith("buddy_")) {
    const mate = Number(payload.slice(6));
    if (Number.isFinite(mate) && mate > 0 && mate !== u._id) {
      const other = await getUser(ctx.db, mate).catch(() => null);
      if (other) {
        // Re-pairing with someone new must not leave a stale, one-sided link behind: if either
        // side already has a DIFFERENT buddy, unlink that old buddy first (only if the old
        // buddy's own link still points back — don't clobber a third party's unrelated state).
        // Otherwise the old buddy's buddyId keeps pointing at someone who's moved on, which the
        // weekly duel sweep (allBuddyPairs) would otherwise have to defend against on its own.
        const unlinkOldBuddyOf = async (person: UserDoc) => {
          const oldId = person.profile.buddyId;
          if (!oldId || oldId === mate || oldId === u._id) return;
          const old = await getUser(ctx.db, oldId).catch(() => null);
          if (old && old.profile.buddyId === person._id) {
            await updateUser(ctx.db, old._id, { profile: { ...old.profile, buddyId: undefined } }).catch(() => {});
          }
        };
        await Promise.all([unlinkOldBuddyOf(u), unlinkOldBuddyOf(other)]);
        u.profile = { ...u.profile, buddyId: mate };
        await updateUser(ctx.db, u._id, { profile: u.profile }).catch(() => {});
        await updateUser(ctx.db, mate, { profile: { ...other.profile, buddyId: u._id } }).catch(() => {});
        await reply(ctx, t(lang, "buddy_paired", { name: escapeHtml(other.profile.name ?? `id ${mate}`) })).catch(() => {});
        await ctx.api.sendMessage(other.chatId, t(other.lang, "buddy_paired", { name: escapeHtml(u.profile.name ?? `id ${u._id}`) }), HTML).catch(() => {});
      }
    }
  }
  if (u.session.mode === "plan_pending") {
    await resumePendingPlan(ctx);
    return;
  }
  if (u.role === "trainer") {
    await reply(ctx, hi + t(lang, "trainer_home"), trainerMenu(lang));
    return;
  }
  if (u.role === "client") {
    await reply(ctx, hi + t(lang, "welcome_back"), mainMenu(lang));
    return;
  }
  // solo
  const pending = await pendingRequestForClient(ctx.db, u._id);
  if (pending) {
    const tr = await getUser(ctx.db, pending.trainerId);
    const kb = new InlineKeyboard().text(t(lang, "req_cancel"), `req:cancel:${pending.id}`);
    await reply(ctx, t(lang, "req_waiting", { name: escapeHtml(tr?.profile.name ?? "trainer") }), kb);
    return;
  }
  if (u.onboarded) {
    await reply(ctx, hi + t(lang, "welcome_back"), mainMenu(lang));
    return;
  }
  // Stuck mid-interview (started but never finished) → resume and re-send the current
  // question instead of bouncing back to the language picker and losing their answers.
  if (u.session.mode === "onboarding") {
    await reply(ctx, t(lang, "interview_resume"));
    await onboardingStep(ctx);
    return;
  }
  // brand new → ask LANGUAGE first; the lang choice then leads to disclaimer + role choice.
  await reply(ctx, t(lang, "choose_language"), langMenu());
}

export async function cmdHelp(ctx: MyContext) {
  const lang = ctx.user.lang;
  const body =
    ctx.user.role === "trainer"
      ? t(lang, "help_body_trainer")
      : ctx.user.role === "client"
        ? t(lang, "help_body_client")
        : t(lang, "help_body");
  await reply(ctx, `${t(lang, "help_title")}\n\n${t(lang, "help_modes")}\n\n${body}`, menuBtn(lang));
}

// Cached technique videos for the exercises in the given days, for rendering. Any exercise that
// has never been searched is queued for a background YouTube lookup (fire-and-forget, stops on
// quota) so it appears on the next view — the current render is never blocked or slowed.
export async function videosForDays(ctx: MyContext, days: PlanDay[]): Promise<Map<string, ExerciseVideo>> {
  const keys = [...new Set(days.flatMap((d) => d.exercises.map((e) => exerciseVideoKey(e))))];
  if (!keys.length) return new Map();
  const map = await getExerciseVideos(ctx.db, keys).catch(() => new Map<string, ExerciseVideo>());
  // A viewer's personal override (set via 🎥 Відео) wins over the shared/global video.
  const overrides = await getUserVideos(ctx.db, ctx.user._id, keys).catch(() => new Map<string, ExerciseVideo>());
  for (const [k, v] of overrides) map.set(k, v);
  // Route links through the Worker's /v redirect so opens are counted (video_open event).
  // Only when deployed (APP_URL set) — local dev keeps direct links.
  if (APP_URL) {
    for (const [k, v] of map) {
      if (v.url) map.set(k, { ...v, url: `${APP_URL}/v?u=${encodeURIComponent(v.url)}&uid=${ctx.user._id}` });
    }
  }
  if (ctx.env.YOUTUBE_API_KEY) {
    const missing = days.flatMap((d) => d.exercises).filter((e) => !map.has(exerciseVideoKey(e)));
    if (missing.length) {
      ctx.waitUntil(
        (async () => {
          const seen = new Set<string>();
          for (const e of missing) {
            const k = exerciseVideoKey(e);
            if (seen.has(k)) continue;
            seen.add(k);
            try {
              await lookupExerciseVideoCached(ctx.db, ctx.env, e.canonicalName || e.name);
            } catch {
              break; // quota (or other error) — stop the batch
            }
          }
        })(),
      );
    }
  }
  return map;
}

export async function cmdPlan(ctx: MyContext) {
  await clearEditOwner(ctx);
  const lang = ctx.user.lang;
  let plan = await getActivePlan(ctx.db, ctx.user._id);
  if (!plan) {
    await reply(ctx, t(lang, "no_plan"));
    return;
  }
  plan = await healPlanIfDegenerate(ctx, plan);
  plan = await healPlanNamesForDisplay(ctx, plan, lang);
  await reply(ctx, renderPlan(lang, plan, await videosForDays(ctx, plan.split)), planViewKb(lang));
}

// Instructions + safety for an exercise in the user's language. English is served straight
// from the catalog; other languages are translated on first use and cached so /today is
// instant afterwards. Falls back to the English original if translation fails.
export async function exerciseInfoEntry(
  ctx: MyContext,
  exerciseId: string,
  lang: Lang,
): Promise<{ name: string; instructions: string; safety: string } | null> {
  const catalog = await getCatalogExercise(ctx.db, exerciseId);
  if (!catalog) return null;
  if (lang === "en") return { name: catalog.name, instructions: catalog.instructions, safety: catalog.safetyInfo };
  const cached = await getExerciseTranslation(ctx.db, exerciseId, lang);
  // A name-only seed (curated names, empty instructions) is a partial cache: keep the curated
  // name but still translate the technique/safety on first view, then store the full row.
  if (cached && cached.instructions) return { name: cached.name, instructions: cached.instructions, safety: cached.safetyInfo };
  try {
    const tr = await aiJSON<P.ExerciseInfoResult>(ctx.env, {
      system: P.exerciseInfoSystem(lang),
      user: P.exerciseInfoUser(catalog.name, catalog.instructions, catalog.safetyInfo),
      schema: P.EXERCISE_INFO_SCHEMA,
      temperature: 0.2,
      kind: "translate",
      db: ctx.db,
      userId: ctx.user._id,
    });
    const out = {
      // Prefer a curated seeded name over the AI's; only fall back to AI/English when unseeded.
      name: (cached?.name && cleanAi(cached.name)) || cleanAi(tr.name) || catalog.name,
      instructions: cleanAi(tr.instructions),
      safety: cleanAi(tr.safety),
    };
    await upsertExerciseTranslation(ctx.db, exerciseId, lang, {
      name: out.name,
      instructions: out.instructions,
      safetyInfo: out.safety,
    });
    return out;
  } catch {
    return { name: catalog.name, instructions: catalog.instructions, safety: catalog.safetyInfo };
  }
}

export async function translateExerciseQueryToEnglish(ctx: MyContext, query: string): Promise<string> {
  if (ctx.user.lang === "en") return query.trim();
  try {
    const translated = await aiText(ctx.env, {
      system:
        "Translate exercise names and movement names to canonical English gym terminology only. Return only the English exercise name, with no explanation, punctuation, or quotes.",
      user: query,
      temperature: 0.2,
      kind: "translate",
      db: ctx.db,
      userId: ctx.user._id,
    });
    return cleanAi(translated) || query.trim();
  } catch {
    return query.trim();
  }
}

export function extractExerciseQuery(text: string): string {
  const trimmed = text.trim().replace(/\s+/g, " ");
  if (!trimmed) return trimmed;

  const parsed = parseWorkoutText(trimmed);
  if (parsed.length > 0 && parsed[0].exercise.trim()) {
    return parsed[0].exercise.trim();
  }

  const markers = [
    /\b\d+(?:[.,]\d+)?\s*[xх×•·]\s*\d+\b/iu,
    /\b\d+(?:[.,]\d+)?\s*(?:kg|кг)\b/iu,
    /\b\d+\s*підход[а-я]*\b/iu,
    /\b\d+\s*раз[а-я]*\b/iu,
    /\b(?:bw|bodyweight|власна|своя)\b/iu,
  ];
  let cut = trimmed.length;
  for (const re of markers) {
    const match = trimmed.match(re);
    if (match?.index !== undefined) cut = Math.min(cut, match.index);
  }
  return trimmed.slice(0, cut).replace(/[\s,;:–—•·-]+$/u, "").trim() || trimmed;
}

// Drop the implement/equipment qualifier so a movement matches regardless of dumbbell/kettlebell/
// barbell/machine — e.g. "goblet squat with dumbbell" / "присідання кубком з гантеллю" → "goblet squat".
export function stripEquipmentWords(s: string): string {
  return s
    .replace(/\b(?:dumbbells?|kettlebells?|barbells?|cable|machine|smith|resistance bands?|band|plate)\b/gi, " ")
    .replace(/\bз\s+(?:гантел\w*|гир\w*)\b/giu, " ")
    .replace(/\bзі?\s+штанг\w*\b/giu, " ")
    .replace(/\b(?:на|у|в)\s+тренажер\w*\b/giu, " ")
    .replace(/\b(?:with|using|on)\b/gi, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export async function searchExerciseCatalog(ctx: MyContext, query: string, limit = 5): Promise<CatalogExercise[]> {
  const cleaned = extractExerciseQuery(query);
  const english = await translateExerciseQueryToEnglish(ctx, cleaned);
  // Specific phrasings first; the equipment-stripped forms are last-resort so exact matches win
  // and we still find the movement (not a near-duplicate) when only the implement differs.
  const variants = [...new Set(
    [english, cleaned, query, stripEquipmentWords(english), stripEquipmentWords(cleaned)]
      .map((q) => q.trim())
      .filter(Boolean),
  )];
  for (const q of variants) {
    const found = await searchExercisesByName(ctx.db, q, limit, ctx.user.lang);
    if (found.length) return found;
  }
  return [];
}

export async function promptExerciseConfirmation(
  ctx: MyContext,
  payload: {
    action: "swap" | "add";
    weekday: Weekday;
    query: string;
    englishQuery: string;
    catalog: CatalogExercise;
    index?: number;
  },
) {
  const lang = ctx.user.lang;
  const localized = lang === "en" ? payload.catalog.name : (await exerciseInfoEntry(ctx, payload.catalog.id, lang))?.name ?? payload.catalog.name;
  const session = switchMode(ctx.user.session, "exercise_confirm", {
    pendingExercise: {
      action: payload.action,
      weekday: payload.weekday,
      index: payload.index,
      query: payload.query,
      englishQuery: payload.englishQuery,
      catalogId: payload.catalog.id,
    },
  });
  await updateUser(ctx.db, ctx.user._id, { session });
  ctx.user.session = session;
  const kb = new InlineKeyboard()
    .text(t(lang, "confirm_yes"), "ex:yes")
    .text(t(lang, "confirm_no"), "ex:no");
  await reply(ctx, t(lang, "exercise_confirm_question", { name: localized }), kb);
}

// After a swap/add, offer the new exercise's weight & sets right away — the replacement
// almost always needs different numbers, and these are the same wt:/st: flows the day editor uses.
export function swapTuneKb(lang: Lang, weekday: Weekday, index: number): InlineKeyboard {
  return new InlineKeyboard()
    .text(t(lang, "plan_diff_edit_weight"), `wt:${weekday}:${index}`)
    .text(t(lang, "plan_diff_edit_sets"), `st:${weekday}:${index}`);
}

export async function applyCatalogExerciseChoice(
  ctx: MyContext,
  payload: NonNullable<MyContext["user"]["session"]["pendingExercise"]>,
  catalog: CatalogExercise,
) {
  const lang = ctx.user.lang;
  const plan = await getActivePlan(ctx.db, planOwnerId(ctx));
  if (!plan) {
    await reply(ctx, t(lang, "no_plan"), menuBtn(lang));
    return;
  }
  const day = getPlanDay(plan, payload.weekday);
  if (!day) {
    await reply(ctx, t(lang, "error_generic"), menuBtn(lang));
    return;
  }
  // Localize the single new exercise directly from the (cached) catalog translation — the same
  // entry the confirmation showed. This is deterministic and avoids running the whole split
  // through the bulk AI translator, which could fail and leave the exercise in English.
  const oLang = await planOwnerLang(ctx);
  const info = oLang === "en" ? null : await exerciseInfoEntry(ctx, catalog.id, oLang).catch(() => null);
  const exName = info?.name || catalog.name;
  const exTech = info?.instructions || catalog.instructions;
  // Classify the NEW exercise by its canonical name so a plank/cardio swapped or added via the
  // catalog gets the right metric + sensible default sets — not the reps scheme it replaced.
  const metric = exerciseMetric({ name: catalog.name });
  const timed = metric !== "reps";
  let fromName = "";
  if (payload.action === "swap") {
    const current = payload.index !== undefined ? day.exercises[payload.index] : undefined;
    if (!current) {
      await reply(ctx, t(lang, "error_generic"), menuBtn(lang));
      return;
    }
    fromName = current.name;
    day.exercises[payload.index!] = {
      exerciseId: catalog.id,
      canonicalName: catalog.name,
      name: exName,
      // Keep the rep scheme for a like-for-like reps swap, but never carry the old absolute load
      // (e.g. a 100 kg back squat → goblet squat). Timed/cardio get their own default sets.
      sets: timed ? defaultSetsForMetric(metric, catalog) : current.sets,
      startWeight: timed ? "Bodyweight" : defaultStartWeightForExercise(catalog),
      technique: exTech || current.technique,
      isKeyLift: timed ? false : current.isKeyLift,
      muscles: catalog.muscle,
      ...(timed ? { metric } : {}),
    };
  } else {
    day.exercises.push({
      exerciseId: catalog.id,
      canonicalName: catalog.name,
      name: exName,
      sets: defaultSetsForMetric(metric, catalog),
      startWeight: timed ? "Bodyweight" : defaultStartWeightForExercise(catalog),
      technique: exTech,
      isKeyLift: false,
      muscles: catalog.muscle,
      ...(timed ? { metric } : {}),
    });
  }

  await updateActivePlanSplit(ctx.db, planOwnerId(ctx), plan.split);

  const updatedDay = plan.split.find((d) => d.weekday === payload.weekday);
  if (payload.action === "swap") {
    const swapped = updatedDay?.exercises[payload.index ?? 0];
    await reply(
      ctx,
      t(lang, "swap_done", { from: fromName, to: swapped?.name ?? catalog.name }),
      swapTuneKb(lang, payload.weekday, payload.index ?? 0),
    );
  } else {
    await reply(
      ctx,
      t(lang, "add_exercise_done", { name: updatedDay?.exercises.at(-1)?.name ?? catalog.name }),
      updatedDay ? swapTuneKb(lang, payload.weekday, updatedDay.exercises.length - 1) : undefined,
    );
  }
  // Re-show the full edit-day menu automatically after an add / custom swap (both surfaces).
  if (isEditingOther(ctx)) await reRenderEditDay(ctx, payload.weekday);
  else await endSelfEdit(ctx, String(payload.weekday));
}

export type PendingExercise = NonNullable<MyContext["user"]["session"]["pendingExercise"]>;

export async function handleExerciseConfirmation(ctx: MyContext, accept: boolean) {
  const lang = ctx.user.lang;
  const pending = ctx.user.session.pendingExercise;
  if (!pending) {
    await reply(ctx, t(lang, "error_generic"), menuBtn(lang));
    return;
  }
  // "✅ Так" → add the resolved catalog exercise.
  if (accept) {
    await setMode(ctx, "idle");
    if (pending.catalogId) {
      const catalog = await getCatalogExercise(ctx.db, pending.catalogId);
      if (catalog) {
        await applyCatalogExerciseChoice(ctx, pending, catalog);
        return;
      }
    }
    // Accepted, but the suggestion had no stored catalog entry (rare) — author it.
    await aiAuthorAndAdd(ctx, pending);
    return;
  }
  // "✏️ Ні, інша вправа" → don't guess: offer real catalog alternatives for the user's query,
  // plus "type another name" and an explicit "let the bot create it" fallback. Nothing is
  // added until the user picks.
  await showExerciseConfirmAlternatives(ctx, pending);
}

// AI-author one exercise from the user's free-text query and add it. Used only when the user
// explicitly asks the bot to create it (no catalog match they liked).
export async function aiAuthorAndAdd(ctx: MyContext, pending: PendingExercise) {
  const lang = ctx.user.lang;
  const plan = await getActivePlan(ctx.db, planOwnerId(ctx));
  const day = plan ? getPlanDay(plan, pending.weekday) : undefined;
  if (!plan || !day) {
    await reply(ctx, t(lang, "error_generic"), menuBtn(lang));
    return;
  }
  const current = pending.action === "swap" && pending.index !== undefined ? day.exercises[pending.index] : undefined;
  try {
    await ctx.replyWithChatAction("typing").catch(() => {});
    const catalog = await createExerciseCatalogEntry(ctx, pending.query, day, pending.action, current, pending.englishQuery, pending.catalogId);
    await applyCatalogExerciseChoice(ctx, pending, catalog);
  } catch (err) {
    await onError(ctx, err, "exercise_confirm");
  }
}

// Show other library matches for the user's query (the rejected suggestion excluded). Keeps the
// pending request in the session and switches to "exercise_alt" mode so a typed reply re-searches.
export async function showExerciseConfirmAlternatives(ctx: MyContext, pending: PendingExercise) {
  const lang = ctx.user.lang;
  const session = switchMode(ctx.user.session, "exercise_alt", { pendingExercise: pending });
  await updateUser(ctx.db, ctx.user._id, { session });
  ctx.user.session = session;

  // Re-use the already-resolved English query / original query — no extra AI translate call.
  const variants = [...new Set([pending.englishQuery, pending.query].map((q) => q.trim()).filter(Boolean))];
  let matches: CatalogExercise[] = [];
  for (const q of variants) {
    const found = await searchExercisesByName(ctx.db, q, 6, lang);
    if (found.length) { matches = found; break; }
  }
  const alts = matches.filter((m) => m.id !== pending.catalogId).slice(0, 4);

  if (!alts.length) {
    const kb = new InlineKeyboard()
      .text(t(lang, "exercise_alt_type_btn"), "exa:type")
      .row()
      .text(t(lang, "exercise_alt_ai_btn"), "exa:ai");
    await reply(ctx, t(lang, "exercise_alt_none"), kb);
    return;
  }

  const kb = new InlineKeyboard();
  for (const c of alts) {
    // Localizing each label is best-effort — a translate failure must not crash the menu.
    let name = c.name;
    if (lang !== "en") {
      try { name = (await exerciseInfoEntry(ctx, c.id, lang))?.name ?? c.name; } catch { /* keep English */ }
    }
    kb.text(cleanAi(name).slice(0, 60), `exa:pick:${c.id}`).row();
  }
  kb.text(t(lang, "exercise_alt_type_btn"), "exa:type").row();
  kb.text(t(lang, "exercise_alt_ai_btn"), "exa:ai");
  await reply(ctx, t(lang, "exercise_alt_pick"), kb);
}

// Text handler for "exercise_alt": a typed reply is a fresh exercise name → re-run the
// add/swap-by-name flow (which prompts confirmation again).
export async function handleExerciseAltText(ctx: MyContext, text: string) {
  const pending = ctx.user.session.pendingExercise;
  await setMode(ctx, "idle");
  if (!pending) {
    await reply(ctx, t(ctx.user.lang, "error_generic"), menuBtn(ctx.user.lang));
    return;
  }
  const query = extractExerciseQuery(text);
  if (pending.action === "swap" && pending.index !== undefined) {
    await swapExerciseByName(ctx, pending.weekday, pending.index, query);
  } else {
    await addExerciseByName(ctx, pending.weekday, query);
  }
}

// ---------------- warm-up editing (user + trainer/owner) ----------------
// showWarmupEditor/saveWarmup/suggestWarmup/handleWarmupEdit moved to bot/warmup.ts (god-file
// split). The rest of this section (below) is core plan/exercise infrastructure most other
// bot/*.ts files depend on — stayed in the kernel.

// Resolve a catalog id + canonical name for one (ungrounded) plan exercise: match the
// catalog by its name (UA/EN), else AI-author a catalog entry (coach). No mutation here.
export async function groundExercise(
  ctx: MyContext,
  day: PlanDay,
  ex: PlanExercise,
): Promise<{ id: string; name: string } | null> {
  try {
    const matches = await searchExerciseCatalog(ctx, ex.name, 1);
    if (matches.length) return { id: matches[0].id, name: matches[0].name };
    const cat = await createExerciseCatalogEntry(
      ctx,
      ex.name,
      day,
      "add",
      undefined,
      await translateExerciseQueryToEnglish(ctx, ex.name),
    );
    return { id: cat.id, name: cat.name };
  } catch {
    return null;
  }
}

// Localize a plan's exercise DISPLAY names into `lang`, preserving the English canonicalName for
// matching/PRs/videos. adaptPlan (bank/template/shared-program snapshots) copies exercise names
// verbatim, so a uk client assigned an English-authored template sees "Dumbbell Bench Press"
// instead of "Жим гантелей лежачи". This grounds any ungrounded exercise (so the catalog holds a
// translation), then swaps in the cached/seeded/AI-translated name. English plans and
// already-Cyrillic names are skipped, so a healthy plan costs only a scan — no AI, no writes.
// Mutates `plan` in place; returns whether anything changed. Call right after adaptPlan().
export async function localizePlanNames(ctx: MyContext, plan: PlanDoc, lang: Lang): Promise<boolean> {
  if (lang === "en") return false;
  const CYR = /[Ѐ-ӿ]/;
  let changed = false;
  for (const day of plan.split) {
    for (const ex of day.exercises ?? []) {
      if (CYR.test(ex.name)) continue; // already localized
      let id = ex.exerciseId;
      if (!id) {
        const g = await groundExercise(ctx, day, ex);
        if (g) { id = ex.exerciseId = g.id; ex.canonicalName = g.name; changed = true; }
      }
      if (!id) continue;
      const info = await exerciseInfoEntry(ctx, id, lang).catch(() => null);
      const localized = info?.name ? cleanAi(info.name) : "";
      if (localized && CYR.test(localized) && localized !== ex.name) {
        if (!ex.canonicalName) ex.canonicalName = ex.name; // keep the English name for matching
        ex.name = localized;
        changed = true;
      }
    }
  }
  return changed;
}

// Render-time self-heal: localize a plan's exercise names on display and persist the result once,
// so a plan that stored English names (a pre-localization template/shared assign, or an ungrounded
// draft) is corrected the first time anyone views it — not only when it's next (re)assigned. A
// healthy (already-Cyrillic) plan costs a scan and no write. `lang` is the plan OWNER's language
// (not the viewer's), so a trainer opening a client's plan persists names in the client's language.
export async function healPlanNamesForDisplay(ctx: MyContext, plan: PlanDoc, lang: Lang): Promise<PlanDoc> {
  const changed = await localizePlanNames(ctx, plan, lang);
  if (changed) {
    if (plan.status === "draft") await saveDraftPlan(ctx.db, plan).catch(() => {});
    else await updateActivePlanSplit(ctx.db, plan.userId, plan.split).catch(() => {});
  }
  return plan;
}

// Send full 📖 instructions + ⚠️ safety for EVERY exercise of a day as a separate message.
// Exercises that aren't catalog-grounded yet are grounded on demand (match or AI-author) and
// the new ids are persisted so info works for all of them. Each block is a single-line
// <b>name</b> header + plain escaped text → sendLong can chunk safely (no entity spans a chunk).
export async function sendExerciseDescriptions(ctx: MyContext, dayArg: PlanDay, lang: Lang) {
  const plan = await getActivePlan(ctx.db, ctx.user._id);
  const day = plan?.split.find((d) => d.weekday === dayArg.weekday) ?? dayArg;
  if (!day.exercises.length) return;

  // Ground any ungrounded exercises (in parallel), then persist if anything changed.
  const ungrounded = day.exercises.filter((e) => !e.exerciseId);
  if (ungrounded.length) {
    const grounds = await Promise.all(ungrounded.map((e) => groundExercise(ctx, day, e)));
    let changed = false;
    ungrounded.forEach((e, i) => {
      const g = grounds[i];
      if (g) {
        e.exerciseId = g.id;
        e.canonicalName = g.name;
        changed = true;
      }
    });
    if (changed && plan) await updateActivePlanSplit(ctx.db, ctx.user._id, plan.split);
  }

  const results = await Promise.all(
    day.exercises.map((e) => (e.exerciseId ? exerciseInfoEntry(ctx, e.exerciseId, lang) : null)),
  );
  const blocks: string[] = [];
  day.exercises.forEach((e, i) => {
    const r = results[i];
    const instr = (r?.instructions ?? "").replace(/\s+/g, " ").trim();
    const safety = (r?.safety ?? "").replace(/\s+/g, " ").trim();
    let b = `📖 <b>${escapeHtml(cleanAi(r?.name || e.name))}</b>`;
    if (instr) b += `\n${escapeHtml(instr)}`;
    if (safety) b += `\n⚠️ ${escapeHtml(safety)}`;
    blocks.push(b);
  });
  if (blocks.length) await reply(ctx, blocks.join("\n\n"));
}

export async function exerciseIdForName(name: string): Promise<string> {
  const bytes = new TextEncoder().encode(name.toLowerCase().trim());
  const digest = await crypto.subtle.digest("SHA-1", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16);
}

export async function createExerciseCatalogEntry(
  ctx: MyContext,
  query: string,
  day: PlanDay,
  mode: "swap" | "add",
  current?: PlanExercise,
  normalizedQuery?: string,
  excludeId?: string,
): Promise<CatalogExercise> {
  const currentCatalog = current?.exerciseId ? await getCatalogExercise(ctx.db, current.exerciseId) : null;
  // When the user rejected a suggestion ("Ні, інша вправа"), tell the AI to pick a different one.
  const excluded = excludeId ? await getCatalogExercise(ctx.db, excludeId) : null;
  const hint = excluded
    ? `${normalizedQuery ?? ""} — IMPORTANT: do NOT return "${excluded.name}"; the user said that is a different exercise, so author the exercise they actually mean.`
    : normalizedQuery;
  const result = await aiJSON<P.ExerciseCatalogResult>(ctx.env, {
    system: P.exerciseCatalogSystem(ctx.user.lang),
    user: P.exerciseCatalogUser(
      query,
      hint,
      current?.name ?? "",
      day.muscleGroup,
      ctx.user.profile.equipment ?? "n/a",
      ctx.user.profile.level ?? "beginner",
      mode,
      ctx.user.profile.limitations,
      ctx.user.profile.dislikedExercises,
    ),
    schema: P.EXERCISE_CATALOG_SCHEMA,
    temperature: 0.3,
    kind: "plan",
    db: ctx.db,
    userId: ctx.user._id,
  });
  const name = cleanAi(result.name) || cleanAi(query);
  const muscle = cleanAi(result.muscle) || currentCatalog?.muscle || muscleGroupToEnum(day.muscleGroup) || "middle back";
  const difficulty = cleanAi(result.difficulty) || currentCatalog?.difficulty || ctx.user.profile.level || "beginner";
  const equipment = (result.equipments ?? []).map((e) => cleanAi(e)).filter(Boolean);
  const catalog: CatalogExercise = {
    id: await exerciseIdForName(name),
    name,
    type: cleanAi(result.type) || undefined,
    muscle,
    difficulty,
    equipments: equipment,
    instructions: cleanAi(result.instructions),
    safetyInfo: cleanAi(result.safetyInfo),
  };
  await upsertExercise(ctx.db, catalog);
  return catalog;
}

export async function cmdToday(ctx: MyContext) {
  await clearEditOwner(ctx);
  const lang = ctx.user.lang;
  let plan = await getActivePlan(ctx.db, ctx.user._id);
  if (!plan) {
    await reply(ctx, t(lang, ctx.user.role === "client" ? "client_no_plan_yet" : "no_plan"));
    return;
  }
  plan = await healPlanIfDegenerate(ctx, plan);
  plan = await healPlanNamesForDisplay(ctx, plan, lang);
  const tz = ctx.user.profile.timezone;
  const recentLogs = await workoutLogsSince(ctx.db, ctx.user._id, localCutoff(tz, 14));
  const logs = recentLogs.map((l) => ({ date: l.date, completed: l.completed }));
  const sessions = upcomingSessions(lang, plan, tz, logs, 6);
  const today = localParts(tz).date;
  const todays = sessions.find((s) => s.date === today);
  if (todays && todays.status === "pending") {
    // Overview + action buttons. Full instructions/safety are available on demand via the
    // "📖 Інфо про вправи" button (showWorkoutInfo) — not auto-sent here, to avoid clutter.
    // Auto-deload week: same exercises, ~40% fewer sets, with a notice (no manual /replan).
    const deload = shouldDeload(plan, today);
    const day = deload
      ? { ...todays.day, exercises: todays.day.exercises.map((e) => ({ ...e, sets: deloadSets(e.sets) })) }
      : todays.day;
    // Periodization awareness: show the current mesocycle phase. When a volume-deload is active
    // the deload notice already conveys it, so we don't double up the phase line.
    const meso = mesocyclePhase(weeksSincePlan(plan.generatedAt.toISOString(), today));
    const phaseKey = {
      accumulation: "phase_accumulation",
      intensification: "phase_intensification",
      peak: "phase_peak",
      deload: "phase_deload",
    } as const;
    const phaseLine =
      !deload && meso.phase !== "deload"
        ? t(lang, "periodization_line", { phase: t(lang, phaseKey[meso.phase]), week: meso.weekInBlock }) + "\n\n"
        : "";
    const notice = deload ? t(lang, "deload_today") + "\n\n" : "";
    // Same-day autoregulation: today's check-in (energy/sleep/stress) has always gated the
    // WEEKLY progression (computePlanProgression's heldForWellbeing) but never said anything
    // about today's session. On a bad-readiness day, say so up front — on a deload week the
    // load is already cut, so don't stack a second "go easier" message on top of it.
    let readinessLine = "";
    if (!deload) {
      const checkin = await getDailyCheckin(ctx.db, ctx.user._id, today).catch(() => null);
      const base = readinessAdvice(checkin);
      // A long run yesterday is a recovery cost the check-in may not reflect at all — fold recent
      // conditioning in, and say which of the two is doing the talking.
      const strained = recentConditioningStrain(recentLogs, today);
      const readiness = readinessWithConditioning(base, strained);
      if (readiness !== "ok") {
        const key = base === "ok" ? "readiness_cardio" : readiness === "light" ? "readiness_light" : "readiness_easy";
        readinessLine = t(lang, key) + "\n\n";
      }
    }
    await reply(ctx, phaseLine + notice + readinessLine + renderToday(lang, day, todays.label, undefined, await videosForDays(ctx, [day])), todayWorkoutKeyboard(lang, todays.weekday));
    return;
  } else {
    // Rest day or already logged → show the dated schedule then next session with action buttons.
    const next = sessions.find((s) => s.isNext);
    await reply(ctx, renderSchedule(lang, sessions, next ? await videosForDays(ctx, [next.day]) : undefined));
    if (next) {
      await reply(
        ctx,
        `🏋️ <b>${escapeHtml(next.label)} — ${escapeHtml(next.day.muscleGroup)}</b>\n` + renderDayInline(next.day),
        difficultyKeyboard(lang, next.weekday),
      );
    } else {
      // No upcoming session — a bare menu button with an empty body renders as a blank message.
      await reply(ctx, t(lang, "today_rest"), menuBtn(lang));
    }
  }
}

export async function cmdSchedule(ctx: MyContext) {
  await clearEditOwner(ctx);
  const lang = ctx.user.lang;
  const plan = await getActivePlan(ctx.db, ctx.user._id);
  if (!plan) {
    await reply(ctx, t(lang, ctx.user.role === "client" ? "client_no_plan_yet" : "no_plan"));
    return;
  }
  const tz = ctx.user.profile.timezone;
  const logs = (await workoutLogsSince(ctx.db, ctx.user._id, localCutoff(tz, 14))).map((l) => ({
    date: l.date,
    completed: l.completed,
  }));
  const sessions = upcomingSessions(lang, plan, tz, logs, 8);
  const next = sessions.find((s) => s.isNext) ?? sessions[0];
  await reply(ctx, renderSchedule(lang, sessions, next ? await videosForDays(ctx, [next.day]) : undefined), menuBtn(lang));
}

export async function showWorkoutInfo(ctx: MyContext) {
  const lang = ctx.user.lang;
  const plan = await getActivePlan(ctx.db, ctx.user._id);
  if (!plan) {
    await reply(ctx, t(lang, ctx.user.role === "client" ? "client_no_plan_yet" : "no_plan"), menuBtn(lang));
    return;
  }
  const tz = ctx.user.profile.timezone;
  const logs = (await workoutLogsSince(ctx.db, ctx.user._id, localCutoff(tz, 14))).map((l) => ({
    date: l.date,
    completed: l.completed,
  }));
  const sessions = upcomingSessions(lang, plan, tz, logs, 6);
  const today = localParts(tz).date;
  const todays = sessions.find((s) => s.date === today && s.status === "pending");
  const next = todays ? todays.day : sessions.find((s) => s.isNext)?.day ?? sessions[0]?.day;
  if (!next) {
    await reply(ctx, t(lang, "exercise_info_unavailable"), menuBtn(lang));
    return;
  }
  await reply(ctx, `${t(lang, "exercise_info_header")}\n📖 <b>${escapeHtml(next.muscleGroup)}</b>`);
  await sendExerciseDescriptions(ctx, next, lang);
}

export async function startAddExercise(ctx: MyContext, weekday: Weekday) {
  const lang = ctx.user.lang;
  const session = switchMode(ctx.user.session, "add_exercise", { targetId: weekday });
  await updateUser(ctx.db, ctx.user._id, { session });
  ctx.user.session = session;
  await reply(ctx, t(lang, "add_exercise_prompt"));
}

export async function showDeleteExerciseMenu(ctx: MyContext, weekday: Weekday) {
  const lang = ctx.user.lang;
  const plan = await getActivePlan(ctx.db, planOwnerId(ctx));
  const day = plan ? getPlanDay(plan, weekday) : undefined;
  if (!day || !day.exercises.length) {
    await reply(ctx, t(lang, "exercise_info_unavailable"), menuBtn(lang));
    return;
  }
  const kb = new InlineKeyboard();
  day.exercises.forEach((e, i) => {
    const label = `${i + 1}. ${e.name}`.slice(0, 60);
    kb.text(label, `workout:delete:${weekday}:${i}`).row();
  });
  await reply(ctx, t(lang, "delete_pick"), kb);
}

export async function deleteExerciseFromToday(ctx: MyContext, weekday: Weekday, index: number) {
  const lang = ctx.user.lang;
  const plan = await getActivePlan(ctx.db, planOwnerId(ctx));
  const day = plan ? getPlanDay(plan, weekday) : undefined;
  const current = day?.exercises[index];
  if (!plan || !day || !current) {
    await reply(ctx, t(lang, "error_generic"), menuBtn(lang));
    return;
  }
  const owner = planOwnerId(ctx);
  day.exercises.splice(index, 1);
  await updateActivePlanSplit(ctx.db, owner, plan.split);
  // Stash for one-tap undo.
  const session = { ...ctx.user.session, lastDeleted: { ownerId: owner, weekday, index, exercise: current } };
  await updateUser(ctx.db, ctx.user._id, { session });
  ctx.user.session = session;
  const updatedDay = plan.split.find((d) => d.weekday === weekday);
  await reply(ctx, t(lang, "delete_done", { name: current.name }), new InlineKeyboard().text(t(lang, "undo_delete"), "undo:del"));
  // Editing a client/user → return to their edit-day view; editing own today → self log view.
  if (isEditingOther(ctx)) {
    await reRenderEditDay(ctx, weekday);
  } else if (updatedDay) {
    await reply(ctx, renderToday(lang, updatedDay, undefined, undefined, await videosForDays(ctx, [updatedDay])), todayWorkoutKeyboard(lang, weekday));
  }
}

// Restore the most recently deleted exercise to its original position.
export async function undoDelete(ctx: MyContext) {
  const lang = ctx.user.lang;
  const d = ctx.user.session.lastDeleted;
  if (!d) {
    await reply(ctx, t(lang, "nothing_to_undo"), menuBtn(lang));
    return;
  }
  const plan = await getActivePlan(ctx.db, d.ownerId);
  const day = plan ? getPlanDay(plan, d.weekday as Weekday) : undefined;
  if (!plan || !day) {
    await reply(ctx, t(lang, "error_generic"), menuBtn(lang));
    return;
  }
  day.exercises.splice(Math.min(d.index, day.exercises.length), 0, d.exercise);
  await updateActivePlanSplit(ctx.db, d.ownerId, plan.split);
  const session = { ...ctx.user.session };
  delete session.lastDeleted;
  await updateUser(ctx.db, ctx.user._id, { session });
  ctx.user.session = session;
  await reply(ctx, t(lang, "undo_done", { name: d.exercise.name }), menuBtn(lang));
}

export function defaultSetsForExercise(catalog: CatalogExercise): string {
  switch (catalog.difficulty) {
    case "expert":
      return "4 × 6-8";
    case "intermediate":
      return "4 × 8-10";
    default:
      return "3 × 10-12";
  }
}

export function defaultStartWeightForExercise(catalog: CatalogExercise): string {
  const eq = catalog.equipments.join(" ").toLowerCase();
  const bodyweightish = catalog.type?.toLowerCase().includes("bodyweight") || eq.includes("bodyweight");
  return bodyweightish ? "Bodyweight" : "—";
}

// Default sets string by metric: timed holds → seconds, cardio → duration, else reps by difficulty.
export function defaultSetsForMetric(metric: ExerciseMetric, catalog: CatalogExercise): string {
  if (metric === "time") return "3 × 30-45s";
  if (metric === "distance") return "10 min";
  return defaultSetsForExercise(catalog);
}

// Resolve an exercise by name (catalog match, else AI-author) and ask the user to confirm
// before adding it to `weekday`. Shared by the typed add flow and the coach chat.
export async function addExerciseByName(ctx: MyContext, weekday: Weekday, query: string) {
  const lang = ctx.user.lang;
  const plan = await getActivePlan(ctx.db, planOwnerId(ctx));
  const day = plan ? getPlanDay(plan, weekday) : undefined;
  if (!plan || !day) {
    await reply(ctx, t(lang, "error_generic"), menuBtn(lang));
    return;
  }
  try {
    const englishQuery = await translateExerciseQueryToEnglish(ctx, query);
    const matches = await searchExerciseCatalog(ctx, query, 5);
    await ctx.replyWithChatAction("typing").catch(() => {});
    const catalog = matches[0] ?? (await createExerciseCatalogEntry(ctx, query, day, "add", undefined, englishQuery));
    await promptExerciseConfirmation(ctx, { action: "add", weekday, query, englishQuery, catalog });
  } catch (err) {
    await onError(ctx, err, "add_exercise");
  }
}

export async function handleAddExercise(ctx: MyContext, text: string) {
  const weekday = (ctx.user.session.targetId ?? 0) as Weekday;
  await setMode(ctx, "idle");
  await addExerciseByName(ctx, weekday, extractExerciseQuery(text));
}

// Maps localized/English muscle group display names to catalog muscle enum values.
export function muscleGroupToEnum(group: string): string | null {
  const g = group.toLowerCase();
  const map: [string, string][] = [
    ["shoulder", "shoulders"], ["плеч", "shoulders"],
    ["chest", "chest"], ["груд", "chest"],
    ["back", "middle back"], ["спин", "middle back"],
    ["lat", "lats"], ["широч", "lats"],
    ["leg", "quadriceps"], ["квадр", "quadriceps"], ["ног", "quadriceps"],
    ["hamstr", "hamstrings"], ["підколін", "hamstrings"],
    ["glute", "glutes"], ["сідн", "glutes"],
    ["bicep", "biceps"], ["біцеп", "biceps"],
    ["tricep", "triceps"], ["трицеп", "triceps"],
    ["abs", "abdominals"], ["прес", "abdominals"], ["черев", "abdominals"],
    ["calf", "calves"], ["ікр", "calves"],
    ["trap", "traps"], ["трапец", "traps"],
    ["forearm", "forearms"], ["передпліч", "forearms"],
  ];
  for (const [key, val] of map) {
    if (g.includes(key)) return val;
  }
  return null;
}

// ============ Plan-day management: add / delete whole days ============
// Moved to bot/planDays.ts (god-file split); re-exported below so existing `from "./bot"`
// imports (router.ts) keep working.

// swapMenu/showSwapAlternatives/swapFromCatalog/showLogSwapAlternatives/showGymSwapPicker/
// applyGymSwap/logSwapFromCatalog/logBackToPick/startSwapCustom/swapExerciseByName/
// handleSwapCustom/setExerciseWeight/setExerciseSets/adjustDifficulty/openWeightEditor/
// openSetsEditor/selfEditDayKb/endSelfEdit moved to bot/planExerciseEdit.ts as one file (see
// its header comment for why they were not split further); re-exported below.

// showReorder/moveExercise/endReorder/selectExerciseWeight/selectExerciseSets/handleWeightEdit/
// handleSetsEdit moved to bot/planExerciseEdit.ts (same file, same reasons as the swap family).

// The guided per-exercise logger (LogDraft type, cmdLog/cmdLogPast/logPickExercise/logFinish,
// the exit guard, and the free-text switch) moved to bot/guidedLog.ts (god-file split; it was
// filed under the unrelated "Reorder exercises" banner). Re-exported below.

export async function cmdProgress(ctx: MyContext) {
  const lang = ctx.user.lang;
  const records = await listStrength(ctx.db, ctx.user._id);
  if (!records.length) {
    await reply(ctx, t(lang, "progress_none"), menuBtn(lang));
    return;
  }
  const { date } = localParts(ctx.user.profile.timezone);
  // Personal 28-day streak calendar (gamification, no leaderboard).
  const since28 = localCutoff(ctx.user.profile.timezone, 28);
  const [wLogs, nLogs, total, plan, bodyLogs, statCounts] = await Promise.all([
    workoutLogsSince(ctx.db, ctx.user._id, since28),
    nutritionLogsSince(ctx.db, ctx.user._id, since28),
    countCompletedWorkouts(ctx.db, ctx.user._id),
    getActivePlan(ctx.db, ctx.user._id),
    bodyLogsByUser(ctx.db, ctx.user._id).catch(() => []),
    userStatCounts(ctx.db, ctx.user._id).catch(() => ({ workouts: 0, nutrition: 0, checkins: 0, steps: 0, badges: 0 })),
  ]);
  const completed = wLogs.filter((l) => l.completed);
  const workoutDates = new Set(completed.map((l) => l.date));
  const nutritionDates = new Set(nLogs.map((l) => l.date));
  // Off-plan vs planned: a completed log on a weekday the plan doesn't schedule is a bonus session.
  const planWeekdays = new Set((plan?.split ?? []).map((d) => d.weekday));
  const offPlan = completed.filter((l) => planWeekdays.size > 0 && !planWeekdays.has(l.weekday)).length;
  const weekStart = weekStartStr(date);
  const thisWeek = completed.filter((l) => l.date >= weekStart).length;
  const streak = weekStreak([...workoutDates], date, ctx.user.reminders?.lastVacation);
  // Rest-day activity: days fed/tracked but not trained — so a rest day isn't "empty".
  const restActive = [...nutritionDates].filter((d) => !workoutDates.has(d)).length;
  const lv = levelFromXp(computeXp(statCounts));
  const summary =
    `${t(lang, "progress_summary")}\n` +
    `${t(lang, "progress_level_line", { level: lv.level, xp: lv.xp, bar: progressBar((lv.intoLevel / lv.needed) * 100) })}\n` +
    `${t(lang, "progress_total_line", { total, week: thisWeek })}\n` +
    `${t(lang, "progress_streak_line", { n: streak })}\n` +
    (offPlan > 0 ? `${t(lang, "progress_offplan_line", { n: offPlan })}\n` : "") +
    `${t(lang, "progress_restdays_line", { n: restActive })}`;
  let msg = `${summary}\n\n${renderStrength(lang, records)}`;
  msg += `\n\n${renderActivityGrid(lang, buildActivityCells(date, workoutDates, nutritionDates, 28))}`;
  if (deloadDue(records, date)) msg += `\n\n${t(lang, "deload_due")}`;
  // No strength records = nothing to analyse. The prompt asks the model to "note improvements
  // and give the next progression target per lift"; handed an empty array it can only produce
  // generic filler that reads as praise for training that was never logged.
  try {
    if (!records.length) throw new Error("no records to narrate");
    const narrative = await aiText(ctx.env, {
      system: P.progressSystem(lang),
      user: JSON.stringify(
        records.map((r) => ({
          exercise: r.exercise,
          best: `${r.bestWeight}x${r.bestReps}`,
          history: r.history.slice(-6),
        })),
      ),
      temperature: 0.5,
      kind: "progress",
      db: ctx.db,
      userId: ctx.user._id,
    });
    msg += `\n\n💬 <i>${escapeHtml(narrative)}</i>`;
  } catch {
    /* narrative is optional */
  }
  const weights = bodyLogs.filter((b) => typeof b.weight === "number" && b.weight > 0).map((b) => ({ date: b.date, weight: b.weight as number }));
  // Weight-goal projection: trend toward the target, with an ETA when on track.
  const goalLine = weightGoalLine(ctx, weights);
  if (goalLine) msg += `\n\n${goalLine}`;
  // Plateau heads-up: lifts with no recent e1RM gain.
  const stalled = stalledLifts(records, date);
  if (stalled.length) msg += `\n\n${t(lang, "plateau_line", { lifts: stalled.slice(0, 3).map(escapeHtml).join(", ") })}`;
  // Visual charts (weight trend, e1RM, measurements) live in the Mini App dashboard now —
  // no more external QuickChart PNG round-trips on every /progress.
  const kb = new InlineKeyboard()
    .text(t(lang, "exchart_btn"), "exlist")
    .text(t(lang, "standards_btn"), "std")
    .row()
    .text(t(lang, "volume_btn"), "vol")
    .text(t(lang, "calc_btn"), "calc")
    .row()
    .text(t(lang, "wellbeing_btn"), "well")
    .text(t(lang, "wcard_btn"), "share:week")
    .row();
  const app = dashboardUrl();
  if (app) kb.webApp(t(lang, "menu_dashboard"), app).row();
  kb.text(t(lang, "menu_open"), "menu:open");
  await reply(ctx, msg, kb);
}

// Shareable week card — a <pre> summary of the last 7 days the user can forward to friends.
export async function cmdWeekCard(ctx: MyContext) {
  const lang = ctx.user.lang;
  const card = await buildWeekCard(ctx.db, ctx.user._id, ctx.user.profile.timezone, ctx.user.profile.name ?? "", lang, ctx.user.reminders?.lastVacation);
  if (!card) {
    await reply(ctx, t(lang, "wcard_empty"), menuBtn(lang));
    return;
  }
  // The card gets forwarded into group chats as-is, so it carries the sender's referral link:
  // every forward becomes a click target instead of just a screenshot. Only on the self-serve
  // path — a trainer forwarding a CLIENT's card (buildWeekCard's other callers) must not attach
  // the client's link.
  const ref = botDeepLink(ctx.env, `ref_${ctx.user._id}`);
  const footer = ref ? t(lang, "wcard_ref", { link: ref }) : t(lang, "wcard_share_hint");
  await reply(ctx, `${card}\n\n${footer}`, menuBtn(lang));
}

// Strength standards — classify the user's tracked big lifts (squat/bench/deadlift/OHP/row) into
// a bodyweight-relative bracket, with the load needed for the next level. Approximate, motivational.
export async function cmdStandards(ctx: MyContext) {
  const lang = ctx.user.lang;
  const sex = ctx.user.profile.sex;
  const records = await listStrength(ctx.db, ctx.user._id);
  // Bodyweight: latest logged weight, else profile weight.
  const bodyLogs = await bodyLogsByUser(ctx.db, ctx.user._id).catch(() => []);
  const weights = bodyLogs.filter((b) => typeof b.weight === "number" && b.weight! > 0);
  const bw = weights.length ? (weights[weights.length - 1].weight as number) : (ctx.user.profile.weightKg ?? 0);
  if (bw <= 0) {
    // One-tap route into the body editor instead of a "go find Settings" dead end.
    const kb = new InlineKeyboard().text(t(lang, "edit_body"), "set:body").row().text(t(lang, "menu_open"), "menu:open");
    await reply(ctx, t(lang, "standards_no_weight"), kb);
    return;
  }
  const levelName = (lv: StrengthLevel) => t(lang, `std_lvl_${lv}` as TKey);
  const lines: string[] = [];
  for (const r of records) {
    if (r.bestWeight <= 0) continue;
    const oneRm = e1rm(r.bestWeight, r.bestReps);
    const std = strengthStandard(r.exercise, sex, bw, oneRm);
    if (!std) continue;
    let line = `${escapeHtml(r.exercise)}: <b>${levelName(std.level)}</b> · ${Math.round(oneRm)}${t(lang, "unit_kg")} (×${std.ratio.toFixed(2)})`;
    if (std.next && std.nextTargetKg) {
      line += `\n   ${t(lang, "standards_next", { level: levelName(std.next), kg: std.nextTargetKg })}`;
    }
    lines.push(line);
  }
  if (!lines.length) { await reply(ctx, t(lang, "standards_none"), menuBtn(lang)); return; }
  const header = t(lang, "standards_title", { bw: Math.round(bw), sex: t(lang, sex === "female" ? "sex_female" : "sex_male") });
  await reply(ctx, `${header}\n\n${lines.join("\n\n")}\n\n${t(lang, "standards_footer")}`, menuBtn(lang));
}

// Weight-goal projection line for the progress screen — trend toward the user's target, ETA when
// on track. Returns null when no goal is set or there's too little weight history.
export function weightGoalLine(ctx: MyContext, weights: { date: string; weight: number }[]): string | null {
  const lang = ctx.user.lang;
  const goal = ctx.user.profile.goalWeight;
  if (!goal || goal <= 0) return null;
  const p = projectWeight(weights, goal);
  if (!p) return null;
  if (p.reached) return t(lang, "goal_reached", { goal });
  const trend = t(lang, p.slopePerWeek === 0 ? "goal_trend_flat" : p.slopePerWeek < 0 ? "goal_trend_down" : "goal_trend_up", { kg: Math.abs(p.slopePerWeek) });
  if (p.onTrack && p.etaWeeks) {
    return t(lang, "goal_on_track", { current: Math.round(p.current), goal, trend, weeks: p.etaWeeks });
  }
  return t(lang, "goal_off_track", { current: Math.round(p.current), goal, trend });
}

export const VOL_GROUP_LABEL: Record<string, TKey> = {
  legs: "mg_legs", back: "mg_back", chest: "mg_chest", shoulders: "mg_shoulders", arms: "mg_arms", core: "mg_core",
};
export const VOL_ZONE_EMOJI: Record<string, string> = { below: "🔻", optimal: "✅", above: "🔺" };

// Weekly training volume (working sets) per muscle group vs. MEV/MAV landmarks.
export async function cmdVolume(ctx: MyContext) {
  await clearEditOwner(ctx);
  const lang = ctx.user.lang;
  const since = localCutoff(ctx.user.profile.timezone, 7);
  const logs = await workoutLogsSince(ctx.db, ctx.user._id, since);
  const vols = weeklyVolume(logs, since).filter((v) => v.group !== "core" || v.sets > 0);
  // Conditioning sits next to the lifting volume, not in a separate world: the same week that
  // holds a strength increase is the one the athlete needs to see here.
  const cond = conditioningWeek(logs, since);
  const totalSets = vols.reduce((s, v) => s + v.sets, 0);
  if (!totalSets && !cond.sessions) { await reply(ctx, t(lang, "volume_none"), menuBtn(lang)); return; }
  const fmt = (v: MuscleVolume) =>
    `${VOL_ZONE_EMOJI[v.zone]} ${t(lang, VOL_GROUP_LABEL[v.group])}: <b>${v.sets}</b> ${t(lang, "volume_sets")} (MEV ${v.mev} · MAV ${v.mav})`;
  const condLine =
    `${VOL_ZONE_EMOJI[cond.zone]} ${t(lang, "volume_cardio")}: <b>${conditioningLoadLabel(lang, cond)}</b>` +
    (cond.untimedSets ? `\n${t(lang, "volume_cardio_untimed", { n: cond.untimedSets })}` : "");
  const body =
    `${t(lang, "volume_title")}\n\n${vols.map(fmt).join("\n")}\n\n${condLine}\n\n` +
    `${t(lang, "volume_legend")}\n${t(lang, "volume_cardio_legend")}`;
  await reply(ctx, body, menuBtn(lang));
}

// Plate & warm-up calculator: ask for a working weight, then show the per-side plate breakdown
// and a percentage warm-up ramp.
export async function cmdPlates(ctx: MyContext) {
  await clearEditOwner(ctx);
  await setMode(ctx, "calc_weight");
  await reply(ctx, t(ctx.user.lang, "calc_prompt"));
}

export async function handleCalcWeight(ctx: MyContext, text: string) {
  const lang = ctx.user.lang;
  const target = parseFloat(text.replace(",", ".").replace(/[^\d.]/g, ""));
  if (!Number.isFinite(target) || target <= 0 || target > 600) { await reply(ctx, t(lang, "calc_invalid")); return; }
  await setMode(ctx, "idle");
  const plan = platePlan(target);
  const kg = t(lang, "unit_kg");
  let body: string;
  if (!plan) {
    body = t(lang, "calc_below_bar", { bar: 20 });
  } else {
    const perSide = plan.perSide.length ? plan.perSide.join(" + ") : "—";
    body = t(lang, "calc_plates", { target: Math.round(plan.loaded), perside: perSide });
    if (plan.leftover > 0) body += "\n" + t(lang, "calc_leftover", { kg: plan.leftover });
  }
  // Warm-up ramp toward the target.
  const ramp = warmupRamp(target);
  const rampLines = ramp.map((w) => `• ${w.weight}${kg} × ${w.reps}${w.pct ? ` (${w.pct}%)` : ""}`).join("\n");
  body += `\n\n${t(lang, "calc_warmup")}\n${rampLines}`;
  await reply(ctx, body, menuBtn(lang));
}

// Wellbeing trend — energy/sleep/stress from daily check-ins (chart + averages).
export async function cmdWellbeing(ctx: MyContext) {
  await clearEditOwner(ctx);
  const lang = ctx.user.lang;
  const checkins = await dailyCheckinsSince(ctx.db, ctx.user._id, localCutoff(ctx.user.profile.timezone, 90));
  if (checkins.length < 2) { await reply(ctx, t(lang, "wellbeing_none"), menuBtn(lang)); return; }
  const cfg = wellbeingChart(lang, checkins);
  if (cfg) await sendChartPng(ctx, cfg);
  const avg = (sel: (c: (typeof checkins)[number]) => number) => (checkins.reduce((s, c) => s + sel(c), 0) / checkins.length).toFixed(1);
  await reply(
    ctx,
    t(lang, "wellbeing_summary", { n: checkins.length, energy: avg((c) => c.energy), sleep: avg((c) => c.sleep), stress: avg((c) => c.stress) }),
    menuBtn(lang),
  );
}


// AI suggestion for the macros remaining today (button on the nutrition screen).
export async function onMacrosSuggest(ctx: MyContext) {
  const lang = ctx.user.lang;
  const { date, weekday } = localParts(ctx.user.profile.timezone);
  const plan = await getActivePlan(ctx.db, ctx.user._id);
  const trainingDays = ctx.user.profile.trainingWeekdays ?? plan?.split.map((d) => d.weekday) ?? [];
  const isTraining = trainingDays.includes(weekday as Weekday);
  const targets = (!isTraining && plan?.restDayNutrition) || ctx.user.nutrition;
  if (!targets) { await reply(ctx, t(lang, "nutrition_no_targets")); return; }
  const meals = await getDayMeals(ctx.db, ctx.user._id, date);
  const tot = meals.reduce((a, m) => ({ k: a.k + num(m.kcal), p: a.p + num(m.protein), f: a.f + num(m.fats), c: a.c + num(m.carbs) }), { k: 0, p: 0, f: 0, c: 0 });
  const left = {
    kcal: Math.max(0, targets.calories - tot.k),
    protein: Math.max(0, targets.protein - tot.p),
    fats: Math.max(0, targets.fats - tot.f),
    carbs: Math.max(0, targets.carbs - tot.c),
  };
  if (left.kcal <= 50 && left.protein <= 5) { await reply(ctx, t(lang, "macros_done"), menuBtn(lang)); return; }
  await ctx.replyWithChatAction("typing").catch(() => {});
  deferAi(ctx, "coach", async () => {
    const txt = await aiText(ctx.env, {
      system: P.macrosLeftSystem(lang, ctx.user.profile),
      user: JSON.stringify(left),
      temperature: 0.6,
      kind: "nutrition",
      db: ctx.db,
      userId: ctx.user._id,
    });
    const header = t(lang, "macros_left", { kcal: left.kcal, p: left.protein, f: left.fats, c: left.carbs });
    await reply(ctx, `${header}\n\n${escapeHtml(cleanAi(txt))}`, menuBtn(lang));
  });
}

// POST a QuickChart config and upload the PNG (used by overview + per-exercise charts).
export async function sendChartPng(ctx: MyContext, chart: string) {
  try {
    const res = await fetch("https://quickchart.io/chart", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chart, width: 720, height: 360, backgroundColor: "white", format: "png", version: "2" }),
    });
    if (!res.ok) {
      await recordError(ctx.db, { userId: ctx.user._id, kind: "chart", errorType: `http_${res.status}`, message: (await res.text()).slice(0, 180) }).catch(() => {});
      return;
    }
    await ctx.replyWithPhoto(new InputFile(new Uint8Array(await res.arrayBuffer()), "chart.png"));
  } catch (e) {
    await recordError(ctx.db, { userId: ctx.user._id, kind: "chart", errorType: "exception", message: String(e).slice(0, 180) }).catch(() => {});
  }
}

// Tracked lifts with ≥2 weighted sessions — the ones that can form a per-exercise trend line.
export async function chartableLifts(ctx: MyContext) {
  return (await listStrength(ctx.db, ctx.user._id)).filter(
    (r) => r.metric !== "time" && r.metric !== "distance" && r.history.filter((h) => h.weight > 0).length >= 2,
  );
}

export async function showExerciseList(ctx: MyContext) {
  const lang = ctx.user.lang;
  const lifts = await chartableLifts(ctx);
  if (!lifts.length) { await reply(ctx, t(lang, "exchart_none"), menuBtn(lang)); return; }
  const kb = new InlineKeyboard();
  lifts.slice(0, 20).forEach((r, i) => kb.text(`📈 ${r.exercise}`.slice(0, 55), `exch:${i}`).row());
  await reply(ctx, t(lang, "exchart_pick"), kb);
}

export async function onExerciseChart(ctx: MyContext, index: number) {
  const lift = (await chartableLifts(ctx))[index];
  if (!lift) { await showExerciseList(ctx); return; }
  const cfg = exerciseChart(ctx.user.lang, lift.exercise, lift.history);
  if (cfg) await sendChartPng(ctx, cfg);
  await reply(ctx, lift.exercise, menuBtn(ctx.user.lang));
}

export async function cmdNutrition(ctx: MyContext) {
  await setMode(ctx, "nutrition");
  await showFoodLog(ctx);
}

// Today's logged food with per-item KБЖУ + delete buttons, day totals vs target, and the add hint.
// Editing = delete the wrong item (🗑) and re-send it. The mode stays "nutrition" so any text/photo adds.
export async function showFoodLog(ctx: MyContext) {
  const lang = ctx.user.lang;
  const { date, weekday } = localParts(ctx.user.profile.timezone);
  const meals = await getDayMeals(ctx.db, ctx.user._id, date);
  if (!meals.length) {
    await reply(ctx, t(lang, "nutrition_prompt"), new InlineKeyboard().text(t(lang, "food_recent_btn"), "food:recent"));
    return;
  }
  const tot = meals.reduce(
    (a, m) => ({ kcal: a.kcal + num(m.kcal), p: a.p + num(m.protein), f: a.f + num(m.fats), c: a.c + num(m.carbs) }),
    { kcal: 0, p: 0, f: 0, c: 0 },
  );
  const plan = await getActivePlan(ctx.db, ctx.user._id);
  const trainingDays = ctx.user.profile.trainingWeekdays ?? plan?.split.map((d) => d.weekday) ?? [];
  const isTraining = trainingDays.includes(weekday as Weekday);
  const targets = (!isTraining && plan?.restDayNutrition) || ctx.user.nutrition;
  const lines = meals
    .map((m, i) => {
      const g = num(m.grams);
      const wt = g ? ` · ${g} ${t(lang, "unit_g")}` : "";
      const alc = alcoholKcalOf(m);
      const alcTag = alc > 0 ? ` · 🍷 ${alc} ${t(lang, "unit_kcal")}` : "";
      return `${i + 1}. ${escapeHtml(cleanFoodName(m.desc))}${wt} — ${num(m.kcal)} ${t(lang, "unit_kcal")} (Б${num(m.protein)}/Ж${num(m.fats)}/В${num(m.carbs)})${alcTag}`;
    })
    .join("\n");
  const totAlc = meals.reduce((s, m) => s + alcoholKcalOf(m), 0);
  const totals = targets
    ? t(lang, "foodlog_totals", { tkcal: tot.kcal, goalkcal: targets.calories, tp: tot.p, goalp: targets.protein, tf: tot.f, goalf: targets.fats, tc: tot.c, goalc: targets.carbs })
    : t(lang, "foodlog_totals_notarget", { tkcal: tot.kcal, tp: tot.p, tf: tot.f, tc: tot.c });
  // "Of which alcohol" is a widely-used field on wrappers; showing it separately keeps macro
  // percentages honest (ethanol has kcal but is neither P/F/C).
  const alcLine = totAlc > 0 ? `\n${t(lang, "foodlog_alcohol_line", { kcal: totAlc })}` : "";
  const kb = new InlineKeyboard();
  meals.forEach((m, i) => kb.text(`${i + 1}. ${cleanFoodName(m.desc)}`.slice(0, 50), `food:item:${i}`).row());
  kb.text(t(lang, "food_recent_btn"), "food:recent");
  if (targets) kb.text(t(lang, "macros_suggest_btn"), "food:suggest");
  await reply(ctx, `${t(lang, "foodlog_title", { date })}\n${lines}\n\n${totals}${alcLine}\n\n${t(lang, "foodlog_hint")}`, kb);
}

// One-tap re-log of recent foods (last 21 days, deduped). Stored in session for index → item.
export async function showRecentFoods(ctx: MyContext) {
  const lang = ctx.user.lang;
  const { date } = localParts(ctx.user.profile.timezone);
  const foods = await getRecentFoods(ctx.db, ctx.user._id, isoDateMinus(date, 21), 12);
  if (!foods.length) { await reply(ctx, t(lang, "food_recent_none")); return; }
  ctx.user.session = { ...ctx.user.session, recentFoods: foods };
  await updateUser(ctx.db, ctx.user._id, { session: ctx.user.session });
  const kb = new InlineKeyboard();
  foods.forEach((m, i) => kb.text(`➕ ${cleanFoodName(m.desc)} · ${num(m.kcal)}`.slice(0, 48), `relog:${i}`).row());
  kb.text(t(lang, "back"), "menu:nutrition");
  await reply(ctx, t(lang, "food_recent_title"), kb);
}

export async function onReLog(ctx: MyContext, index: number) {
  const item = (ctx.user.session.recentFoods ?? [])[index];
  if (!item) { await showFoodLog(ctx); return; }
  const { date } = localParts(ctx.user.profile.timezone);
  await appendMeals(ctx.db, ctx.user._id, date, [item]);
  await showFoodLog(ctx);
}

// Per-item edit submenu: change weight, change the product itself, or delete.
export async function showFoodItem(ctx: MyContext, index: number) {
  const lang = ctx.user.lang;
  const { date } = localParts(ctx.user.profile.timezone);
  const m = (await getDayMeals(ctx.db, ctx.user._id, date))[index];
  if (!m) { await showFoodLog(ctx); return; }
  const g = num(m.grams);
  const info = `${escapeHtml(cleanFoodName(m.desc))}${g ? ` · ${g} ${t(lang, "unit_g")}` : ""} — ${num(m.kcal)} ${t(lang, "unit_kcal")} (Б${num(m.protein)}/Ж${num(m.fats)}/В${num(m.carbs)})`;
  const kb = new InlineKeyboard()
    .text(t(lang, "food_edit_weight"), `food:wt:${index}`)
    .text(t(lang, "food_edit_product"), `food:prod:${index}`)
    .row()
    .text(t(lang, "food_delete"), `food:del:${index}`)
    .text(t(lang, "back"), "menu:nutrition");
  await reply(ctx, info, kb);
}

// Strip a trailing weight token ("~250 г" / "(250 g)") from a food desc so the grams shown stay in sync.
export function cleanFoodName(desc: string): string {
  return desc.replace(/[~(]?\s*\d+[.,]?\d*\s*(г|g|грам\w*|gram\w*)\.?\)?\s*$/iu, "").trim() || desc;
}

// Ethanol energy in a meal item, inferred from the kcal surplus over 4P + 9F + 4C. Rounded to
// the nearest 5 kcal and clamped ≥ 0. The AI prompt is instructed to include ethanol kcal in
// `kcal` while keeping protein/fats/carbs to non-alcohol parts, so this simple derivation gives
// a stable "🍷 alcohol kcal" line without a new DB column. Small residuals (< 15 kcal) are
// treated as macro-rounding noise, not alcohol — otherwise every meal would show a spurious tag.
export function alcoholKcalOf(m: { kcal?: number | string; protein?: number | string; fats?: number | string; carbs?: number | string }): number {
  const kcal = num(m.kcal);
  const p = num(m.protein);
  const f = num(m.fats);
  const c = num(m.carbs);
  const macroKcal = p * 4 + f * 9 + c * 4;
  const surplus = kcal - macroKcal;
  if (surplus < 15) return 0;
  return Math.round(surplus / 5) * 5;
}

export async function onFoodDelete(ctx: MyContext, index: number) {
  const { date } = localParts(ctx.user.profile.timezone);
  await deleteMealItem(ctx.db, ctx.user._id, date, index);
  await showFoodLog(ctx);
}

export async function onFoodEditWeight(ctx: MyContext, index: number) {
  const lang = ctx.user.lang;
  const { date } = localParts(ctx.user.profile.timezone);
  const item = (await getDayMeals(ctx.db, ctx.user._id, date))[index];
  if (!item) { await showFoodLog(ctx); return; }
  if (!num(item.grams)) { await reply(ctx, t(lang, "food_wt_legacy")); return; } // legacy row: no grams to scale from
  ctx.user.session = { mode: "food_wt", awaitText: String(index) };
  await updateUser(ctx.db, ctx.user._id, { session: ctx.user.session });
  await reply(ctx, t(lang, "food_wt_prompt", { name: escapeHtml(cleanFoodName(item.desc)), g: num(item.grams) }));
}

// User typed a new weight (g) for the item being edited → scale КБЖУ proportionally and re-show.
export async function handleFoodWeight(ctx: MyContext, text: string) {
  const lang = ctx.user.lang;
  const { date } = localParts(ctx.user.profile.timezone);
  const idx = Number(ctx.user.session.awaitText);
  const n = parseInt(text.replace(/[^\d]/g, ""), 10);
  if (!Number.isFinite(n) || n <= 0 || n > 5000) { await reply(ctx, t(lang, "food_wt_invalid")); return; }
  const meals = await getDayMeals(ctx.db, ctx.user._id, date);
  const item = meals[idx];
  if (!item || !num(item.grams)) { await setMode(ctx, "nutrition"); await showFoodLog(ctx); return; }
  const f = n / num(item.grams);
  meals[idx] = {
    ...item,
    grams: n,
    desc: cleanFoodName(item.desc),
    kcal: Math.round(num(item.kcal) * f),
    protein: Math.round(num(item.protein) * f),
    fats: Math.round(num(item.fats) * f),
    carbs: Math.round(num(item.carbs) * f),
  };
  await setDayMeals(ctx.db, ctx.user._id, date, meals);
  await setMode(ctx, "nutrition");
  await showFoodLog(ctx);
}

export async function onFoodEditProduct(ctx: MyContext, index: number) {
  const lang = ctx.user.lang;
  const { date } = localParts(ctx.user.profile.timezone);
  if (!(await getDayMeals(ctx.db, ctx.user._id, date))[index]) { await showFoodLog(ctx); return; }
  ctx.user.session = { mode: "food_prod", awaitText: String(index) };
  await updateUser(ctx.db, ctx.user._id, { session: ctx.user.session });
  await reply(ctx, t(lang, "food_prod_prompt"));
}

// User typed a replacement product (and weight) → re-estimate and swap it in for that position.
export async function handleFoodProduct(ctx: MyContext, text: string) {
  const { date } = localParts(ctx.user.profile.timezone);
  const idx = Number(ctx.user.session.awaitText);
  // Leave food_prod BEFORE deferring — a second message during the ~26 s AI run must route
  // as a normal nutrition entry, not re-enter this handler with the same idx (racing splices).
  await setMode(ctx, "nutrition");
  await ctx.replyWithChatAction("typing").catch(() => {});
  deferAi(ctx, "nutrition", async () => {
    const est = await aiJSON<P.NutritionEstimate>(ctx.env, {
      system: P.nutritionSystem(ctx.user.lang),
      user: text,
      schema: P.NUTRITION_SCHEMA,
      temperature: 0.3,
      kind: "nutrition",
      db: ctx.db,
      userId: ctx.user._id,
    });
    const { final } = await verifyItems(ctx, est.items);
    const meals = await getDayMeals(ctx.db, ctx.user._id, date);
    if (final.length && meals[idx]) {
      meals.splice(idx, 1, ...final); // replace that position with the re-estimated item(s)
      await setDayMeals(ctx.db, ctx.user._id, date, meals);
    }
    await showFoodLog(ctx);
  });
}

export async function cmdCoach(ctx: MyContext) {
  await setMode(ctx, "coach");
  await reply(ctx, t(ctx.user.lang, "coach_prompt"));
}

export async function cmdMeasure(ctx: MyContext) {
  await setMode(ctx, "measure");
  await reply(ctx, t(ctx.user.lang, "measure_prompt"));
}

export async function cmdSteps(ctx: MyContext) {
  await clearEditOwner(ctx);
  const lang = ctx.user.lang;
  await setMode(ctx, "steps_log");
  const { date } = localParts(ctx.user.profile.timezone);
  const logged = await getStepLog(ctx.db, ctx.user._id, date);
  const plan = await getActivePlan(ctx.db, ctx.user._id);
  const target = plan?.stepsTarget;
  const status = logged
    ? t(lang, "steps_today", { steps: logged }) + " "
    : "";
  const goal = target ? t(lang, "steps_goal", { steps: target }) + " " : "";
  await reply(ctx, status + goal + t(lang, "steps_prompt"));
}

export async function handleStepsLog(ctx: MyContext, text: string) {
  const lang = ctx.user.lang;
  const steps = parseSteps(text);
  if (steps === undefined) {
    await reply(ctx, t(lang, "steps_unreadable"));
    return;
  }
  const { date } = localParts(ctx.user.profile.timezone);
  await upsertStepLog(ctx.db, ctx.user._id, date, steps);
  await setMode(ctx, "idle");
  const plan = await getActivePlan(ctx.db, ctx.user._id);
  const target = plan?.stepsTarget;
  let line = t(lang, "steps_saved", { steps });
  if (target) {
    const left = target - steps;
    line +=
      left > 0
        ? " " + t(lang, "steps_left", { steps: left })
        : " " + t(lang, "steps_hit");
  }
  await reply(ctx, line, menuBtn(lang));
  if (ctx.user.session.survey) await showEveningSurvey(ctx);
}

// Daily water goal in ml: ~35 ml per kg of bodyweight, rounded to 100, floored at 1500; 2500 default.
// Water goal moved to domain/challenges (waterGoalMl) — shared with the Mini App; this thin
// wrapper keeps the many ctx-based call sites unchanged.
export function waterGoalFor(ctx: MyContext): number {
  return resolveWaterGoal(ctx.user.profile);
}

export async function cmdWater(ctx: MyContext) {
  await clearEditOwner(ctx);
  await showWater(ctx);
}

export async function showWater(ctx: MyContext) {
  const lang = ctx.user.lang;
  const { date } = localParts(ctx.user.profile.timezone);
  const ml = (await getWater(ctx.db, ctx.user._id, date)) ?? 0;
  const goal = waterGoalFor(ctx);
  const pct = Math.min(100, Math.round((ml / goal) * 100));
  const body =
    t(lang, "water_title", { ml, goal, pct }) +
    "\n" +
    progressBar(pct) +
    (ml >= goal ? `\n\n${t(lang, "water_hit")}` : "");
  const kb = new InlineKeyboard()
    .text(t(lang, "water_add_250"), "water:add:250")
    .text(t(lang, "water_add_500"), "water:add:500")
    .text(t(lang, "water_add_750"), "water:add:750")
    .row()
    .text(t(lang, "water_reset"), "water:reset")
    .text(t(lang, "menu_open"), "menu:open");
  await reply(ctx, body, kb);
}

export async function onWaterAction(ctx: MyContext, action: string) {
  const { date } = localParts(ctx.user.profile.timezone);
  if (action === "reset") {
    await setWater(ctx.db, ctx.user._id, date, 0);
  } else if (action.startsWith("add:")) {
    const ml = Number(action.slice("add:".length));
    if (Number.isFinite(ml) && ml > 0) await addWater(ctx.db, ctx.user._id, date, ml);
  }
  await showWater(ctx);
  if (ctx.user.session.survey) await showEveningSurvey(ctx);
}

// ===================== Challenges =====================
// challengeData/challengeTitle/cmdChallenges/showChallengePicker/onChallengeJoin moved to
// bot/challenges.ts (god-file split); re-exported below so existing `from "./bot"` imports
// (router.ts) keep working.

export async function cmdFeedback(ctx: MyContext) {
  await setMode(ctx, "feedback");
  await reply(ctx, t(ctx.user.lang, "feedback_prompt"));
}


// Reminder types the user can switch on/off (the daily/weekly nudges).
export const REMINDER_TYPES = ["workout", "nutrition", "steps", "water", "checkin", "wellbeing", "tomorrow", "measure", "digest", "plateau", "session"] as const;
export const REMINDER_LABEL: Record<string, TKey> = {
  workout: "rem_workout", nutrition: "rem_nutrition", steps: "rem_steps", water: "rem_water", checkin: "rem_checkin",
  wellbeing: "rem_wellbeing", tomorrow: "rem_tomorrow", measure: "rem_measure", digest: "rem_digest", plateau: "rem_plateau",
  session: "rem_session",
};

export async function showReminderSettings(ctx: MyContext) {
  const lang = ctx.user.lang;
  const off = new Set(ctx.user.profile.remindersOff ?? []);
  const kb = new InlineKeyboard();
  REMINDER_TYPES.forEach((key, i) => {
    const on = !off.has(key);
    kb.text(`${on ? "🔔" : "🔕"} ${t(lang, REMINDER_LABEL[key])}`, `remtog:${key}`);
    if ((i + 1) % 2 === 0) kb.row();
  });
  kb.row().text(t(lang, "back"), "menu:settings");
  await reply(ctx, t(lang, "rem_settings_title"), kb);
}

export async function onReminderToggle(ctx: MyContext, key: string) {
  if (!REMINDER_TYPES.includes(key as (typeof REMINDER_TYPES)[number])) return;
  const off = new Set(ctx.user.profile.remindersOff ?? []);
  off.has(key) ? off.delete(key) : off.add(key);
  ctx.user.profile = { ...ctx.user.profile, remindersOff: [...off] };
  await updateUser(ctx.db, ctx.user._id, { profile: ctx.user.profile });
  await showReminderSettings(ctx);
}

// ===================== Vacation / pause mode =====================
// Moved to bot/vacation.ts (god-file split), including the comeback interview; re-exported
// below so existing `from "./bot"` imports (router.ts) keep working.

// ===================== Owner-confirmed cleanup (NEVER auto) =====================
// Moved to bot/cleanup.ts (god-file split); re-exported below so existing `from "./bot"`
// imports (router.ts) keep working.

export function daysMenu(lang: Lang, selected: Weekday[]): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (let w = 1 as Weekday; w <= 7; w++) {
    const on = selected.includes(w as Weekday);
    kb.text(`${on ? "✅ " : ""}${weekdayName(lang, w as Weekday)}`, `day:${w}`);
    if (w === 4) kb.row();
  }
  kb.row().text(t(lang, "set_days_done"), "day:done");
  return kb;
}


export async function cmdSettings(ctx: MyContext) {
  const lang = ctx.user.lang;
  const p = ctx.user.profile;
  const days = (p.trainingWeekdays ?? [])
    .map((w) => weekdayName(lang, w as Weekday))
    .join(", ") || "—";
  await reply(
    ctx,
    `${t(lang, "settings_header", {
      lang: LANG_NAME[lang],
      days,
      hour: p.reminderHour ?? 18,
      tz: p.timezone ?? "UTC",
    })}\n\n${t(lang, "settings_edit_hint")}`,
    settingsMenu(lang, !!ctx.user.competeOptIn, ctx.user.profile.sex, ctx.user.role === "client"),
  );
}

// ---------- bot records (leaderboards + badges) ----------
// Board assembly + badge rendering live in ./bot/boards (also used by the scheduler cache and
// the Mini App); bot.ts keeps only the chat command/render layer.

export async function cmdRecords(ctx: MyContext, tab: "weekly" | "hall" | "badges" | "prs" = "weekly") {
  await clearEditOwner(ctx);
  const lang = ctx.user.lang;
  const you = ctx.user._id;
  let body: string;
  if (tab === "prs") {
    // Personal PR ledger: each tracked lift with its best result and the date it was set —
    // the "when was my last PR?" answer without a trip to /export.
    const records = await listStrength(ctx.db, you);
    if (!records.length) {
      body = t(lang, "prs_empty");
    } else {
      const sorted = [...records].sort((a, b) => prDate(b).localeCompare(prDate(a)));
      const lines = sorted.slice(0, 20).map((r) => `• <b>${escapeHtml(r.exercise)}</b> — ${formatRecordBest(r)} · ${prDate(r)}`);
      body = `${t(lang, "prs_title")}\n${lines.join("\n")}`;
    }
  } else if (tab === "badges") {
    body = renderBadges(lang, await listAchievements(ctx.db, you));
  } else if (tab === "hall") {
    const b = await computeBoards(ctx.db, ctx.user.profile.timezone);
    body = [
      renderBoard(lang, t(lang, "board_relative"), b.relative, you, (v) => `${v.toFixed(2)}× ${t(lang, "unit_bw")}`, true),
      "",
      renderBoard(lang, t(lang, "board_total"), b.total, you, (v) => `${v} 🏋️`),
      "",
      renderBoard(lang, t(lang, "board_recentprs"), b.recentPrs, you, (v) => `${v} 🏆`),
    ].join("\n");
  } else {
    const b = await computeBoards(ctx.db, ctx.user.profile.timezone);
    const today = localParts(ctx.user.profile.timezone).date;
    const myDates = (await workoutLogsSince(ctx.db, you, isoDateMinus(today, 120)))
      .filter((l) => l.completed)
      .map((l) => l.date);
    const streak = weekStreak(myDates, today, ctx.user.reminders?.lastVacation);
    body = [
      renderBoard(lang, t(lang, "board_consistency"), b.consistency, you, (v) => `${v} 🏋️`),
      "",
      renderBoard(lang, t(lang, "board_improved"), b.improved, you, (v) => `+${v.toFixed(1)}%`, true),
      "",
      renderBoard(lang, t(lang, "board_streak"), b.streak, you, (v) => `${v} 🧊`),
      "",
      t(lang, "your_streak", { weeks: streak }),
    ].join("\n");
  }
  const note = ctx.user.competeOptIn ? "" : `\n\n${t(lang, "records_optin_hint")}`;
  await reply(ctx, `${t(lang, "records_title")}\n\n${body}${note}`, recordsTabs(lang, !!ctx.user.competeOptIn));
}

// Toggle leaderboard participation.
export async function toggleCompete(ctx: MyContext) {
  const next = !ctx.user.competeOptIn;
  await updateUser(ctx.db, ctx.user._id, { competeOptIn: next });
  ctx.user.competeOptIn = next;
  await reply(ctx, t(ctx.user.lang, next ? "compete_on" : "compete_off"));
  await cmdRecords(ctx);
}


export async function setAlias(ctx: MyContext, value: string) {
  await updateUser(ctx.db, ctx.user._id, { alias: value });
  ctx.user.alias = value;
  await setMode(ctx, "idle");
  await reply(ctx, t(ctx.user.lang, "alias_saved"));
  await cmdRecords(ctx);
}

export async function handleAliasInput(ctx: MyContext, text: string) {
  await setAlias(ctx, text.trim().slice(0, 24));
}

export async function cmdLang(ctx: MyContext) {
  // Three languages now → show the picker instead of a two-way toggle.
  await reply(ctx, t(ctx.user.lang, "choose_language"), langMenu());
}

export async function updateProfile(ctx: MyContext, patch: Partial<UserDoc["profile"]>) {
  const profile = { ...ctx.user.profile, ...patch };
  await updateUser(ctx.db, ctx.user._id, { profile });
  ctx.user.profile = profile;
}

export async function openSetting(ctx: MyContext, which: string) {
  const lang = ctx.user.lang;
  if (which === "hour") await reply(ctx, t(lang, "set_hour_prompt"), hourMenu());
  else if (which === "days")
    await reply(ctx, t(lang, "set_days_prompt"), daysMenu(lang, ctx.user.profile.trainingWeekdays ?? []));
  else if (which === "tz") await reply(ctx, t(lang, "set_tz_prompt"), tzMenu());
  else if (which === "lang") await reply(ctx, t(lang, "choose_language"), langMenu());
  else if (which === "body") {
    await setMode(ctx, "body_edit");
    const p = ctx.user.profile;
    const cur = p.heightCm && p.weightKg ? `${p.heightCm} ${p.weightKg}` : "180 80";
    await reply(ctx, t(lang, "set_body_prompt", { cur }));
  }
  else if (which === "goalweight") {
    await setMode(ctx, "goal_weight");
    const cur = ctx.user.profile.goalWeight ?? ctx.user.profile.weightKg ?? 75;
    await reply(ctx, t(lang, "set_goalweight_prompt", { cur }));
  }
  else if (which === "injury") await showInjuryMenu(ctx);
  else if (which === "replan") await cmdReplan(ctx);
}

// Set the target bodyweight (drives the projection on the progress screen).
export async function handleGoalWeight(ctx: MyContext, text: string) {
  const lang = ctx.user.lang;
  const w = parseFloat(text.replace(",", ".").replace(/[^\d.]/g, ""));
  if (!Number.isFinite(w) || w < 30 || w > 300) { await reply(ctx, t(lang, "set_goalweight_invalid")); return; }
  await updateProfile(ctx, { goalWeight: Math.round(w * 10) / 10 });
  await setMode(ctx, "idle");
  await reply(ctx, t(lang, "set_goalweight_saved", { w: Math.round(w * 10) / 10 }), menuBtn(lang));
}

// ===================== Injury / pain tracking =====================
// Moved to bot/injury.ts (god-file split); re-exported below so existing `from "./bot"`
// imports (router.ts) keep working.

// ============ Menstrual-cycle tracking (opt-in, female profiles) ============
// Moved to bot/cycle.ts (god-file split); re-exported below so existing `from "./bot"` imports
// (router.ts) keep working.

// ============ Sharing with trainer (client-owned consent toggles) ============
// Moved to bot/shareConsent.ts (god-file split); re-exported below.

// ===================== Calendar & session booking =====================
// Moved to bot/calendar.ts (god-file split); re-exported below so existing `from "./bot"`
// imports (router.ts, bot/trainer.ts) keep working.

// Edit body height+weight from settings. Reuses the onboarding realism check + auto-swap.
export async function handleBodyEdit(ctx: MyContext, text: string) {
  const lang = ctx.user.lang;
  const hw = parseHeightWeight(text);
  if (!hw) {
    await reply(ctx, t(lang, "ob_hw_unrealistic"));
    return;
  }
  await updateProfile(ctx, { heightCm: hw.heightCm, weightKg: hw.weightKg });
  await setMode(ctx, "idle");
  // Recalculate nutrition targets whenever weight/height change — macros (protein, fats) are
  // expressed per-kg, so stale targets quickly diverge from reality. We pass undefined for
  // planNutrition to force a formula-based recalculation (Mifflin-St-Jeor + activity + goal)
  // rather than just returning the unchanged plan values.
  const freshNutrition = computeTargets(ctx.user.profile, undefined);
  // Preserve the text notes from the AI-authored plan (e.g. "calculated for recomposition…").
  const existingNotes = ctx.user.nutrition?.notes;
  await updateUser(ctx.db, ctx.user._id, {
    nutrition: { ...freshNutrition, ...(existingNotes ? { notes: existingNotes } : {}) },
  });
  await reply(ctx, t(lang, "body_saved", { h: String(hw.heightCm), w: String(hw.weightKg) }));
  await cmdSettings(ctx);
}

export async function onSetHour(ctx: MyContext, hour: number) {
  if (Number.isFinite(hour)) await updateProfile(ctx, { reminderHour: hour });
  await reply(ctx, t(ctx.user.lang, "settings_saved"));
  await cmdSettings(ctx);
}

// Reply to the scheduler's smart reminder-timing offer: "yes:<h>" applies the hour, "no" keeps it.
export async function onSmartHour(ctx: MyContext, action: string) {
  const lang = ctx.user.lang;
  const [verb, hStr] = action.split(":");
  const h = Number(hStr);
  if (verb === "yes" && Number.isInteger(h) && h >= 0 && h <= 23) {
    await updateProfile(ctx, { reminderHour: h });
    await reply(ctx, t(lang, "smart_hour_set", { h }), menuBtn(lang));
  } else {
    await reply(ctx, t(lang, "smart_hour_kept"), menuBtn(lang));
  }
}

export async function onSetTz(ctx: MyContext, tz: string) {
  if (tz) await updateProfile(ctx, { timezone: tz });
  await reply(ctx, t(ctx.user.lang, "settings_saved"));
  await cmdSettings(ctx);
}

export async function onToggleDay(ctx: MyContext, arg: string) {
  const lang = ctx.user.lang;
  if (arg === "done") {
    await reply(ctx, t(lang, "settings_saved"));
    await cmdSettings(ctx);
    return;
  }
  const w = Number(arg) as Weekday;
  const cur = new Set(ctx.user.profile.trainingWeekdays ?? []);
  if (cur.has(w)) cur.delete(w);
  else cur.add(w);
  const arr = [...cur].sort((a, b) => a - b) as Weekday[];
  await updateProfile(ctx, { trainingWeekdays: arr });
  await ctx.editMessageReplyMarkup({ reply_markup: daysMenu(lang, arr) }).catch(() => {});
}

// ---------------- onboarding & plan generation ----------------

// Onboarding wizard lives in ./bot/onboarding (extracted); TKey stays here — it's used
// across the whole file.
export type TKey = Parameters<typeof t>[1]; // keyof the locale dictionary





















// onLevelUp, onGoalMaintain, resumePendingPlan, saveBaselineBody moved to bot/planGen.ts
// (god-file split); re-exported below so existing `from "./bot"` imports keep working.

// ---------------- nutrition ----------------
// Moved to bot/nutritionLog.ts (god-file split); re-exported below so existing `from "./bot"`
// imports (router.ts) keep working.

// ---------------- coach / logging / measurements / feedback ----------------
// coach* moved to bot/coach.ts, workout-log/save moved to bot/workoutSave.ts, feedback moved
// to bot/feedbackIntake.ts (god-file split); re-exported below. handleMeasure (the only
// "measurements" function — too small on its own for a new file) stayed here.

export async function handleMeasure(ctx: MyContext, text: string) {
  const lang = ctx.user.lang;
  const { weight, measurements } = parseMeasurements(text);
  if (weight === undefined && Object.keys(measurements).length === 0) {
    await reply(ctx, t(lang, "measure_none"));
    return;
  }
  const { date } = localParts(ctx.user.profile.timezone);
  await upsertBodyLog(ctx.db, ctx.user._id, date, {
    ...(weight !== undefined ? { weight } : {}),
    ...(Object.keys(measurements).length ? { measurements } : {}),
  });
  await setMode(ctx, "idle");
  await reply(ctx, t(lang, "measure_saved"), menuBtn(lang));
}

// ---------------- user report ----------------
// Moved to bot/report.ts (god-file split); re-exported below so existing `from "./bot"`
// imports (router.ts, bot/trainer.ts) keep working.

// ---------------- replan / delete / export ----------------
// Moved to bot/exportData.ts (god-file split); re-exported below so existing `from "./bot"`
// imports (router.ts, webapp/settingsApi.ts) keep working.


// ---------------- bot factory ----------------
