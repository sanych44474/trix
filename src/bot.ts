import { offerRecoverySwap } from "./bot/recoverySwap";
import { kitFitButton } from "./bot/kitFit";
import { InlineKeyboard } from "grammy";
import { logInfo } from "./log";
import type { ExerciseVideo, Lang, PlanDay, UserDoc, Weekday } from "./types";
import { workoutLogsSince } from "./adapters/d1/v2Workouts";
import { getActivePlan } from "./adapters/d1/v2Plans";
import { getTrainer, pendingRequestForClient } from "./adapters/d1/v2Trainer";
import { getDailyCheckin } from "./adapters/d1/v2Tracking";
import { getExerciseVideos, getUserVideos } from "./adapters/d1/v2Catalog";
import { getUser, updateUser } from "./adapters/d1/v2Users";
import { escapeHtml, t } from "./locales/i18n";
import { deloadSets, readinessAdvice } from "./domain/progression";
import { localParts } from "./domain/localTime";
import { phaseKey as mesoPhaseKey, trainingWeek } from "./domain/mesocycle";
import { buildVideoOpenLink } from "./domain/videoLink";
import { exerciseVideoKey, renderPlan, renderSchedule, renderToday, upcomingSessions } from "./render";
import { cmdReport, localCutoff } from "./bot/report";
import { resumePendingPlan } from "./bot/planGen";
import { renderDayInline } from "./bot/workoutSave";
import { isOwner } from "./bot/owner";
import { joinByCode, joinByProspectCode } from "./features/trainer/trainer";
import { showSharedProgram } from "./features/trainer/programSharing";
import { showPlanEditDay } from "./features/trainer/clientCard";
import { trainerMenu } from "./features/trainer/trainerCommon";
import { onboardingStep, renderObStep } from "./bot/onboarding";
import { mainMenu, moreMenu, progressHubMenu, trainerHubMenu, trainerClientsMenu, appendOwnerRow, menuBtn, planViewKb, langMenu, difficultyKeyboard, todayWorkoutKeyboard } from "./bot/keyboards";
import { healPlanIfDegenerate } from "./bot/plan";
import { showNextBestAction } from "./bot/nextBestAction";
import { cmdLog } from "./bot/guidedLog";
import { readinessWithConditioning, recentConditioningStrain } from "./domain/conditioning";
import { lookupExerciseVideoCached } from "./youtube";
import { HTML, clearEditOwner, reply, setMode, type MyContext } from "./adapters/telegram/context";
import { cmdProgress } from "./bot/progressCmds";
import { cmdNutrition, cmdSteps } from "./bot/nutritionCmds";
import { cmdSettings, cmdMeasure } from "./bot/settingsCmds";
import { healPlanNamesForDisplay, sendExerciseDescriptions } from "./bot/exerciseCatalog";
import { APP_URL } from "./bot/appLinks";
// Core context/plumbing (MyContext, reply, HTML, setMode, plan-owner helpers, TKey) lives in
// adapters/telegram/context.ts now — extracted so the many bot/*.ts feature files that only
// need these don't have to import the whole god-file (roadmap item 1, first slice: this was the
// single biggest source of router.ts's 100+ backward imports from bot.ts). Re-exported here so
// every existing `from "./bot"` consumer keeps working unchanged.
export type { MyContext, TKey } from "./adapters/telegram/context";
export {
  HTML, clearEditOwner, getActivePlanOrReply, isEditingOther, planOwnerId, planOwnerLang, reply, sendLong, setEditOwner, setMode,
} from "./adapters/telegram/context";
export * from "./bot/appLinks";
export * from "./bot/exerciseCatalog";
export * from "./bot/recordsCmds";
export * from "./bot/settingsCmds";
export * from "./bot/nutritionCmds";
export * from "./bot/progressCmds";
export { buildOwnerReport, buildErrorReport, buildOwnerMetrics, ownerUsersData } from "./bot/owner";
// Extracted modules — imported for internal use AND re-exported so every existing consumer
// (scheduler, webapp, tests) keeps importing from "./bot" unchanged.
export * from "./features/gamification/boards";
export * from "./features/gamification/weekCard";
export * from "./bot/survey";
export * from "./bot/onboarding";
export * from "./bot/keyboards";
export * from "./bot/plan";
export * from "./bot/router";
export * from "./features/gamification/challenges";
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
export * from "./features/nutrition/nutritionLog";
export * from "./bot/coach";
export * from "./bot/workoutSave";
export * from "./bot/feedbackIntake";
export * from "./bot/logSelfEdit";
export * from "./bot/warmup";
export * from "./bot/planExerciseEdit";
export * from "./bot/guidedLog";
export * from "./bot/nextBestAction";


export const REPORT_DAYS = 14;

// A valid training day must carry a full session — used to reject degenerate AI plans.
export { MIN_EXERCISES_PER_DAY } from "./domain/plan-lint";

// The AI provider's raw plan response shape — canonical definition + runtime validation live in
// domain/plan-schema.ts (AiPlanResponse/parseAiPlanResponse), not duplicated here.
export type { AiPlanResponse as AiPlan } from "./domain/plan-schema";

export function defaultLang(code?: string): Lang {
  return code?.toLowerCase().startsWith("uk") ? "uk" : "en";
}

// Reduce a callback_data string to a stable analytics key: drop numeric ids and dates, keep the
// first two meaningful segments. "cl:123:plan"→"cl:plan", "vid:pick:0"→"vid:pick", "menu:plan" stays.
export function normalizeEvent(data: string): string {
  const parts = data.split(":").filter((p) => p && !/^\d+$/.test(p) && !/^\d{4}-\d{2}-\d{2}$/.test(p));
  return parts.slice(0, 2).join(":") || "other";
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

// cmdTrainerReport/cmdTrainerBroadcast/handleTrainerBroadcast moved to features/trainer/trainer.ts;
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

// A weekday + exercise index packed into a single numeric session.targetId (weekday*1000 + idx).
export function encodePlanRef(weekday: number, index: number): number {
  return weekday * 1000 + index;
}
export function decodePlanRef(ref: number): { weekday: number; index: number } {
  return { weekday: Math.floor(ref / 1000), index: ref % 1000 };
}

// Re-show the managed user's edit-day view after a shared edit action (delete/swap/…), so the
// trainer/owner stays in the client's plan instead of being dropped into their OWN today view.
// Stayed in bot.ts (not adapters/telegram/context.ts) because it calls showPlanEditDay, a
// feature-layer function (features/trainer/trainer.ts) — moving it would just recreate the cycle one file over.
export async function reRenderEditDay(ctx: MyContext, weekday: Weekday) {
  const owner = ctx.user.session.editPlanOwner;
  const prefix = ctx.user.session.editPlanPrefix ?? "cl";
  if (owner === undefined) return;
  await showPlanEditDay(ctx, owner, prefix, weekday);
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
  logInfo("app_open", { surface: "bot" });
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
    // Roadmap item 5: one prioritized action instead of a bare "welcome back" + full menu —
    // the menu is still one tap away (mainMenu/moreMenu), just not the FIRST thing shown.
    await reply(ctx, hi + t(lang, "welcome_back"));
    await showNextBestAction(ctx);
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
    await reply(ctx, hi + t(lang, "welcome_back"));
    await showNextBestAction(ctx);
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
  for (const [k, v] of map) {
    if (v.url) map.set(k, { ...v, url: await buildVideoOpenLink(APP_URL, v.url, ctx.user._id, ctx.env.TELEGRAM_BOT_TOKEN) });
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
  // Exercises needing equipment they don't have → a one-tap fix leads the keyboard (bot/kitFit.ts).
  const kb = planViewKb(lang);
  const fit = await kitFitButton(ctx).catch(() => null);
  await reply(ctx, renderPlan(lang, plan, await videosForDays(ctx, plan.split)), fit ? new InlineKeyboard().text(fit.text, fit.data).row().append(kb) : kb);
}

export type PendingExercise = NonNullable<MyContext["user"]["session"]["pendingExercise"]>;

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
    const week = trainingWeek(plan, today);
    const deload = week.deload;
    const day = deload
      ? { ...todays.day, exercises: todays.day.exercises.map((e) => ({ ...e, sets: deloadSets(e.sets) })) }
      : todays.day;
    // Periodization awareness: the plan's block phase (only plans with a mesocycle have one).
    // On a deload week the deload notice already says it, so no phase line on top.
    const phaseLine =
      !deload && week.phase
        ? t(lang, "periodization_line", { phase: t(lang, mesoPhaseKey(week.phase) as Parameters<typeof t>[1]), week: week.weekInBlock ?? 1, len: week.blockLength ?? 4 }) + "\n\n"
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
    await offerRecoverySwap(ctx, plan, recentLogs, today, todays.weekday).catch(() => {});
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

export async function cmdCoach(ctx: MyContext) {
  await setMode(ctx, "coach");
  await reply(ctx, t(ctx.user.lang, "coach_prompt"));
}

export async function cmdFeedback(ctx: MyContext) {
  await setMode(ctx, "feedback");
  await reply(ctx, t(ctx.user.lang, "feedback_prompt"));
}

